//! Scan-session / refinement engine (Stage 4, mission §4).
//!
//! Builds directly on Stage 3's primitive-value machinery
//! (`types::PrimitiveType`/`PrimitiveValue`, `exact_scan::AlignmentMode`,
//! `chunk::plan_chunks`, `reader::read_chunk`) to add a stateful,
//! multi-generation scan session: capture an `UNKNOWN_INITIAL` baseline
//! across every policy-selected region, then repeatedly re-read only the
//! surviving candidates' own addresses and filter by
//! CHANGED/UNCHANGED/INCREASED/DECREASED/INCREASED_BY/DECREASED_BY/BETWEEN
//! — the classic scan-and-refine workflow, expressed with the same
//! truthful-completeness and BigInt-safe-value discipline as every earlier
//! stage.
//!
//! ## Stale-target protection (mission §4.2)
//!
//! A `ScanSession` owns its `ProcessHandle` from the moment it is created
//! and never re-opens a handle by PID afterward. Windows keeps a process's
//! kernel object alive for as long as any handle to it remains open, so
//! this held handle can never be silently rebound to a different process
//! even if the original PID is reused the instant the original process
//! exits — every subsequent read through this handle either reaches the
//! *original* process's memory or fails with `TargetExited`, never a new
//! unrelated process's memory at a reused PID. `ProcessIdentity` (captured
//! once, at session creation, via `ProcessHandle::process_creation_time_filetime`)
//! records the strongest reliable identity tuple available for diagnostics
//! and as an explicit, independently-checkable fact about that invariant —
//! it is not itself what makes the protection correct; the handle-pinning
//! behavior described above is. `verify_not_stale` is checked at the start
//! of every session-mutating operation and simply asks the OS whether the
//! pinned handle's process is still alive.
//!
//! Forcing a real PID-reuse collision deterministically in a test is not
//! possible from user-mode Windows (the OS, not this crate or the test,
//! decides which exited process's PID gets reused, and typically does not
//! reuse a just-exited PID within a single test's lifetime) — the same
//! category of environment limitation already documented for Stage 2's
//! WOW64 gap (P1-SCAN-001). `tests/session_integration.rs` instead proves
//! the provable half directly: a session's operations against its own
//! *actually-exited* target always fail with `TargetExited`, and a second,
//! independently-created session against a different spawned process is a
//! fully distinct object with its own handle and its own identity — by
//! construction, nothing links the two, so there is no code path by which
//! the first session's stale handle could ever observe the second
//! session's target.

use std::cmp::Ordering;
use std::time::{Duration, Instant};

use crate::chunk::{plan_chunks, ChunkPlanConfig, ChunkSpec};
use crate::completeness::{ScanCompleteness, ScanMetrics, SkipReason, SkippedRange};
use crate::error::{ErrorKind, ScannerError, ScannerResult};
use crate::exact_scan::AlignmentMode;
use crate::policy::RegionSelectionPolicy;
use crate::reader::{read_chunk, ChunkReadStatus};
use crate::region::Region;
use crate::target::{HandleStatus, ProcessHandle};
use crate::types::{PrimitiveType, PrimitiveValue};
use crate::CancellationToken;

/// The strongest reliable per-session target identity this crate can
/// obtain (mission §4.2) — see the module doc for why the real protection
/// is handle-pinning, and this struct is the diagnostic/self-consistency
/// record of that fact rather than the mechanism itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub creation_time_filetime: u64,
}

/// One refinement operation (mission §4.5-§4.8). `UNKNOWN_INITIAL` itself
/// is not a variant here — it is the session *constructor*
/// (`create_unknown_initial`), not a refinement over an existing candidate
/// set, per the mission's own framing ("It establishes the baseline
/// snapshot").
#[derive(Debug, Clone, Copy)]
pub enum RefineMode {
    Changed,
    Unchanged,
    Increased,
    Decreased,
    IncreasedBy(PrimitiveValue),
    DecreasedBy(PrimitiveValue),
    /// Inclusive on both ends (mission §4.8's recommended default).
    Between(PrimitiveValue, PrimitiveValue),
}

impl RefineMode {
    pub fn label(&self) -> &'static str {
        match self {
            RefineMode::Changed => "changed",
            RefineMode::Unchanged => "unchanged",
            RefineMode::Increased => "increased",
            RefineMode::Decreased => "decreased",
            RefineMode::IncreasedBy(_) => "increased_by",
            RefineMode::DecreasedBy(_) => "decreased_by",
            RefineMode::Between(_, _) => "between",
        }
    }
}

/// Compact native candidate storage (mission §4.3): a packed address vector
/// plus a flat, fixed-width value buffer — never one heap object per
/// candidate. For `n` candidates of a `w`-byte primitive type this costs
/// exactly `n * (8 + w)` bytes (8 for the address, `w` for the snapshot
/// value): ~9 MB/million for i8/u8, ~10 MB/million for i16/u16, ~12
/// MB/million for i32/u32/f32, ~16 MB/million for i64/u64/f64 — the exact
/// figures Docs/phase1/29 documents per type.
#[derive(Debug, Clone)]
pub struct CandidateStore {
    primitive_type: PrimitiveType,
    addresses: Vec<u64>,
    values: Vec<u8>,
}

