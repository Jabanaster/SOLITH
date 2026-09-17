# Phase 1 / Stage 5 — Raw Byte-Sequence Scan Engine

## The foundation under AOB (mission §5.3)

`pattern_from_raw_bytes(&[u8]) -> ScannerResult<Pattern>` compiles a literal byte sequence into an all-`mask=0xFF` `Pattern` — the exact same `Pattern`/`PatternByte` type AOB and string patterns compile into (doc 40). Raw-byte scanning is therefore not a separate matcher: it is the degenerate, no-wildcard case of the one matcher `pattern_scan.rs` implements, satisfying mission §5.3's own framing.

## Requirements checklist

| Requirement | Status / proof |
|---|---|
| Arbitrary byte lengths | `Pattern` accepts 1..=`MAX_PATTERN_BYTES` (64 KiB) bytes |
| 1 byte through practical large lengths | Real fixture proves 2/6/8/32/64-byte patterns (chunk-boundary offsets, `RAW_BYTES_PATTERN`, `bench_pattern`'s 64-byte case) |
| Chunk-boundary support | `PatternScanOptions::default_for` sets `overlap_bytes = pattern.len() - 1`, mirroring `exact_scan.rs`'s proven convention; real cross-boundary proof in `chunk_boundary_2_byte_pattern_is_found_intact`/`..._8_byte_...` |
| No duplicate matches from overlap | Address-ascending sort + `HashSet`-based de-dup in `scan_pattern`, identical algorithm to `scan_exact`'s already-certified Stage 3 dedup |
| Zero-length pattern rejected | `Pattern::new` refuses an empty `Vec<PatternByte>` (`raw_bytes_pattern_rejects_empty`) |
| Result ordering deterministic | Matches sorted by address before return; proven by `raw_byte_pattern_all_match_mode_returns_both_duplicate_instances`'s ascending-order assertion |
| Cancellation/progress | Same per-chunk `CancellationToken`/`on_progress` checkpoints as `exact_scan.rs`/`session.rs`; real proof: `cancellation_stops_pattern_scan_before_full_region_is_covered`, `progress_reflects_real_work_during_pattern_scan` |
| Truthful completeness | Reuses `ScanCompleteness` unchanged; real proof against a genuine `PAGE_NOACCESS` page: `zero_matches_under_unreadable_page_is_not_authoritative_not_found` |
| Resource limits | `PatternScanOptions::max_results`, truncates deterministically and reports `ResourceLimit` (never `Complete`) — `max_results_resource_limit_is_reported_truthfully` |

## Overlapping self-matches

Unlike `exact_scan.rs` (a fixed-width primitive can never overlap itself), a byte pattern like `AA AA` can occur at consecutive, overlapping offsets in real memory (`AA AA AA` contains two overlapping hits). The buffer scanner reports every one — `buffer_scan_finds_all_non_overlapping_and_overlapping_occurrences` proves both offset 0 and offset 1 are returned for `[0xAA, 0xAA]` against `[0xAA, 0xAA, 0xAA, 0x00]`. This is a deliberate choice: mission §5.6 asks for "all matches" mode, and silently collapsing overlapping occurrences into non-overlapping ones (regex-style) would be a different, undocumented semantic a trainer author does not expect from a memory scanner.

## Deterministic address order and "all matches" vs. "first match"

`scan_pattern` always iterates regions/chunks/offsets in ascending-address order, so "all matches" mode is inherently address-ascending, and "first match" mode (mission §5.6/§5.10) is implemented as `max_results = 1` internally (doc 40) — reusing the exact same early-exit/`ResourceLimit`-reporting machinery rather than a second code path, so both modes share one, already-tested truthfulness guarantee.

## Memory cost

A `PatternMatch` is `{address: u64, length: u32}` — 12 bytes (16 with alignment padding), no heap allocation per match beyond the `Vec` itself; there is no separate compact `CandidateStore`-style structure for pattern matches this stage, since a single-shot scan (unlike Stage 4's persistent session) has no cross-call snapshot to retain — matches are consumed once at the napi boundary and the `Vec` is dropped. Bounded via `max_results`/pagination is not separately implemented for pattern scans (unlike session's `candidates_page`) because a single scan's result set is already bounded by `max_results` before it is ever materialized, consistent with mission §5.10's "bounded result limits consistent with Stage 3/4" instruction (Stage 3's `scan_exact` follows the identical convention).
