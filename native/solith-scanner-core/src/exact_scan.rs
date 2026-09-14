//! Exact primitive-value scan engine (Stage 3, mission §3.3).
//!
//! Built directly on Stage 2's chunk planner (`chunk.rs`) and single-chunk
//! reader (`reader.rs::read_chunk`), but with its own orchestration loop
//! rather than reusing `read_region_chunked`: a value scan only needs to
//! retain matches (a handful of bytes each), never the full chunk buffer,
//! so this loop decodes-and-drops each chunk's bytes immediately (mission
//! §3.8's scalability requirement) instead of accumulating
//! `Vec<ChunkReadResult>` the way Stage 2's generic reader does for its own
//! (deliberately byte-preserving) contract.

use std::collections::HashSet;

use crate::chunk::{plan_chunks, ChunkPlanConfig};
use crate::completeness::{ScanCompleteness, ScanMetrics, SkipReason, SkippedRange};
use crate::error::{ErrorKind, ScannerError, ScannerResult};
use crate::policy::RegionSelectionPolicy;
use crate::reader::{read_chunk, ChunkReadStatus};
use crate::region::Region;
use crate::target::{HandleStatus, ProcessHandle};
use crate::types::{PrimitiveType, PrimitiveValue};
use crate::CancellationToken;

/// Bytewise (default) scans every byte offset; AlignedToType scans only
/// offsets whose *absolute address* is a multiple of the primitive's byte
/// width. Mission §3.4: the previous TypeScript scanner's forced-4-byte
/// stride defect must not exist here — `Bytewise` is the default, and
/// `AlignedToType` is measured against each primitive's own width, not a
/// hardcoded 4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AlignmentMode {
    #[default]
    Bytewise,
    AlignedToType,
}

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub alignment: AlignmentMode,
    pub chunk_config: ChunkPlanConfig,
    /// Caps the number of matches retained/returned. Reaching this limit
    /// produces `ScanCompleteness::ResourceLimit`, never `Complete` —
    /// mission §3.9.
    pub max_results: Option<u64>,
}