impl CandidateStore {
    pub fn new(primitive_type: PrimitiveType) -> Self {
        Self {
            primitive_type,
            addresses: Vec::new(),
            values: Vec::new(),
        }
    }

    pub fn primitive_type(&self) -> PrimitiveType {
        self.primitive_type
    }

    pub fn len(&self) -> usize {
        self.addresses.len()
    }

    pub fn is_empty(&self) -> bool {
        self.addresses.is_empty()
    }

    /// Appends one candidate. `address` order is the caller's
    /// responsibility to keep ascending (both `create_unknown_initial` and
    /// `refine` naturally produce ascending order, since both walk regions
    /// and chunks in ascending-address order) — deterministic ordering is
    /// mission §4.3's explicit requirement, and this store never re-sorts
    /// on its own, so a caller violating this would be a bug in this crate,
    /// not a runtime condition to defend against here.
    pub fn push(&mut self, address: u64, value: PrimitiveValue) {
        debug_assert_eq!(
            value.primitive_type(),
            self.primitive_type,
            "CandidateStore invariant: every pushed value must match this store's own primitive type"
        );
        self.addresses.push(address);
        let width = self.primitive_type.byte_width();
        let start = self.values.len();
        self.values.resize(start + width, 0);
        value.encode_into(&mut self.values[start..start + width]);
    }

    pub fn address(&self, index: usize) -> u64 {
        self.addresses[index]
    }

    pub fn value(&self, index: usize) -> PrimitiveValue {
        let width = self.primitive_type.byte_width();
        let start = index * width;
        PrimitiveValue::decode(self.primitive_type, &self.values[start..start + width])
            .expect("CandidateStore invariant: stored bytes always decode at their own width")
    }

    pub fn iter(&self) -> impl Iterator<Item = (u64, PrimitiveValue)> + '_ {
        (0..self.len()).map(move |i| (self.address(i), self.value(i)))
    }

    /// Total native memory this store occupies right now: `len * 8` for
    /// addresses plus `len * byte_width` for values — the exact accounting
    /// mission §4.3/§4.11 require.
    pub fn memory_bytes(&self) -> u64 {
        (self.addresses.len() as u64) * 8 + self.values.len() as u64
    }
}

/// One completed generation's audit record (mission §4.9) — deliberately
/// retained as structured data (not just a log line) so a future stage can
/// build undo/rollback or a user-facing history view without re-deriving
/// this bookkeeping.
#[derive(Debug, Clone)]
pub struct GenerationRecord {
    pub generation: u64,
    pub mode_label: &'static str,
    pub input_candidate_count: u64,
    pub output_candidate_count: u64,
    pub bytes_reread: u64,
    pub skipped_reads: u64,
    pub completeness: ScanCompleteness,
    pub duration: Duration,
}

/// Native resource bounds for one session (mission §4.11). `Default`
/// (all `None`) means no limit — for callers/tests that want full
/// programmatic control; `default_safe()` is the shape a real interactive
/// napi call site should reach for instead.
#[derive(Debug, Clone, Copy, Default)]
pub struct SessionResourceLimits {
    pub max_candidates: Option<u64>,
    pub max_snapshot_bytes: Option<u64>,
    pub max_session_bytes: Option<u64>,
    pub max_generations_retained: Option<u64>,
}

impl SessionResourceLimits {
    /// A documented, sane ceiling for real interactive use ("do not OOM the
    /// Electron process," mission §4.11). 10M candidates of the widest
    /// (8-byte) type costs 160 MB — comfortably under the 512 MB snapshot
    /// ceiling below, leaving headroom for JS/Electron's own overhead.
    pub fn default_safe() -> Self {
        SessionResourceLimits {
            max_candidates: Some(10_000_000),
            max_snapshot_bytes: Some(512 * 1024 * 1024),
            max_session_bytes: Some(768 * 1024 * 1024),
            max_generations_retained: Some(64),
        }
    }
}

/// The outcome of one refinement (or the initial capture) — the same
/// shape both `create_unknown_initial` and `refine` report through, so a
/// caller (and the napi layer) has one consistent result type regardless
/// of which operation produced it.
#[derive(Debug, Clone)]
pub struct RefineOutcome {
    pub generation: u64,
    pub input_candidate_count: u64,
    pub output_candidate_count: u64,
    pub bytes_reread: u64,
    pub skipped_reads: u64,
    pub completeness: ScanCompleteness,
    pub duration: Duration,
}

/// A native scan-session (mission §4.1). Owns its `ProcessHandle` outright
/// (RAII `Drop` closes it) — never shared with, or re-derived from, any
/// other session or `NativeScanTarget` attach.
pub struct ScanSession {
    handle: ProcessHandle,
    identity: ProcessIdentity,
    primitive_type: PrimitiveType,
    alignment: AlignmentMode,
    chunk_config: ChunkPlanConfig,
    resource_limits: SessionResourceLimits,
    candidates: CandidateStore,
    generation: u64,
    generation_history: Vec<GenerationRecord>,
    last_completeness: ScanCompleteness,
    created_at: Instant,
    last_refined_at: Instant,
}

impl ScanSession {
    pub fn identity(&self) -> ProcessIdentity {
        self.identity
    }

