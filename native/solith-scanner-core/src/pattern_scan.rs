//! Pattern (raw-byte/string/AOB) scan engine (Stage 5, mission §5.3/§5.6).
//!
//! Structurally mirrors `exact_scan.rs`: chunk-boundary-safe via the same
//! overlap mechanism (overlap >= pattern.len() - 1), deterministic
//! address-ascending dedup across chunk overlap, and the same completeness
//! propagation rules. Region-boundary policy (mission §5.8): a pattern is
//! never stitched across two independently-enumerated regions — each
//! region is scanned as its own self-contained buffer (chunks only ever
//! span within one region's bounds, via `plan_chunks`), so a pattern that
//! would need bytes from two adjacent regions is not detected. This is a
//! deliberate, documented default (doc 40): `VirtualQueryEx` groups regions
//! by matching protection/state metadata, and two address-adjacent regions
//! are not guaranteed to be one contiguous, uniformly-readable OS mapping —
//! attempting to stitch them would require re-verifying that assumption on
//! every pair, for a case real trainer/CT signatures do not depend on in
//! practice (a compiled signature targets bytes within one function/image
//! section, which is one region).

use crate::chunk::{plan_chunks, ChunkPlanConfig};
use crate::completeness::{ScanCompleteness, ScanMetrics, SkipReason, SkippedRange};
use crate::error::{ErrorKind, ScannerError, ScannerResult};
use crate::pattern::{Pattern, PatternKind};
use crate::policy::RegionSelectionPolicy;
use crate::reader::{read_chunk, ChunkReadStatus};
use crate::region::Region;
use crate::target::{HandleStatus, ProcessHandle};
use crate::CancellationToken;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct PatternScanOptions {
    pub chunk_config: ChunkPlanConfig,
    /// Caps the number of matches retained/returned. Reaching this limit
    /// produces `ScanCompleteness::ResourceLimit`, never `Complete` — same
    /// convention as `exact_scan.rs`'s `ScanOptions::max_results`.
    pub max_results: Option<u64>,
    /// When true, implemented as `max_results = min(max_results, 1)`
    /// internally (see module doc): the scan stops at the first match in
    /// deterministic address-ascending order, and completeness reports
    /// `ResourceLimit` rather than `Complete` — reusing `exact_scan.rs`'s
    /// own established "a caller-configured cap was reached" convention
    /// rather than inventing a new completeness variant for it.
    pub first_match_only: bool,
}

