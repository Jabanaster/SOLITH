//! Chunked memory reader — the Stage 2 core deliverable. Turns a planned
//! `ChunkSpec` (chunk.rs) into a real `ReadProcessMemory` call, classifying
//! every possible outcome honestly (mission §10) rather than collapsing
//! everything into "skip and continue" the way today's TypeScript scanner's
//! `catch { continue; }` does (Stage 1 doc 02).

use std::time::Instant;

use crate::cancellation::CancellationToken;
use crate::chunk::{plan_chunks, ChunkPlanConfig, ChunkSpec};
use crate::completeness::{ScanCompleteness, ScanMetrics, SkipReason, SkippedRange};
use crate::error::ScannerResult;
use crate::policy::RegionSelectionPolicy;
use crate::region::Region;
use crate::target::{HandleStatus, ProcessHandle};

#[cfg(not(windows))]
use crate::error::{ErrorKind, ScannerError};

#[cfg(windows)]
use windows_sys::Win32::Foundation::GetLastError;
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;

/// Honest classification of a single chunk read attempt. `Success` and
/// `PartialRead` both carry real bytes; every other variant carries none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChunkReadStatus {
    Success,
    /// Fewer bytes were returned than requested — the OS reported success
    /// but `lpNumberOfBytesRead` was short. This is a real, distinct Win32
    /// outcome (not merely "our accounting is off") and must be visible to
    /// the caller as such rather than silently accepted as if it were a
    /// full read.
    PartialRead {
        bytes_read: u64,
    },
    AccessDenied,
    TargetExited,
    InvalidAddress,
    OsError {
        code: u32,
    },
    ResourceLimit,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct ChunkReadResult {
    pub spec: ChunkSpec,
    pub status: ChunkReadStatus,
    /// Bytes actually read. Populated for `Success`/`PartialRead` only;
    /// empty for every failure variant.
    pub data: Vec<u8>,
}

/// Optional resource bounds for one read operation — analogous to today's
/// `ScanBounds` (`maxTotalBytes`), but expressed at the reader layer so
/// future scan modes inherit budget enforcement for free rather than each
/// reimplementing it.
#[derive(Debug, Clone, Copy, Default)]
pub struct ReadBudget {
    pub max_total_bytes: Option<u64>,
}

/// Reads one region in full, chunk by chunk, checking `cancellation`
/// between chunks (never mid-syscall) and stopping honestly if the target
/// exits or a budget is exceeded.
#[cfg(windows)]
pub fn read_region_chunked(
    handle: &ProcessHandle,
    region: &Region,
    chunk_config: ChunkPlanConfig,
    cancellation: &CancellationToken,
    budget: ReadBudget,
    metrics: &mut ScanMetrics,
) -> ScannerResult<(Vec<ChunkReadResult>, ScanCompleteness)> {
    read_region_chunked_with_progress(
        handle,
        region,
        chunk_config,
        cancellation,
        budget,
        metrics,
        None,
    )
}