    pub fn primitive_type(&self) -> PrimitiveType {
        self.primitive_type
    }

    pub fn alignment(&self) -> AlignmentMode {
        self.alignment
    }

    /// The chunk policy `UNKNOWN_INITIAL` was captured with — part of the
    /// session model's required fields (mission §4.1's "chunk policy"
    /// bullet), surfaced for status/diagnostics even though `refine`'s own
    /// re-read spans (see `build_read_spans`) use a fixed, independent span
    /// cap rather than this value directly.
    pub fn chunk_config(&self) -> ChunkPlanConfig {
        self.chunk_config
    }

    /// The native resource bounds `UNKNOWN_INITIAL` was created with —
    /// part of the session-snapshot metadata surface (Stage 6 §6.9).
    pub fn resource_limits(&self) -> SessionResourceLimits {
        self.resource_limits
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn candidate_count(&self) -> u64 {
        self.candidates.len() as u64
    }

    pub fn candidate_memory_bytes(&self) -> u64 {
        self.candidates.memory_bytes()
    }

    pub fn last_completeness(&self) -> &ScanCompleteness {
        &self.last_completeness
    }

    pub fn generation_history(&self) -> &[GenerationRecord] {
        &self.generation_history
    }

    pub fn created_at(&self) -> Instant {
        self.created_at
    }

    pub fn last_refined_at(&self) -> Instant {
        self.last_refined_at
    }

    /// A bounded, deterministically-ordered page of candidates — mission
    /// §4.3/§4.14's "pagination to JS" / "bounded result pages" requirement,
    /// so the napi layer never has to marshal millions of candidates in one
    /// call.
    pub fn candidates_page(&self, offset: u64, limit: u64) -> Vec<(u64, PrimitiveValue)> {
        let len = self.candidates.len() as u64;
        if offset >= len {
            return Vec::new();
        }
        let end = len.min(offset.saturating_add(limit));
        (offset..end)
            .map(|i| {
                let i = i as usize;
                (self.candidates.address(i), self.candidates.value(i))
            })
            .collect()
    }

    /// Confirms the session's target is still the exact process it was
    /// created against (mission §4.2). See the module doc for why this is
    /// sufficient: the held handle can never silently point at a different
    /// process, so "is the handle's process still alive" is the complete
    /// stale-target question for a single already-created session.
    pub fn verify_not_stale(&self) -> ScannerResult<()> {
        match self.handle.status()? {
            HandleStatus::Open => Ok(()),
            HandleStatus::Exited => Err(ScannerError::new(
                ErrorKind::TargetExited,
                format!(
                    "session target pid={} (creation_time_filetime={}) has exited; this session is permanently stale and must be closed",
                    self.identity.pid, self.identity.creation_time_filetime
                ),
            )),
        }
    }

    /// Explicit close (mission §4.15) — for API symmetry/documentation
    /// only. Consuming `self` here drops `handle` (RAII `CloseHandle`) and
    /// `candidates` (ordinary `Vec` deallocation) immediately and
    /// unconditionally; there is no additional native resource this crate
    /// holds that needs a separate release step.
    pub fn close(self) {}

    #[allow(clippy::too_many_arguments)]
    fn record_generation(
        &mut self,
        mode_label: &'static str,
        input_candidate_count: u64,
        output_candidate_count: u64,
        bytes_reread: u64,
        skipped_reads: u64,
        completeness: ScanCompleteness,
        duration: Duration,
    ) {
        self.generation += 1;
        self.last_completeness = completeness.clone();
        self.last_refined_at = Instant::now();
        self.generation_history.push(GenerationRecord {
            generation: self.generation,
            mode_label,
            input_candidate_count,
            output_candidate_count,
            bytes_reread,
            skipped_reads,
            completeness,
            duration,
        });
        if let Some(max) = self.resource_limits.max_generations_retained {
            let len = self.generation_history.len() as u64;
            if len > max {
                self.generation_history.drain(0..(len - max) as usize);
            }
        }
    }

    /// Establishes the baseline snapshot (mission §4.4): captures every
    /// eligible candidate (per `alignment`/`policy`) across every selected
    /// region, storing its address and current value. Does not filter by a
    /// target value — `UNKNOWN_INITIAL` is unconditional capture.
    ///
    /// Takes ownership of `handle` — this is the session's handle for its
    /// entire lifetime (mission §4.1's "process handle ownership" bullet).
    #[allow(clippy::too_many_arguments)]
    pub fn create_unknown_initial(
        handle: ProcessHandle,
        regions: &[Region],
        policy: &RegionSelectionPolicy,
        primitive_type: PrimitiveType,
        alignment: AlignmentMode,
        chunk_config: ChunkPlanConfig,
        resource_limits: SessionResourceLimits,
        cancellation: &CancellationToken,
        mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
    ) -> ScannerResult<(ScanSession, ScanMetrics)> {
        if !matches!(handle.status()?, HandleStatus::Open) {
            return Err(ScannerError::new(
                ErrorKind::TargetExited,
                "cannot create a scan session against an already-exited target",
            ));
        }
        let identity = ProcessIdentity {
            pid: handle.pid(),
            creation_time_filetime: handle.process_creation_time_filetime()?,
        };

        let width = primitive_type.byte_width();
        let mut metrics = ScanMetrics {
            regions_total: regions.len() as u64,
            ..Default::default()
        };
        let (selected, excluded): (Vec<&Region>, Vec<&Region>) = policy.partition(regions);
        metrics.regions_considered = selected.len() as u64;
        metrics.regions_skipped = excluded.len() as u64;

        let mut candidates = CandidateStore::new(primitive_type);
        let mut all_skipped: Vec<SkippedRange> = excluded
            .iter()
            .map(|r| SkippedRange {
                base_address: r.base_address,
                size: r.size,
                reason: SkipReason::PolicyExcluded,
            })
            .collect();
        let mut terminal: Option<ScanCompleteness> = None;

        'regions: for region in selected {
            if cancellation.is_cancelled() {
                terminal = Some(ScanCompleteness::Cancelled {
                    at_byte: region.base_address,
                });
                break;
            }

            let chunks = plan_chunks(region.base_address, region.size, chunk_config)?;
            metrics.chunks_requested += chunks.len() as u64;

            for spec in chunks {
                if cancellation.is_cancelled() {
                    terminal = Some(ScanCompleteness::Cancelled {
                        at_byte: spec.chunk_base,
                    });
                    break 'regions;
                }
                if resource_exhausted(&candidates, &resource_limits) {
                    terminal = Some(ScanCompleteness::ResourceLimit {
                        at_byte: spec.chunk_base,
                    });
                    break 'regions;
                }

                metrics.bytes_requested += spec.requested_size;
                match handle.status()? {
                    HandleStatus::Open => {}
                    HandleStatus::Exited => {
                        terminal = Some(ScanCompleteness::ProcessExited {
                            at_byte: spec.chunk_base,
                        });
                        break 'regions;
                    }
                }

                let read = read_chunk(&handle, &spec);
                metrics.syscall_count += 1;

                let valid_len: usize = match &read.status {
                    ChunkReadStatus::Success => {
                        metrics.chunks_read += 1;
                        metrics.bytes_read += spec.requested_size;
                        read.data.len()
                    }
                    ChunkReadStatus::PartialRead { bytes_read } => {
                        metrics.chunks_partial += 1;
                        metrics.bytes_read += bytes_read;
                        all_skipped.push(SkippedRange {
                            base_address: spec.chunk_base,
                            size: spec.requested_size,
                            reason: SkipReason::PartialRead,
                        });
                        *bytes_read as usize
                    }
                    ChunkReadStatus::AccessDenied => {
                        metrics.chunks_failed += 1;
                        all_skipped.push(SkippedRange {
                            base_address: spec.chunk_base,
                            size: spec.requested_size,
                            reason: SkipReason::AccessDenied,
                        });
                        continue;
                    }
                    ChunkReadStatus::InvalidAddress => {
                        metrics.chunks_failed += 1;
                        all_skipped.push(SkippedRange {
                            base_address: spec.chunk_base,
                            size: spec.requested_size,
                            reason: SkipReason::Unreadable,
                        });
                        continue;
                    }
                    ChunkReadStatus::OsError { .. } => {
                        metrics.chunks_failed += 1;
                        all_skipped.push(SkippedRange {
                            base_address: spec.chunk_base,
                            size: spec.requested_size,
                            reason: SkipReason::OsError,
                        });
                        continue;
                    }
                    ChunkReadStatus::TargetExited => {
                        terminal = Some(ScanCompleteness::ProcessExited {
                            at_byte: spec.chunk_base,
                        });
                        break 'regions;
                    }
                    ChunkReadStatus::ResourceLimit => {
                        terminal = Some(ScanCompleteness::ResourceLimit {
                            at_byte: spec.chunk_base,
                        });
                        break 'regions;
                    }
                    ChunkReadStatus::Cancelled => {
                        terminal = Some(ScanCompleteness::Cancelled {
                            at_byte: spec.chunk_base,
                        });
                        break 'regions;
                    }
                };

                // Skip this chunk's own overlap-before prefix: those bytes
                // (and every full-width candidate that starts within them)
                // were already captured as the tail of the previous chunk,
                // because the previous chunk's `requested_size` already
                // extended `overlap_bytes` past its logical boundary to
                // cover exactly this case (see `chunk.rs`'s `ChunkSpec`
                // doc). This gives single-pass, dedup-free capture — no
                // sort/hash-set pass over what can be a very large
                // candidate set, unlike Stage 3's exact-match scan (whose
                // result sets are filtered down to a handful of matches, so
                // a dedup pass there is cheap; `UNKNOWN_INITIAL`'s result
                // set is, by definition, everything).
                let skip_front = (spec.overlap_before as usize).min(valid_len);
                if valid_len >= width && skip_front <= valid_len - width {
                    for offset in skip_front..=(valid_len - width) {
                        if resource_exhausted(&candidates, &resource_limits) {
                            terminal = Some(ScanCompleteness::ResourceLimit {
                                at_byte: spec.chunk_base + offset as u64,
                            });
                            break 'regions;
                        }
                        let absolute = spec.chunk_base + offset as u64;
                        if alignment == AlignmentMode::AlignedToType
                            && !absolute.is_multiple_of(width as u64)
                        {
                            continue;
                        }
                        if let Some(value) = PrimitiveValue::decode(
                            primitive_type,
                            &read.data[offset..offset + width],
                        ) {
                            candidates.push(absolute, value);
                        }
                    }
                }

                if let Some(cb) = on_progress.as_deref_mut() {
                    cb(&metrics);
                }
            }
        }

        let completeness = match terminal {
            Some(t) => t,
            None if all_skipped.is_empty() => ScanCompleteness::Complete,
            None => ScanCompleteness::CompleteWithSkippedRegions {
                skipped: all_skipped,
            },
        };

        let now = Instant::now();
        let candidate_count = candidates.len() as u64;
        let session = ScanSession {
            handle,
            identity,
            primitive_type,
            alignment,
            chunk_config,
            resource_limits,
            candidates,
            generation: 0,
            generation_history: vec![GenerationRecord {
                generation: 0,
                mode_label: "unknown_initial",
                input_candidate_count: 0,
                output_candidate_count: candidate_count,
                bytes_reread: metrics.bytes_read,
                skipped_reads: 0,
                completeness: completeness.clone(),
                duration: Duration::default(),
            }],
            last_completeness: completeness,
            created_at: now,
            last_refined_at: now,
        };

        Ok((session, metrics))
    }