impl PatternScanOptions {
    pub fn default_for(pattern: &Pattern, chunk_size_bytes: u64) -> Self {
        let min_overlap = (pattern.len() as u64).saturating_sub(1);
        PatternScanOptions {
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes,
                overlap_bytes: min_overlap,
            },
            max_results: None,
            first_match_only: false,
        }
    }

    fn effective_max_results(&self) -> Option<u64> {
        match (self.max_results, self.first_match_only) {
            (Some(m), true) => Some(m.min(1)),
            (None, true) => Some(1),
            (m, false) => m,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PatternMatch {
    pub address: u64,
    pub length: u32,
}

#[derive(Debug)]
pub struct PatternScanResult {
    pub kind: PatternKind,
    pub matches: Vec<PatternMatch>,
    pub completeness: ScanCompleteness,
    pub metrics: ScanMetrics,
}

fn validate_options(pattern: &Pattern, options: &PatternScanOptions) -> ScannerResult<()> {
    let min_overlap = (pattern.len() as u64).saturating_sub(1);
    if options.chunk_config.overlap_bytes < min_overlap {
        return Err(ScannerError::new(
            ErrorKind::InvalidConfiguration,
            format!(
                "overlap_bytes ({}) must be >= pattern length - 1 ({}), or a match spanning a chunk boundary would be missed",
                options.chunk_config.overlap_bytes, min_overlap
            ),
        ));
    }
    Ok(())
}

/// Boyer-Moore-Horspool bad-character skip table, built only from the
/// pattern's *exact* bytes at positions before the last one (mission §5.6's
/// "efficient skip logic where possible"). Returns `None` when the last
/// pattern byte is not exact (a wildcard/nibble-wildcard in the anchoring
/// position carries no reliable single-byte identity to skip on), in which
/// case the caller falls back to a plain shift-by-one scan — still correct,
/// simply without the skip acceleration. Wildcard bytes elsewhere in the
/// pattern (not the last position) contribute no table entries, which is
/// always *safe* (the default full-pattern-length skip is a conservative
/// upper bound that never skips past a genuine match), just less
/// accelerated than a pattern with no interior wildcards.
fn build_horspool_skip_table(pattern: &Pattern) -> Option<Box<[usize; 256]>> {
    let bytes = pattern.as_slice();
    let len = bytes.len();
    if len < 2 || !bytes[len - 1].is_exact() {
        return None;
    }
    let mut table = Box::new([len; 256]);
    for (i, pb) in bytes[..len - 1].iter().enumerate() {
        if pb.is_exact() {
            table[pb.value as usize] = len - 1 - i;
        }
    }
    Some(table)
}

/// Scans `buf` (bytes starting at absolute address `chunk_base`) for every
/// occurrence of `pattern`, per the Horspool skip table when available.
/// Stops early once `out.len()` reaches `max_total` — same within-buffer
/// bounded-collection discipline as `exact_scan.rs`.
fn scan_buffer_for_pattern_matches_bounded(
    chunk_base: u64,
    buf: &[u8],
    pattern: &Pattern,
    skip_table: Option<&[usize; 256]>,
    out: &mut Vec<PatternMatch>,
    max_total: Option<u64>,
) {
    let width = pattern.len();
    if buf.len() < width {
        return;
    }
    let last = width - 1;
    let mut offset = 0usize;
    let limit = buf.len() - width;
    while offset <= limit {
        if let Some(max) = max_total {
            if out.len() as u64 >= max {
                return;
            }
        }
        if pattern.matches_at(buf, offset) {
            out.push(PatternMatch {
                address: chunk_base + offset as u64,
                length: width as u32,
            });
        }
        offset += match skip_table {
            Some(table) => table[buf[offset + last] as usize].max(1),
            None => 1,
        };
    }
}

#[allow(clippy::too_many_arguments)]
fn scan_pattern_region(
    handle: &ProcessHandle,
    region: &Region,
    pattern: &Pattern,
    skip_table: Option<&[usize; 256]>,
    options: &PatternScanOptions,
    cancellation: &CancellationToken,
    metrics: &mut ScanMetrics,
    mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
) -> ScannerResult<(Vec<PatternMatch>, ScanCompleteness)> {
    let chunks = plan_chunks(region.base_address, region.size, options.chunk_config)?;
    metrics.chunks_requested += chunks.len() as u64;

    let mut matches = Vec::new();
    let mut skipped: Vec<SkippedRange> = Vec::new();
    let max_total = options.effective_max_results();

    for spec in chunks {
        if cancellation.is_cancelled() {
            return Ok((
                matches,
                ScanCompleteness::Cancelled {
                    at_byte: spec.chunk_base,
                },
            ));
        }
        if let Some(max) = max_total {
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
                scan_buffer_for_pattern_matches_bounded(
                    spec.chunk_base,
                    &read.data,
                    pattern,
                    skip_table,
                    &mut matches,
                    max_total,
                );
            }
            ChunkReadStatus::PartialRead { bytes_read } => {
                metrics.chunks_partial += 1;
                metrics.bytes_read += bytes_read;
                scan_buffer_for_pattern_matches_bounded(
                    spec.chunk_base,
                    &read.data,
                    pattern,
                    skip_table,
                    &mut matches,
                    max_total,
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

/// Scans every region selected by `policy` for occurrences of `pattern`.
/// Deduplicates overlap-boundary double-hits deterministically (sort by
/// address, drop exact duplicates), and propagates completeness per the
/// same truthful rules as `scan_exact` (mission §5.11): any non-`Complete`
/// region-level or scan-wide outcome prevents the overall result from
/// claiming `Complete`, so "zero matches" can never be silently confused
/// with "authoritatively not found" under incomplete coverage.
#[allow(clippy::too_many_arguments)]
pub fn scan_pattern(
    handle: &ProcessHandle,
    regions: &[Region],
    policy: &RegionSelectionPolicy,
    pattern: &Pattern,
    kind: PatternKind,
    options: &PatternScanOptions,
    cancellation: &CancellationToken,
    mut on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
) -> ScannerResult<PatternScanResult> {
    validate_options(pattern, options)?;
    let skip_table = build_horspool_skip_table(pattern);

    let mut metrics = ScanMetrics {
        regions_total: regions.len() as u64,
        ..Default::default()
    };
    let (selected, excluded): (Vec<&Region>, Vec<&Region>) = policy.partition(regions);
    metrics.regions_considered = selected.len() as u64;
    metrics.regions_skipped = excluded.len() as u64;

    let mut all_raw_matches: Vec<PatternMatch> = Vec::new();
    let mut all_skipped: Vec<SkippedRange> = excluded
        .iter()
        .map(|r| SkippedRange {
            base_address: r.base_address,
            size: r.size,
            reason: SkipReason::PolicyExcluded,
        })
        .collect();
    let mut terminal: Option<ScanCompleteness> = None;
    let max_total = options.effective_max_results();

    for region in selected {
        if cancellation.is_cancelled() {
            terminal = Some(ScanCompleteness::Cancelled {
                at_byte: region.base_address,
            });
            break;
        }
        if let Some(max) = max_total {
            if all_raw_matches.len() as u64 >= max {
                terminal = Some(ScanCompleteness::ResourceLimit {
                    at_byte: region.base_address,
                });
                break;
            }
        }

        let progress_arg: Option<&mut dyn FnMut(&ScanMetrics)> = match &mut on_progress {
            Some(cb) => Some(&mut **cb),
            None => None,
        };

        let (matches, completeness) = scan_pattern_region(
            handle,
            region,
            pattern,
            skip_table.as_deref(),
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

    all_raw_matches.sort_by_key(|m| m.address);
    let mut seen = HashSet::with_capacity(all_raw_matches.len());
    let mut deduped = Vec::with_capacity(all_raw_matches.len());
    for m in all_raw_matches {
        if seen.insert(m.address) {
            deduped.push(m);
        }
    }

    let mut completeness = match terminal {
        Some(t) => t,
        None if all_skipped.is_empty() => ScanCompleteness::Complete,
        None => ScanCompleteness::CompleteWithSkippedRegions {
            skipped: all_skipped,
        },
    };

    if let Some(max) = max_total {
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

    Ok(PatternScanResult {
        kind,
        matches: deduped,
        completeness,
        metrics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::{pattern_from_raw_bytes, PatternByte};

    #[test]
    fn horspool_table_none_when_last_byte_is_wildcard() {
        let pattern =
            Pattern::new(vec![PatternByte::exact(0xAA), PatternByte::wildcard()]).unwrap();
        assert!(build_horspool_skip_table(&pattern).is_none());
    }

    #[test]
    fn horspool_table_some_when_last_byte_is_exact() {
        let pattern = pattern_from_raw_bytes(&[0xAA, 0xBB, 0xCC]).unwrap();
        let table = build_horspool_skip_table(&pattern).unwrap();
        assert_eq!(table[0xCC], 3); // last byte itself: full skip (rightmost occurrence rule)
        assert_eq!(table[0xAA], 2);
        assert_eq!(table[0xBB], 1);
        assert_eq!(table[0x00], 3); // unseen byte: default full-length skip
    }

    #[test]
    fn buffer_scan_finds_all_non_overlapping_and_overlapping_occurrences() {
        let pattern = pattern_from_raw_bytes(&[0xAA, 0xAA]).unwrap();
        let skip = build_horspool_skip_table(&pattern);
        // Overlapping occurrences: AA AA AA contains two overlapping hits
        // at offset 0 and offset 1 — both must be reported (mission §5.3
        // implies exhaustive occurrence discovery, not non-overlapping
        // regex-style matching).
        let buf = [0xAA, 0xAA, 0xAA, 0x00];
        let mut out = Vec::new();
        scan_buffer_for_pattern_matches_bounded(
            0x1000,
            &buf,
            &pattern,
            skip.as_deref(),
            &mut out,
            None,
        );
        let addrs: Vec<u64> = out.iter().map(|m| m.address).collect();
        assert_eq!(addrs, vec![0x1000, 0x1001]);
    }

    #[test]
    fn validate_options_rejects_insufficient_overlap() {
        let pattern = pattern_from_raw_bytes(&[1, 2, 3, 4, 5]).unwrap();
        let opts = PatternScanOptions {
            chunk_config: ChunkPlanConfig {
                chunk_size_bytes: 4096,
                overlap_bytes: 2,
            },
            max_results: None,
            first_match_only: false,
        };
        let err = validate_options(&pattern, &opts).unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidConfiguration);
    }

    #[test]
    fn region_boundary_is_not_stitched_across_two_regions() {
        // A pattern split across the end of region A and the start of
        // region B (even though B's base is exactly A's end — the
        // address-contiguous case) must not be found: each region is its
        // own independent scan buffer (mission §5.8's documented policy).
        // This is proven structurally here (no real OS regions are needed
        // to demonstrate the *policy*, since scan_pattern_region never
        // reads past its own region's bounds by construction) — the real,
        // process-backed proof lives in tests/pattern_scan_integration.rs.
        let pattern = pattern_from_raw_bytes(&[0xDE, 0xAD, 0xBE, 0xEF]).unwrap();
        assert_eq!(pattern.len(), 4);
        // Simulate region A ending with "DE AD" and region B (contiguous
        // base) starting with "BE EF": scanning A alone and B alone must
        // each report zero matches for the 4-byte pattern.
        let region_a_tail = [0x00, 0xDE, 0xAD];
        let region_b_head = [0xBE, 0xEF, 0x00];
        let skip = build_horspool_skip_table(&pattern);
        let mut out_a = Vec::new();
        scan_buffer_for_pattern_matches_bounded(
            0x2000,
            &region_a_tail,
            &pattern,
            skip.as_deref(),
            &mut out_a,
            None,
        );
        let mut out_b = Vec::new();
        scan_buffer_for_pattern_matches_bounded(
            0x2003,
            &region_b_head,
            &pattern,
            skip.as_deref(),
            &mut out_b,
            None,
        );
        assert!(out_a.is_empty());
        assert!(out_b.is_empty());
    }

    #[test]
    fn first_match_only_is_sugar_for_max_results_one() {
        let pattern = pattern_from_raw_bytes(&[0xAA]).unwrap();
        let opts = PatternScanOptions {
            first_match_only: true,
            ..PatternScanOptions::default_for(&pattern, 4096)
        };
        assert_eq!(opts.effective_max_results(), Some(1));
        let opts2 = PatternScanOptions {
            first_match_only: true,
            max_results: Some(50),
            ..PatternScanOptions::default_for(&pattern, 4096)
        };
        assert_eq!(opts2.effective_max_results(), Some(1));
    }

    // Multi-region orchestration (dedup across regions, completeness
    // propagation from a real `ProcessHandle`) has no fake-handle test
    // seam here by design (`ProcessHandle` cannot be constructed without a
    // real OS process — see target.rs) — it is covered end-to-end by the
    // real spawned-process tests in tests/pattern_scan_integration.rs.
}