impl ScanOptions {
    /// A sane default for a given primitive type: bytewise alignment, a
    /// chunk config whose overlap is automatically widened to at least
    /// `primitive_type.byte_width() - 1` (the mission's required
    /// relationship, enforced here rather than left to the caller to get
    /// right), and no result cap.
    pub fn default_for(primitive_type: PrimitiveType, chunk_size_bytes: u64) -> Self {
        let min_overlap = (primitive_type.byte_width() as u64).saturating_sub(1);
        ScanOptions {
            alignment: AlignmentMode::default(),
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes,
                overlap_bytes: min_overlap,
            },
            max_results: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ScanMatch {
    pub address: u64,
    pub value: PrimitiveValue,
}

#[derive(Debug)]
pub struct ExactScanResult {
    pub matches: Vec<ScanMatch>,
    pub completeness: ScanCompleteness,
    pub metrics: ScanMetrics,
}

fn validate_options(primitive_type: PrimitiveType, options: &ScanOptions) -> ScannerResult<()> {
    let width = primitive_type.byte_width() as u64;
    let min_overlap = width.saturating_sub(1);
    if options.chunk_config.overlap_bytes < min_overlap {
        return Err(ScannerError::new(
            ErrorKind::InvalidConfiguration,
            format!(
                "overlap_bytes ({}) must be >= primitive width - 1 ({}) for {primitive_type} scans, or a value spanning a chunk boundary would be missed",
                options.chunk_config.overlap_bytes, min_overlap
            ),
        ));
    }
    Ok(())
}

/// Decodes and compares every valid candidate offset in `buf` (bytes
/// starting at absolute address `chunk_base`) against `target`, per
/// `alignment`. Pushes `(absolute_address, value)` for every exact match —
/// duplicates across chunk overlap are expected here and removed once by
/// the caller after all chunks are processed (see `scan_exact_region`).
///
/// Stops early once `out.len()` reaches `max_total` (if set) — a
/// within-buffer early exit so a single chunk containing far more hits
/// than a caller's `max_results` budget cannot force the scan to
/// decode/allocate past that budget before the next resource-limit check
/// runs (mission §3.8's memory-accounting / §3.9's resource-limit
/// requirements: bounded, not "collect everything then truncate").
#[allow(clippy::too_many_arguments)]
fn scan_buffer_for_matches_bounded(
    chunk_base: u64,
    buf: &[u8],
    primitive_type: PrimitiveType,
    target: &PrimitiveValue,
    alignment: AlignmentMode,
    out: &mut Vec<ScanMatch>,
    max_total: Option<u64>,
) {
    let width = primitive_type.byte_width();
    if buf.len() < width {
        return;
    }
    for offset in 0..=(buf.len() - width) {
        if let Some(max) = max_total {
            if out.len() as u64 >= max {
                return;
            }
        }
        let absolute = chunk_base + offset as u64;
        if alignment == AlignmentMode::AlignedToType && !absolute.is_multiple_of(width as u64) {
            continue;
        }
        let candidate_bytes = &buf[offset..offset + width];
        if let Some(value) = PrimitiveValue::decode(primitive_type, candidate_bytes) {
            if value.eq_exact(target) {
                out.push(ScanMatch {
                    address: absolute,
                    value,
                });
            }
        }
    }
}

/// Scans one region. Returns raw (possibly overlap-duplicated) matches
/// plus the region's own skip list and metrics contribution — deduplication
/// and the region-vs-scan-wide completeness decision happen one level up
/// in `scan_exact`, matching `reader.rs`'s existing region/multi-region
/// split (doc 13).
#[allow(clippy::too_many_arguments)]
fn scan_exact_region(
    handle: &ProcessHandle,
    region: &Region,
    primitive_type: PrimitiveType,
    target: &PrimitiveValue,
    options: &ScanOptions,
    cancellation: &CancellationToken,
    metrics: &mut ScanMetrics,
    mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
) -> ScannerResult<(Vec<ScanMatch>, ScanCompleteness)> {
    let chunks = plan_chunks(region.base_address, region.size, options.chunk_config)?;
    metrics.chunks_requested += chunks.len() as u64;

    let mut matches = Vec::new();
    let mut skipped: Vec<SkippedRange> = Vec::new();

    for spec in chunks {
        if cancellation.is_cancelled() {
            return Ok((
                matches,
                ScanCompleteness::Cancelled {
                    at_byte: spec.chunk_base,
                },
            ));
        }
        if let Some(max) = options.max_results {
            if matches.len() as u64 >= max {
                return Ok((
                    matches,
                    ScanCompleteness::ResourceLimit {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
        }

        metrics.bytes_requested += spec.requested_size;

        match handle.status() {
            Ok(HandleStatus::Open) => {}
            _ => {
                return Ok((
                    matches,
                    ScanCompleteness::ProcessExited {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
        }

        let read = read_chunk(handle, &spec);
        metrics.syscall_count += 1;

        match &read.status {
            ChunkReadStatus::Success => {
                metrics.chunks_read += 1;
                metrics.bytes_read += spec.requested_size;
                scan_buffer_for_matches_bounded(
                    spec.chunk_base,
                    &read.data,
                    primitive_type,
                    target,
                    options.alignment,
                    &mut matches,
                    options.max_results,
                );
            }
            ChunkReadStatus::PartialRead { bytes_read } => {
                metrics.chunks_partial += 1;
                metrics.bytes_read += bytes_read;
                scan_buffer_for_matches_bounded(
                    spec.chunk_base,
                    &read.data,
                    primitive_type,
                    target,
                    options.alignment,
                    &mut matches,
                    options.max_results,
                );
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
                return Ok((
                    matches,
                    ScanCompleteness::ProcessExited {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
            ChunkReadStatus::ResourceLimit => {
                return Ok((
                    matches,
                    ScanCompleteness::ResourceLimit {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
            ChunkReadStatus::Cancelled => {
                return Ok((
                    matches,
                    ScanCompleteness::Cancelled {
                        at_byte: spec.chunk_base,
                    },
                ));
            }
        }

        if let Some(cb) = on_progress.as_deref_mut() {
            cb(metrics);
        }
    }

    if skipped.is_empty() {
        Ok((matches, ScanCompleteness::Complete))
    } else {
        Ok((
            matches,
            ScanCompleteness::CompleteWithSkippedRegions { skipped },
        ))
    }
}

/// Scans every region selected by `policy` for an exact match of `target`
/// (typed `primitive_type`). Deduplicates overlap-boundary double-hits
/// deterministically (sort by address, remove exact duplicates — mission
/// §3.5's explicit requirement), and propagates completeness per mission
/// §3.10's rules: any non-`Complete` region-level or scan-wide outcome
/// (skipped regions, cancellation, process exit, resource limit) prevents
/// the overall result from claiming `Complete`, so a caller can always
/// distinguish "no matches in the memory actually scanned" from
/// "authoritatively not found."
#[allow(clippy::too_many_arguments)]
pub fn scan_exact(
    handle: &ProcessHandle,
    regions: &[Region],
    policy: &RegionSelectionPolicy,
    primitive_type: PrimitiveType,
    target: PrimitiveValue,
    options: &ScanOptions,
    cancellation: &CancellationToken,
    mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
) -> ScannerResult<ExactScanResult> {
    validate_options(primitive_type, options)?;

    let mut metrics = ScanMetrics {
        regions_total: regions.len() as u64,
        ..Default::default()
    };
    let (selected, excluded): (Vec<&Region>, Vec<&Region>) = policy.partition(regions);
    metrics.regions_considered = selected.len() as u64;
    metrics.regions_skipped = excluded.len() as u64;

    let mut all_raw_matches: Vec<ScanMatch> = Vec::new();
    let mut all_skipped: Vec<SkippedRange> = excluded
        .iter()
        .map(|r| SkippedRange {
            base_address: r.base_address,
            size: r.size,
            reason: SkipReason::PolicyExcluded,
        })
        .collect();
    let mut terminal: Option<ScanCompleteness> = None;

    for region in selected {
        if cancellation.is_cancelled() {
            terminal = Some(ScanCompleteness::Cancelled {
                at_byte: region.base_address,
            });
            break;
        }

        let progress_arg: Option<&mut dyn FnMut(&ScanMetrics)> = match &mut on_progress {
            Some(cb) => Some(&mut **cb),
            None => None,
        };

        let (matches, completeness) = scan_exact_region(
            handle,
            region,
            primitive_type,
            &target,
            options,
            cancellation,
            &mut metrics,
            progress_arg,
        )?;
        all_raw_matches.extend(matches);

        match completeness {
            ScanCompleteness::Complete => {
                metrics.regions_read += 1;
            }
            ScanCompleteness::CompleteWithSkippedRegions { skipped } => {
                metrics.regions_read += 1;
                all_skipped.extend(skipped);
            }
            other => {
                terminal = Some(other);
                break;
            }
        }
    }

    // Deterministic deduplication: sort by address, then drop consecutive
    // duplicates. Two chunks' overlap zone can each independently decode
    // the same absolute address to the same value — same address implies
    // same underlying bytes implies same decoded value, so deduping by
    // address alone is sufficient and never discards a genuinely distinct
    // candidate.
    all_raw_matches.sort_by_key(|m| m.address);
    let mut seen = HashSet::with_capacity(all_raw_matches.len());
    let mut deduped = Vec::with_capacity(all_raw_matches.len());
    for m in all_raw_matches {
        if seen.insert(m.address) {
            deduped.push(m);
        }
    }

    // Base completeness from how the region loop ended: a terminal state
    // (Cancelled/ProcessExited/ResourceLimit from an inner region) takes
    // precedence; otherwise Complete or CompleteWithSkippedRegions from the
    // accumulated skip list.
    let mut completeness = match terminal {
        Some(t) => t,
        None if all_skipped.is_empty() => ScanCompleteness::Complete,
        None => ScanCompleteness::CompleteWithSkippedRegions {
            skipped: all_skipped,
        },
    };

    // The max_results cap is enforced here unconditionally: deduplication
    // across regions/chunks can only ever reduce the raw count, so a
    // per-region early-return that already hit (and likely overshot) the
    // budget must still be trimmed down to exactly `max_results` in the
    // final, caller-visible result (mission §3.8's bounded-result-model
    // requirement) — and the completeness must say ResourceLimit rather
    // than silently returning a truncated set under a `Complete` or
    // `CompleteWithSkippedRegions` label. Cancelled/ProcessExited are kept
    // as the reported reason even if truncation also applies, since they
    // describe *why* the scan stopped, which is more specific information
    // than "too many results" and must not be overwritten by it.
    if let Some(max) = options.max_results {
        if deduped.len() as u64 > max {
            deduped.truncate(max as usize);
            if !matches!(
                completeness,
                ScanCompleteness::Cancelled { .. } | ScanCompleteness::ProcessExited { .. }
            ) {
                completeness = ScanCompleteness::ResourceLimit {
                    at_byte: deduped.last().map(|m| m.address).unwrap_or(0),
                };
            }
        }
    }

    Ok(ExactScanResult {
        matches: deduped,
        completeness,
        metrics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytewise_finds_u32_at_every_offset_including_unaligned() {
        // Mission §3.4's exact required example: a u32 value at
        // 0x1000..0x1003 must all be discoverable in bytewise mode.
        let target = PrimitiveValue::U32(0xDEADBEEF);
        let mut buf = vec![0u8; 16];
        // Plant the same value at offset 3 (absolute 0x1003, unaligned).
        target.encode_into(&mut buf[3..7]);

        let mut out = Vec::new();
        scan_buffer_for_matches_bounded(
            0x1000,
            &buf,
            PrimitiveType::U32,
            &target,
            AlignmentMode::Bytewise,
            &mut out,
            None,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].address, 0x1003);
    }

    #[test]
    fn aligned_mode_finds_only_type_aligned_offsets() {
        let target = PrimitiveValue::U32(0xCAFEBABE);
        let mut buf = vec![0u8; 16];
        target.encode_into(&mut buf[1..5]); // unaligned relative to base 0x1000

        let mut out = Vec::new();
        // Base itself is 4-aligned (0x1000); planting at local offset 1
        // means absolute address 0x1001, which is NOT 4-aligned.
        scan_buffer_for_matches_bounded(
            0x1000,
            &buf,
            PrimitiveType::U32,
            &target,
            AlignmentMode::AlignedToType,
            &mut out,
            None,
        );
        assert!(
            out.is_empty(),
            "aligned mode must not report an unaligned candidate"
        );

        let mut buf2 = vec![0u8; 16];
        target.encode_into(&mut buf2[4..8]); // absolute 0x1004, 4-aligned
        let mut out2 = Vec::new();
        scan_buffer_for_matches_bounded(
            0x1000,
            &buf2,
            PrimitiveType::U32,
            &target,
            AlignmentMode::AlignedToType,
            &mut out2,
            None,
        );
        assert_eq!(out2.len(), 1);
        assert_eq!(out2[0].address, 0x1004);
    }

    #[test]
    fn aligned_mode_uses_absolute_address_not_chunk_relative_offset() {
        // A chunk_base that is itself NOT type-aligned (0x1002 for a u32
        // scan) must still compute alignment from the absolute address, not
        // from the chunk-relative offset — offset 2 within this chunk is
        // absolute 0x1004, which IS 4-aligned, even though offset 2 itself
        // is not a multiple of 4.
        let target = PrimitiveValue::U32(0x11223344);
        let mut buf = vec![0u8; 16];
        target.encode_into(&mut buf[2..6]);
        let mut out = Vec::new();
        scan_buffer_for_matches_bounded(
            0x1002,
            &buf,
            PrimitiveType::U32,
            &target,
            AlignmentMode::AlignedToType,
            &mut out,
            None,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].address, 0x1004);
    }

    #[test]
    fn no_hidden_four_byte_stride_for_non_four_byte_types() {
        // u16 target at an odd absolute offset must be found in bytewise
        // mode — proves there is no hardcoded 4-byte step anywhere in the
        // scan loop, independent of the AlignmentMode tests above.
        let target = PrimitiveValue::U16(0xBEEF);
        let mut buf = vec![0u8; 8];
        target.encode_into(&mut buf[3..5]); // absolute 0x1003
        let mut out = Vec::new();
        scan_buffer_for_matches_bounded(
            0x1000,
            &buf,
            PrimitiveType::U16,
            &target,
            AlignmentMode::Bytewise,
            &mut out,
            None,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].address, 0x1003);
    }

    #[test]
    fn decoy_byte_patterns_do_not_produce_false_positives() {
        let target = PrimitiveValue::I32(999999);
        let mut buf = vec![0xAAu8; 64]; // no occurrence of the target anywhere
        let mut out = Vec::new();
        scan_buffer_for_matches_bounded(
            0x2000,
            &buf,
            PrimitiveType::I32,
            &target,
            AlignmentMode::Bytewise,
            &mut out,
            None,
        );
        assert!(out.is_empty());

        // Now plant it once, confirm exactly one hit despite the noise.
        target.encode_into(&mut buf[40..44]);
        let mut out2 = Vec::new();
        scan_buffer_for_matches_bounded(
            0x2000,
            &buf,
            PrimitiveType::I32,
            &target,
            AlignmentMode::Bytewise,
            &mut out2,
            None,
        );
        assert_eq!(out2.len(), 1);
        assert_eq!(out2[0].address, 0x2028);
    }

    #[test]
    fn validate_options_rejects_insufficient_overlap_for_primitive_width() {
        let opts = ScanOptions {
            alignment: AlignmentMode::Bytewise,
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes: 4096,
                overlap_bytes: 3,
            },
            max_results: None,
        };
        let err = validate_options(PrimitiveType::U64, &opts).unwrap_err(); // needs overlap >= 7
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);

        let ok_opts = ScanOptions {
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes: 4096,
                overlap_bytes: 7,
            },
            ..opts
        };
        validate_options(PrimitiveType::U64, &ok_opts).unwrap();
    }

    #[test]
    fn default_for_widens_overlap_to_primitive_width_minus_one() {
        let opts = ScanOptions::default_for(PrimitiveType::U64, 4096);
        assert_eq!(opts.chunk_config.overlap_bytes, 7);
        let opts8 = ScanOptions::default_for(PrimitiveType::U8, 4096);
        assert_eq!(opts8.chunk_config.overlap_bytes, 0);
    }

    /// Property-style test (mission §3.12): arbitrary offsets across a
    /// range of widths/alignments, deterministic seed, no proptest
    /// dependency needed (same rationale as chunk.rs's own property test).
    #[test]
    fn arbitrary_offsets_and_widths_are_found_without_false_positives_or_negatives() {
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
            fn range(&mut self, lo: u64, hi_inclusive: u64) -> u64 {
                lo + (self.next() % (hi_inclusive - lo + 1))
            }
        }

        let mut rng = Xorshift64(0xD1B54A32D192ED03);
        let types = PrimitiveType::ALL;

        for _ in 0..500 {
            let pt = types[(rng.next() % types.len() as u64) as usize];
            let width = pt.byte_width();
            let buf_len = rng.range(width as u64 + 1, 256) as usize;
            let plant_offset = rng.range(0, (buf_len - width) as u64) as usize;
            let base = rng.range(0, 1_000_000);

            let mut buf = vec![0u8; buf_len];
            for b in buf.iter_mut() {
                *b = (rng.next() & 0xFF) as u8;
            }
            let target = match pt {
                PrimitiveType::I8 => PrimitiveValue::I8(42),
                PrimitiveType::U8 => PrimitiveValue::U8(200),
                PrimitiveType::I16 => PrimitiveValue::I16(-1234),
                PrimitiveType::U16 => PrimitiveValue::U16(54321),
                PrimitiveType::I32 => PrimitiveValue::I32(-123456789),
                PrimitiveType::U32 => PrimitiveValue::U32(3_000_000_000),
                PrimitiveType::I64 => PrimitiveValue::I64(-9_000_000_000_000_000_000),
                PrimitiveType::U64 => PrimitiveValue::U64(18_000_000_000_000_000_000),
                PrimitiveType::F32 => PrimitiveValue::F32(1234.5678),
                PrimitiveType::F64 => PrimitiveValue::F64(9876.54321),
            };
            target.encode_into(&mut buf[plant_offset..plant_offset + width]);

            let mut out = Vec::new();
            scan_buffer_for_matches_bounded(
                base,
                &buf,
                pt,
                &target,
                AlignmentMode::Bytewise,
                &mut out,
                None,
            );

            let expected_address = base + plant_offset as u64;
            assert!(
                out.iter().any(|m| m.address == expected_address),
                "planted {pt} value at offset {plant_offset} (buf_len {buf_len}) not found"
            );
            // Every reported hit must genuinely decode to the target — no
            // false positives from misaligned noise coincidentally matching.
            for m in &out {
                assert!(m.value.eq_exact(&target));
            }
        }
    }
}