    /// Re-reads only the current candidates' own addresses and filters by
    /// `mode` (mission §4.5-§4.8). Updates the stored "previous value"
    /// snapshot to each surviving candidate's freshly-read current value
    /// (mission §4.5: "update previous snapshot to current value for the
    /// next refinement" — this session architecture does not keep
    /// per-generation versioned snapshots, a documented, explicit choice).
    pub fn refine(
        &mut self,
        mode: RefineMode,
        cancellation: &CancellationToken,
        mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
    ) -> ScannerResult<RefineOutcome> {
        self.verify_not_stale()?;
        validate_refine_mode(self.primitive_type, &mode)?;

        let start = Instant::now();
        let input_count = self.candidates.len() as u64;
        let width = self.primitive_type.byte_width();
        const MAX_SPAN_BYTES: u64 = 4 * 1024 * 1024;
        let spans = build_read_spans(&self.candidates, width, MAX_SPAN_BYTES);

        let mut metrics = ScanMetrics {
            regions_total: spans.len() as u64,
            regions_considered: spans.len() as u64,
            ..Default::default()
        };
        let mut survivors = CandidateStore::new(self.primitive_type);
        let mut skipped: Vec<SkippedRange> = Vec::new();
        let mut terminal: Option<(ScanCompleteness, usize)> = None; // (state, first-not-examined index)
        let mut skipped_reads: u64 = 0;

        'spans: for (span_start, span_len, first_idx, last_idx) in spans {
            if cancellation.is_cancelled() {
                terminal = Some((
                    ScanCompleteness::Cancelled {
                        at_byte: span_start,
                    },
                    first_idx,
                ));
                break;
            }
            match self.handle.status()? {
                HandleStatus::Open => {}
                HandleStatus::Exited => {
                    terminal = Some((
                        ScanCompleteness::ProcessExited {
                            at_byte: span_start,
                        },
                        first_idx,
                    ));
                    break;
                }
            }

            let spec = ChunkSpec {
                logical_region_base: span_start,
                logical_region_size: span_len,
                chunk_base: span_start,
                requested_size: span_len,
                overlap_before: 0,
                overlap_after: 0,
            };
            let read = read_chunk(&self.handle, &spec);
            metrics.syscall_count += 1;
            metrics.chunks_requested += 1;
            metrics.bytes_requested += span_len;

            let (available, span_readable) = match &read.status {
                ChunkReadStatus::Success => {
                    metrics.chunks_read += 1;
                    metrics.bytes_read += span_len;
                    (read.data.len(), true)
                }
                ChunkReadStatus::PartialRead { bytes_read } => {
                    metrics.chunks_partial += 1;
                    metrics.bytes_read += bytes_read;
                    (*bytes_read as usize, true)
                }
                ChunkReadStatus::TargetExited => {
                    terminal = Some((
                        ScanCompleteness::ProcessExited {
                            at_byte: span_start,
                        },
                        first_idx,
                    ));
                    break 'spans;
                }
                ChunkReadStatus::Cancelled => {
                    terminal = Some((
                        ScanCompleteness::Cancelled {
                            at_byte: span_start,
                        },
                        first_idx,
                    ));
                    break 'spans;
                }
                ChunkReadStatus::ResourceLimit => {
                    terminal = Some((
                        ScanCompleteness::ResourceLimit {
                            at_byte: span_start,
                        },
                        first_idx,
                    ));
                    break 'spans;
                }
                // AccessDenied / InvalidAddress / OsError: this span's
                // candidates could not be re-read at all.
                _ => {
                    metrics.chunks_failed += 1;
                    (0, false)
                }
            };

            if !span_readable {
                let count = (last_idx - first_idx + 1) as u64;
                skipped_reads += count;
                skipped.push(SkippedRange {
                    base_address: span_start,
                    size: span_len,
                    reason: SkipReason::AccessDenied,
                });
            }

            for idx in first_idx..=last_idx {
                let addr = self.candidates.address(idx);
                let previous = self.candidates.value(idx);
                let local_offset = (addr - span_start) as usize;
                let readable = span_readable && local_offset + width <= available;
                if !readable {
                    if span_readable {
                        // The span read succeeded but was short
                        // (`PartialRead`) and this specific candidate's
                        // bytes fell past the OS-reported boundary.
                        skipped_reads += 1;
                        skipped.push(SkippedRange {
                            base_address: addr,
                            size: width as u64,
                            reason: SkipReason::PartialRead,
                        });
                    }
                    // Dropped, not deferred (mission §4.10's explicit
                    // policy choice, documented in Docs/phase1/28): a
                    // candidate this refinement could not re-read is
                    // excluded from the surviving set rather than carried
                    // forward with a stale, unverified value or silently
                    // counted as "did not match." Its exclusion is always
                    // visible via `skipped_reads` and a non-`Complete`
                    // completeness, never silent.
                    continue;
                }
                let current = PrimitiveValue::decode(
                    self.primitive_type,
                    &read.data[local_offset..local_offset + width],
                )
                .expect("candidate width matches session primitive type by construction");
                if candidate_survives(&mode, &previous, &current) {
                    survivors.push(addr, current);
                }
            }

            if let Some(cb) = on_progress.as_deref_mut() {
                cb(&metrics);
            }
        }

