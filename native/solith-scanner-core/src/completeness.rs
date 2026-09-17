//! The truthful-completeness foundation (Stage 1 doc 06 §4, Stage 2 mission
//! §11). Replaces the current TypeScript scanner's inconsistently-set
//! `boolean truncated` (Stage 1 doc 02's D01/D05 findings) with a closed,
//! exhaustive Rust enum plus structured, machine-readable metrics —
//! Stage 2 implements the type now; the full scan-mode semantics that
//! *produce* every variant land in a later stage (Stage 3+), per the
//! mission's explicit CLOSED vs. FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED
//! distinction (§26).

use std::time::Duration;

/// Why one region or chunk was not (fully) read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    /// Excluded by the caller's `RegionSelectionPolicy` (not a failure).
    PolicyExcluded,
    /// The OS reported the region/chunk as unreadable (`PAGE_NOACCESS`/`PAGE_GUARD`).
    Unreadable,
    /// A read was attempted and the OS denied it (`ERROR_ACCESS_DENIED` or similar).
    AccessDenied,
    /// Fewer bytes were returned than requested.
    PartialRead,
    /// The target process exited during the read.
    ProcessExited,
    /// A configured resource bound (byte/time/region-count budget) was hit.
    ResourceLimit,
    /// The operation was cancelled before this region/chunk was reached.
    Cancelled,
    /// An OS-level error not covered by a more specific reason above.
    OsError,
}

/// One named, non-silent skip record — a region or chunk the scan did not
/// (fully) cover, and why. This is the structural replacement for today's
/// bare `catch { continue; }` (Stage 1 doc 02).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedRange {
    pub base_address: u64,
    pub size: u64,
    pub reason: SkipReason,
}

/// The exhaustive completion-state enum. Every scan-mechanics operation
/// this crate performs returns exactly one of these alongside its data —
/// there is no code path that can return partial results without also
/// stating whether/why they are partial.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanCompleteness {
    /// Every considered region/chunk was fully read; nothing was skipped.
    Complete,
    /// At least one region/chunk was skipped; `skipped` names every one and why.
    CompleteWithSkippedRegions { skipped: Vec<SkippedRange> },
    /// The caller requested cancellation; the operation stopped at a safe
    /// boundary (never mid-syscall).
    Cancelled { at_byte: u64 },
    /// The target process exited during the operation.
    ProcessExited { at_byte: u64 },
    /// Too many individual read failures occurred to continue safely
    /// (distinct from `CompleteWithSkippedRegions`, which tolerates a
    /// bounded number of named skips without giving up on the whole scan).
    ReadErrorLimit { skipped: Vec<SkippedRange> },
    /// A configured resource bound (byte budget, region-count budget, time
    /// budget) was reached before the full requested scope was covered.
    ResourceLimit { at_byte: u64 },
    /// The operation could not proceed at all (e.g. the target was never
    /// reachable). `reason` is a human-readable diagnostic; the caller
    /// should also inspect the `ScannerError` this accompanies for the
    /// stable `ErrorKind`.
    Failed { reason: String },
}

impl ScanCompleteness {
    pub fn is_complete(&self) -> bool {
        matches!(self, ScanCompleteness::Complete)
    }

    /// A stable, machine-readable label for this variant — used wherever a
    /// compact, serializable identifier is needed (session-snapshot
    /// metadata, Stage 6 §6.9) without carrying the variant's own payload
    /// (e.g. a `CompleteWithSkippedRegions`'s potentially large `skipped`
    /// list, which is deliberately not persisted).
    pub fn label(&self) -> &'static str {
        match self {
            ScanCompleteness::Complete => "complete",
            ScanCompleteness::CompleteWithSkippedRegions { .. } => "complete_with_skipped_regions",
            ScanCompleteness::Cancelled { .. } => "cancelled",
            ScanCompleteness::ProcessExited { .. } => "process_exited",
            ScanCompleteness::ReadErrorLimit { .. } => "read_error_limit",
            ScanCompleteness::ResourceLimit { .. } => "resource_limit",
            ScanCompleteness::Failed { .. } => "failed",
        }
    }
}