/// Same as [`read_region_chunked`], with an optional per-chunk progress
/// callback (mission §16's progress foundation). `on_progress` is invoked
/// after every chunk attempt (success or failure) with a snapshot of the
/// metrics accumulated *so far in this region* — the napi adapter wires
/// this to a rate-limited `ThreadsafeFunction` push to the renderer; Rust
/// callers (including this crate's own tests) can use it directly to
/// observe or act on progress deterministically, e.g. to request
/// cancellation after a specific amount of work has been observed rather
/// than racing a wall-clock sleep against the reader.
#[cfg(windows)]
pub fn read_region_chunked_with_progress(
    handle: &ProcessHandle,
    region: &Region,
    chunk_config: ChunkPlanConfig,
    cancellation: &CancellationToken,
    budget: ReadBudget,
    metrics: &mut ScanMetrics,
    mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
) -> ScannerResult<(Vec<ChunkReadResult>, ScanCompleteness)> {
    let chunks = plan_chunks(region.base_address, region.size, chunk_config)?;
    metrics.chunks_requested += chunks.len() as u64;

    let mut results = Vec::with_capacity(chunks.len());
    let mut skipped: Vec<SkippedRange> = Vec::new();
    let mut bytes_read_total: u64 = 0;

    for spec in chunks {
        if cancellation.is_cancelled() {
            return Ok((
                results,
                ScanCompleteness::Cancelled {
                    at_byte: spec.chunk_base,
                },
            ));
        }

        if let Some(max) = budget.max_total_bytes {
            if bytes_read_total >= max {
                return Ok((
                    results,
                    ScanCompleteness::ResourceLimit {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
        }

        metrics.bytes_requested += spec.requested_size;

        match handle.status() {
            Ok(HandleStatus::Exited) => {
                return Ok((
                    results,
                    ScanCompleteness::ProcessExited {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
            Err(_) => {
                // Liveness check itself failed — treat conservatively as
                // exited rather than guessing the process is still alive.
                return Ok((
                    results,
                    ScanCompleteness::ProcessExited {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
            Ok(HandleStatus::Open) => {}
        }

        let read = read_chunk(handle, &spec);
        metrics.syscall_count += 1;

        match &read.status {
            ChunkReadStatus::Success => {
                metrics.chunks_read += 1;
                bytes_read_total += spec.requested_size;
                metrics.bytes_read += spec.requested_size;
            }
            ChunkReadStatus::PartialRead { bytes_read } => {
                metrics.chunks_partial += 1;
                bytes_read_total += bytes_read;
                metrics.bytes_read += bytes_read;
                skipped.push(SkippedRange {
                    base_address: spec.chunk_base,
                    size: spec.requested_size,
                    reason: SkipReason::PartialRead,
                });
            }
            ChunkReadStatus::AccessDenied => {
                metrics.chunks_failed += 1;
                skipped.push(SkippedRange {
                    base_address: spec.chunk_base,
                    size: spec.requested_size,
                    reason: SkipReason::AccessDenied,
                });
            }
            ChunkReadStatus::InvalidAddress => {
                metrics.chunks_failed += 1;
                skipped.push(SkippedRange {
                    base_address: spec.chunk_base,
                    size: spec.requested_size,
                    reason: SkipReason::Unreadable,
                });
            }
            ChunkReadStatus::OsError { .. } => {
                metrics.chunks_failed += 1;
                skipped.push(SkippedRange {
                    base_address: spec.chunk_base,
                    size: spec.requested_size,
                    reason: SkipReason::OsError,
                });
            }
            ChunkReadStatus::TargetExited => {
                results.push(read);
                return Ok((
                    results,
                    ScanCompleteness::ProcessExited {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
            ChunkReadStatus::ResourceLimit => {
                results.push(read);
                return Ok((
                    results,
                    ScanCompleteness::ResourceLimit {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
            ChunkReadStatus::Cancelled => {
                results.push(read);
                return Ok((
                    results,
                    ScanCompleteness::Cancelled {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
        }

        results.push(read);

        if let Some(cb) = on_progress.as_deref_mut() {
            cb(metrics);
        }
    }

    if skipped.is_empty() {
        Ok((results, ScanCompleteness::Complete))
    } else {
        Ok((
            results,
            ScanCompleteness::CompleteWithSkippedRegions { skipped },
        ))
    }
}

#[cfg(windows)]
fn read_chunk(handle: &ProcessHandle, spec: &ChunkSpec) -> ChunkReadResult {
    if spec.requested_size == 0 {
        return ChunkReadResult {
            spec: *spec,
            status: ChunkReadStatus::Success,
            data: Vec::new(),
        };
    }

    let mut buffer = vec![0u8; spec.requested_size as usize];
    let mut bytes_read: usize = 0;

    let ok = unsafe {
        ReadProcessMemory(
            handle.raw(),
            spec.chunk_base as *const core::ffi::c_void,
            buffer.as_mut_ptr() as *mut core::ffi::c_void,
            buffer.len(),
            &mut bytes_read as *mut usize,
        )
    };

    if ok == 0 {
        let code = unsafe { GetLastError() };
        // ERROR_PARTIAL_COPY (299) is Windows's own signal for "some of this
        // read range was not accessible" — still classified as a distinct,
        // named failure rather than silently retried or ignored.
        const ERROR_PARTIAL_COPY: u32 = 299;
        const ERROR_ACCESS_DENIED: u32 = 5;
        const ERROR_INVALID_PARAMETER: u32 = 87;
        let status = match code {
            ERROR_PARTIAL_COPY => ChunkReadStatus::AccessDenied,
            ERROR_ACCESS_DENIED => ChunkReadStatus::AccessDenied,
            ERROR_INVALID_PARAMETER => ChunkReadStatus::InvalidAddress,
            other => ChunkReadStatus::OsError { code: other },
        };
        return ChunkReadResult {
            spec: *spec,
            status,
            data: Vec::new(),
        };
    }

    if (bytes_read as u64) < spec.requested_size {
        buffer.truncate(bytes_read);
        return ChunkReadResult {
            spec: *spec,
            status: ChunkReadStatus::PartialRead {
                bytes_read: bytes_read as u64,
            },
            data: buffer,
        };
    }

    ChunkReadResult {
        spec: *spec,
        status: ChunkReadStatus::Success,
        data: buffer,
    }
}

/// Reads every region selected by `policy` out of `regions`, honestly
/// naming every excluded/skipped/failed range. This is the top-level entry
/// point a future scan mode (Stage 3+) will call once per scan.
#[cfg(windows)]
pub fn read_regions_chunked(
    handle: &ProcessHandle,
    regions: &[Region],
    policy: &RegionSelectionPolicy,
    chunk_config: ChunkPlanConfig,
    cancellation: &CancellationToken,
    budget: ReadBudget,
) -> ScannerResult<(Vec<ChunkReadResult>, ScanMetrics, ScanCompleteness)> {
    read_regions_chunked_with_progress(
        handle,
        regions,
        policy,
        chunk_config,
        cancellation,
        budget,
        None,
    )
}

/// Same as [`read_regions_chunked`], with an optional progress callback
/// (mission §16) invoked after every chunk across every selected region —
/// see [`read_region_chunked_with_progress`] for the contract.
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
pub fn read_regions_chunked_with_progress(
    handle: &ProcessHandle,
    regions: &[Region],
    policy: &RegionSelectionPolicy,
    chunk_config: ChunkPlanConfig,
    cancellation: &CancellationToken,
    budget: ReadBudget,
    mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
) -> ScannerResult<(Vec<ChunkReadResult>, ScanMetrics, ScanCompleteness)> {
    let start = Instant::now();
    let mut metrics = ScanMetrics {
        regions_total: regions.len() as u64,
        ..Default::default()
    };

    let (selected, excluded): (Vec<&Region>, Vec<&Region>) = policy.partition(regions);
    metrics.regions_considered = selected.len() as u64;
    metrics.regions_skipped = excluded.len() as u64;

    let mut all_results = Vec::new();
    let mut all_skipped: Vec<SkippedRange> = excluded
        .iter()
        .map(|r| SkippedRange {
            base_address: r.base_address,
            size: r.size,
            reason: SkipReason::PolicyExcluded,
        })
        .collect();

    let mut total_bytes_read_so_far: u64 = 0;

    for region in selected {
        if cancellation.is_cancelled() {
            metrics.elapsed = start.elapsed();
            return Ok((
                all_results,
                metrics,
                ScanCompleteness::Cancelled {
                    at_byte: region.base_address,
                },
            ));
        }

        let remaining_budget = budget
            .max_total_bytes
            .map(|max| max.saturating_sub(total_bytes_read_so_far));
        let per_region_budget = ReadBudget {
            max_total_bytes: remaining_budget,
        };

        // Explicit double-reborrow: `on_progress.as_deref_mut()` alone does
        // not satisfy the borrow checker across multiple loop iterations for
        // an `Option<&mut dyn Trait>` (each call would otherwise appear to
        // hold the borrow for the callee's anonymous lifetime indefinitely).
        // Matching on `&mut on_progress` and re-deref'ing scopes the borrow
        // to just this iteration.
        let progress_arg: Option<&mut dyn FnMut(&ScanMetrics)> = match &mut on_progress {
            Some(cb) => Some(&mut **cb),
            None => None,
        };
        let (results, completeness) = read_region_chunked_with_progress(
            handle,
            region,
            chunk_config,
            cancellation,
            per_region_budget,
            &mut metrics,
            progress_arg,
        )?;
        total_bytes_read_so_far = metrics.bytes_read;
        all_results.extend(results);

        match completeness {
            ScanCompleteness::Complete => {
                metrics.regions_read += 1;
            }
            ScanCompleteness::CompleteWithSkippedRegions { skipped } => {
                metrics.regions_read += 1;
                all_skipped.extend(skipped);
            }
            other => {
                // A region-level stop condition (cancelled/exited/resource
                // limit) ends the whole multi-region read here — later
                // regions were never attempted, and that must show up as
                // `regions_considered - regions_read - regions_skipped`
                // being nonzero rather than being silently absorbed.
                metrics.elapsed = start.elapsed();
                return Ok((all_results, metrics, other));
            }
        }
    }

    metrics.elapsed = start.elapsed();
    if all_skipped.is_empty() {
        Ok((all_results, metrics, ScanCompleteness::Complete))
    } else {
        Ok((
            all_results,
            metrics,
            ScanCompleteness::CompleteWithSkippedRegions {
                skipped: all_skipped,
            },
        ))
    }
}

#[cfg(not(windows))]
pub fn read_regions_chunked(
    _handle: &ProcessHandle,
    _regions: &[Region],
    _policy: &RegionSelectionPolicy,
    _chunk_config: ChunkPlanConfig,
    _cancellation: &CancellationToken,
    _budget: ReadBudget,
) -> ScannerResult<(Vec<ChunkReadResult>, ScanMetrics, ScanCompleteness)> {
    Err(ScannerError::new(
        ErrorKind::UnsupportedArchitecture,
        "chunked reading is Windows-only",
    ))
}