        // A cancellation/process-exit/resource-limit stops examination
        // partway through the candidate list. Every candidate *before* the
        // interruption point has already been decided (survived, was
        // filtered out, or was dropped as unreadable, all recorded above).
        // Every candidate *at or after* it was never examined at all — this
        // session carries those forward completely unchanged (their
        // existing stored address/value), rather than silently discarding
        // them, so a cancelled refinement never loses candidates it simply
        // never got to (mission §4.10's "no false certainty" principle,
        // applied to cancellation as well as to read failure).
        let completeness = if let Some((state, not_examined_from)) = terminal {
            for idx in not_examined_from..self.candidates.len() {
                survivors.push(self.candidates.address(idx), self.candidates.value(idx));
            }
            state
        } else if skipped.is_empty() {
            ScanCompleteness::Complete
        } else {
            ScanCompleteness::CompleteWithSkippedRegions { skipped }
        };

        let output_count = survivors.len() as u64;
        let duration = start.elapsed();
        self.candidates = survivors;
        self.record_generation(
            mode.label(),
            input_count,
            output_count,
            metrics.bytes_read,
            skipped_reads,
            completeness.clone(),
            duration,
        );

        Ok(RefineOutcome {
            generation: self.generation,
            input_candidate_count: input_count,
            output_candidate_count: output_count,
            bytes_reread: metrics.bytes_read,
            skipped_reads,
            completeness,
            duration,
        })
    }
}