/// Stage 6 §6.3 — the single shared rule for whether a zero-match result
/// may be reported as an authoritative absence, rather than each scan path
/// (primitive exact scan, session capture/refine, string/byte/AOB pattern
/// scan) inventing its own interpretation. A zero-match result is
/// authoritative if and only if the scan's own completeness is `Complete`:
/// every other variant means some portion of the requested scope was not
/// examined (skipped, cancelled, the target exited, a resource limit was
/// hit, or the operation failed outright), so absence there can never be
/// trusted as "genuinely not present."
///
/// Deliberately takes `match_count` rather than assuming the caller already
/// checked it — this is the one function every scan path should call
/// instead of re-deriving "no matches AND fully covered" locally.
pub fn is_authoritative_absence(completeness: &ScanCompleteness, match_count: usize) -> bool {
    match_count == 0 && completeness.is_complete()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authoritative_absence_requires_both_zero_matches_and_complete() {
        assert!(is_authoritative_absence(&ScanCompleteness::Complete, 0));
        assert!(!is_authoritative_absence(&ScanCompleteness::Complete, 1));
    }

    #[test]
    fn authoritative_absence_false_for_every_non_complete_variant_even_with_zero_matches() {
        let non_complete = [
            ScanCompleteness::CompleteWithSkippedRegions { skipped: vec![] },
            ScanCompleteness::Cancelled { at_byte: 0 },
            ScanCompleteness::ProcessExited { at_byte: 0 },
            ScanCompleteness::ReadErrorLimit { skipped: vec![] },
            ScanCompleteness::ResourceLimit { at_byte: 0 },
            ScanCompleteness::Failed {
                reason: "test".to_string(),
            },
        ];
        for completeness in &non_complete {
            assert!(
                !is_authoritative_absence(completeness, 0),
                "{completeness:?} must not be authoritative even with zero matches"
            );
        }
    }

    #[test]
    fn label_is_stable_and_distinct_per_variant() {
        let variants = [
            ScanCompleteness::Complete,
            ScanCompleteness::CompleteWithSkippedRegions { skipped: vec![] },
            ScanCompleteness::Cancelled { at_byte: 0 },
            ScanCompleteness::ProcessExited { at_byte: 0 },
            ScanCompleteness::ReadErrorLimit { skipped: vec![] },
            ScanCompleteness::ResourceLimit { at_byte: 0 },
            ScanCompleteness::Failed {
                reason: "test".to_string(),
            },
        ];
        let labels: Vec<&'static str> = variants.iter().map(|v| v.label()).collect();
        let mut unique = labels.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(
            labels.len(),
            unique.len(),
            "every variant must have a distinct label"
        );
    }
}

/// Structured, machine-readable metrics for one enumeration/read operation.
/// Deliberately not a single boolean or a single number — per the mission's
/// "do not overload a single boolean" instruction, a caller (and eventually
/// the UI) can answer "what fraction of the requested scope was actually
/// covered" from these fields directly.
#[derive(Debug, Clone, Copy, Default)]
pub struct ScanMetrics {
    pub regions_total: u64,
    pub regions_considered: u64,
    pub regions_read: u64,
    pub regions_skipped: u64,
    pub chunks_requested: u64,
    pub chunks_read: u64,
    pub chunks_partial: u64,
    pub chunks_failed: u64,
    pub bytes_requested: u64,
    pub bytes_read: u64,
    pub elapsed: Duration,
    /// Number of underlying `ReadProcessMemory`/`VirtualQueryEx` syscalls
    /// issued — the Stage 1 doc 04 structural finding was that real-machine
    /// timing is dominated by syscall *count*, not per-byte decode cost;
    /// this field is what lets Stage 2's benchmarks (doc 16) test that
    /// finding directly rather than assume it.
    pub syscall_count: u64,
}

// Stage 6 §6.4 audit finding: a prior `coverage_ratio()` method here
// (`bytes_read / bytes_requested`) was removed. It was unused by every real
// caller (napi's `JsProgress` never surfaced it) and, had a caller adopted
// it, would have been misleading: `bytes_requested` accumulates
// progressively as each chunk is reached rather than being known up front,
// so the ratio can read as `1.0` after every single chunk throughout an
// entire multi-region scan, not just at true completion — "fake precision"
// the mission's progress contract (§6.4) explicitly warns against. No
// whole-scan-bytes-known-up-front field exists to compute a true percentage
// safely; `regions_total` is the only true up-front total, and it counts
// regions, not bytes. See doc 60 for the full progress-contract writeup.