fn resource_exhausted(candidates: &CandidateStore, limits: &SessionResourceLimits) -> bool {
    if let Some(max) = limits.max_candidates {
        if candidates.len() as u64 >= max {
            return true;
        }
    }
    if let Some(max_bytes) = limits.max_snapshot_bytes {
        if candidates.memory_bytes() >= max_bytes {
            return true;
        }
    }
    if let Some(max_bytes) = limits.max_session_bytes {
        if candidates.memory_bytes() >= max_bytes {
            return true;
        }
    }
    false
}

/// Groups a sorted candidate address list into contiguous-or-nearby read
/// spans, each covering every candidate address it contains plus its full
/// value width, greedily capped at `max_span_bytes` so one pathologically
/// spread-out candidate set can't force an unbounded single read. Returns
/// `(span_start, span_len, first_candidate_index, last_candidate_index)`
/// tuples in ascending order.
///
/// Grouping nearby candidates into one `ReadProcessMemory` call is what
/// keeps refinement throughput close to Stage 2/3's chunked-read profile
/// rather than paying one syscall per candidate, which would dominate cost
/// for a large, sparse candidate set. The trade-off (documented in
/// Docs/phase1/33) is real: for a very sparse candidate set, this can read
/// and discard "wasted" bytes between far-apart candidates, bounded by
/// `max_span_bytes` per span — a legitimate first cut given real evidence
/// from Stage 2/3 that syscall count, not bytes read, dominates real-machine
/// cost. A future stage could pick a per-span strategy from measured
/// density instead of the fixed cap used here.
fn build_read_spans(
    candidates: &CandidateStore,
    width: usize,
    max_span_bytes: u64,
) -> Vec<(u64, u64, usize, usize)> {
    let mut spans = Vec::new();
    let len = candidates.len();
    if len == 0 {
        return spans;
    }

    let mut span_start = candidates.address(0);
    let mut span_end = span_start + width as u64; // exclusive
    let mut first_idx = 0usize;

    for i in 1..len {
        let addr = candidates.address(i);
        let addr_end = addr + width as u64;
        let candidate_total_len = addr_end.saturating_sub(span_start);
        if candidate_total_len <= max_span_bytes {
            span_end = span_end.max(addr_end);
        } else {
            spans.push((span_start, span_end - span_start, first_idx, i - 1));
            span_start = addr;
            span_end = addr_end;
            first_idx = i;
        }
    }
    spans.push((span_start, span_end - span_start, first_idx, len - 1));
    spans
}

fn validate_refine_mode(primitive_type: PrimitiveType, mode: &RefineMode) -> ScannerResult<()> {
    match mode {
        RefineMode::IncreasedBy(delta) | RefineMode::DecreasedBy(delta) => {
            if delta.primitive_type() != primitive_type {
                return Err(ScannerError::new(
                    ErrorKind::InvalidConfiguration,
                    format!(
                        "delta type {} does not match session primitive type {primitive_type}",
                        delta.primitive_type()
                    ),
                ));
            }
            Ok(())
        }
        RefineMode::Between(min, max) => {
            if min.primitive_type() != primitive_type || max.primitive_type() != primitive_type {
                return Err(ScannerError::new(
                    ErrorKind::InvalidConfiguration,
                    "between bounds must match the session's primitive type",
                ));
            }
            if min.is_nan() || max.is_nan() {
                return Err(ScannerError::new(
                    ErrorKind::InvalidConfiguration,
                    "between bounds must not be NaN",
                ));
            }
            match min.compare_ordered(max) {
                Some(Ordering::Greater) => Err(ScannerError::new(
                    ErrorKind::InvalidConfiguration,
                    "between requires min <= max",
                )),
                _ => Ok(()),
            }
        }
        RefineMode::Changed
        | RefineMode::Unchanged
        | RefineMode::Increased
        | RefineMode::Decreased => Ok(()),
    }
}

/// The one, explicit definition of "does this candidate survive `mode`,"
/// given its previous snapshot and freshly-read current value (mission
/// §4.5-§4.8). See each `RefineMode` variant's own doc reference above for
/// the NaN/overflow/signedness policy this implements.
fn candidate_survives(
    mode: &RefineMode,
    previous: &PrimitiveValue,
    current: &PrimitiveValue,
) -> bool {
    match mode {
        RefineMode::Changed => !current.eq_exact(previous),
        RefineMode::Unchanged => current.eq_exact(previous),
        RefineMode::Increased => {
            matches!(current.compare_ordered(previous), Some(Ordering::Greater))
        }
        RefineMode::Decreased => matches!(current.compare_ordered(previous), Some(Ordering::Less)),
        RefineMode::IncreasedBy(delta) => previous
            .checked_increase_by(delta)
            .map(|expected| current.eq_exact(&expected))
            .unwrap_or(false),
        RefineMode::DecreasedBy(delta) => previous
            .checked_decrease_by(delta)
            .map(|expected| current.eq_exact(&expected))
            .unwrap_or(false),
        RefineMode::Between(min, max) => {
            matches!(
                current.compare_ordered(min),
                Some(Ordering::Greater) | Some(Ordering::Equal)
            ) && matches!(
                current.compare_ordered(max),
                Some(Ordering::Less) | Some(Ordering::Equal)
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_with(values: &[(u64, i32)]) -> CandidateStore {
        let mut store = CandidateStore::new(PrimitiveType::I32);
        for (addr, v) in values {
            store.push(*addr, PrimitiveValue::I32(*v));
        }
        store
    }

    #[test]
    fn candidate_store_round_trips_address_and_value() {
        let store = store_with(&[(0x1000, 42), (0x2000, -7), (0x3000, 0)]);
        assert_eq!(store.len(), 3);
        assert_eq!(store.address(1), 0x2000);
        assert!(matches!(store.value(1), PrimitiveValue::I32(-7)));
    }

    #[test]
    fn candidate_store_memory_bytes_matches_documented_formula() {
        let store = store_with(&[(0x1000, 1), (0x2000, 2)]);
        // i32 width 4: n * (8 + 4) = 2 * 12 = 24.
        assert_eq!(store.memory_bytes(), 24);
    }

    #[test]
    fn build_read_spans_merges_nearby_and_splits_far_candidates() {
        let store = store_with(&[(0x1000, 1), (0x1004, 2), (0x1008, 3), (0x100_0000, 4)]);
        let spans = build_read_spans(&store, 4, 4096);
        assert_eq!(spans.len(), 2, "nearby trio one span, far one its own span");
        assert_eq!(spans[0].2, 0);
        assert_eq!(spans[0].3, 2);
        assert_eq!(spans[1].2, 3);
        assert_eq!(spans[1].3, 3);
    }

    #[test]
    fn build_read_spans_caps_span_length() {
        // Two candidates 1 MiB apart with a 4 KiB cap must not merge.
        let store = store_with(&[(0, 1), (1_048_576, 2)]);
        let spans = build_read_spans(&store, 4, 4096);
        assert_eq!(spans.len(), 2);
    }

    #[test]
    fn changed_unchanged_are_exact_and_mutually_exclusive_for_integers() {
        let a = PrimitiveValue::I32(5);
        let b = PrimitiveValue::I32(6);
        assert!(candidate_survives(&RefineMode::Changed, &a, &b));
        assert!(!candidate_survives(&RefineMode::Unchanged, &a, &b));
        assert!(!candidate_survives(&RefineMode::Changed, &a, &a));
        assert!(candidate_survives(&RefineMode::Unchanged, &a, &a));
    }

    #[test]
    fn nan_is_always_changed_and_never_unchanged_even_against_itself() {
        let nan = PrimitiveValue::F64(f64::NAN);
        assert!(candidate_survives(&RefineMode::Changed, &nan, &nan));
        assert!(!candidate_survives(&RefineMode::Unchanged, &nan, &nan));
    }

    #[test]
    fn increased_decreased_respect_signedness() {
        let neg = PrimitiveValue::I8(-5);
        let pos = PrimitiveValue::I8(5);
        // -5 -> 5 is an increase for a signed type.
        assert!(candidate_survives(&RefineMode::Increased, &neg, &pos));
        assert!(!candidate_survives(&RefineMode::Decreased, &neg, &pos));

        let u_lo = PrimitiveValue::U8(5);
        let u_hi = PrimitiveValue::U8(250);
        assert!(candidate_survives(&RefineMode::Increased, &u_lo, &u_hi));
    }

    #[test]
    fn increased_decreased_never_match_when_either_side_is_nan() {
        let nan = PrimitiveValue::F32(f32::NAN);
        let one = PrimitiveValue::F32(1.0);
        assert!(!candidate_survives(&RefineMode::Increased, &nan, &one));
        assert!(!candidate_survives(&RefineMode::Increased, &one, &nan));
        assert!(!candidate_survives(&RefineMode::Decreased, &nan, &one));
    }

    #[test]
    fn increased_by_uses_checked_arithmetic_not_wrapping() {
        let previous = PrimitiveValue::U8(250);
        let delta = PrimitiveValue::U8(10);
        // 250 + 10 = 260, overflows u8 -> must never compare equal to a
        // wrapped 4, so no observed "current" value can satisfy this.
        let wrapped_current = PrimitiveValue::U8(4);
        assert!(!candidate_survives(
            &RefineMode::IncreasedBy(delta),
            &previous,
            &wrapped_current
        ));

        let previous_ok = PrimitiveValue::U8(100);
        let expected = PrimitiveValue::U8(110);
        assert!(candidate_survives(
            &RefineMode::IncreasedBy(delta),
            &previous_ok,
            &expected
        ));
    }

    #[test]
    fn decreased_by_rejects_underflow_for_unsigned() {
        let previous = PrimitiveValue::U8(3);
        let delta = PrimitiveValue::U8(10);
        // 3 - 10 underflows u8 -> checked_sub is None -> never matches.
        assert!(!candidate_survives(
            &RefineMode::DecreasedBy(delta),
            &previous,
            &PrimitiveValue::U8(250)
        ));
    }

    #[test]
    fn between_is_inclusive_on_both_ends() {
        let min = PrimitiveValue::I32(10);
        let max = PrimitiveValue::I32(20);
        let mode = RefineMode::Between(min, max);
        let unused_previous = PrimitiveValue::I32(0);
        assert!(candidate_survives(
            &mode,
            &unused_previous,
            &PrimitiveValue::I32(10)
        ));
        assert!(candidate_survives(
            &mode,
            &unused_previous,
            &PrimitiveValue::I32(20)
        ));
        assert!(candidate_survives(
            &mode,
            &unused_previous,
            &PrimitiveValue::I32(15)
        ));
        assert!(!candidate_survives(
            &mode,
            &unused_previous,
            &PrimitiveValue::I32(9)
        ));
        assert!(!candidate_survives(
            &mode,
            &unused_previous,
            &PrimitiveValue::I32(21)
        ));
    }

    #[test]
    fn validate_refine_mode_rejects_inverted_between_bounds() {
        let err = validate_refine_mode(
            PrimitiveType::I32,
            &RefineMode::Between(PrimitiveValue::I32(20), PrimitiveValue::I32(10)),
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }

    #[test]
    fn validate_refine_mode_rejects_nan_between_bounds() {
        let err = validate_refine_mode(
            PrimitiveType::F64,
            &RefineMode::Between(PrimitiveValue::F64(f64::NAN), PrimitiveValue::F64(10.0)),
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }

    #[test]
    fn validate_refine_mode_rejects_mismatched_delta_type() {
        let err = validate_refine_mode(
            PrimitiveType::I32,
            &RefineMode::IncreasedBy(PrimitiveValue::U8(1)),
        )
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }

    /// Property-style test (mission §4.16): arbitrary previous/current pairs
    /// for INCREASED/DECREASED must always agree with a direct signed
    /// comparison on the underlying i64 widening — deterministic seed, same
    /// no-proptest-dependency style as chunk.rs/exact_scan.rs's own
    /// property tests.
    #[test]
    fn arbitrary_signed_pairs_agree_with_direct_comparison() {
        struct Xorshift64(u64);
        impl Xorshift64 {
            fn next(&mut self) -> u64 {
                let mut x = self.0;
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                self.0 = x;
                x
            }
        }
        let mut rng = Xorshift64(0x9E3779B97F4A7C15);
        for _ in 0..500 {
            let a = (rng.next() % 200) as i32 - 100;
            let b = (rng.next() % 200) as i32 - 100;
            let pa = PrimitiveValue::I32(a);
            let pb = PrimitiveValue::I32(b);
            assert_eq!(candidate_survives(&RefineMode::Increased, &pa, &pb), b > a);
            assert_eq!(candidate_survives(&RefineMode::Decreased, &pa, &pb), b < a);
        }
    }
}
