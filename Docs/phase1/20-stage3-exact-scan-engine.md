# Phase 1 / Stage 3 — Exact Scan Engine

## API shape (`native/solith-scanner-core/src/exact_scan.rs`)

```rust
pub fn scan_exact(
    handle: &ProcessHandle,
    regions: &[Region],
    policy: &RegionSelectionPolicy,
    primitive_type: PrimitiveType,
    target: PrimitiveValue,
    options: &ScanOptions,          // alignment, chunk_config, max_results
    cancellation: &CancellationToken,
    on_progress: Option<&mut dyn FnMut(&ScanMetrics)>,
) -> ScannerResult<ExactScanResult>  // { matches, completeness, metrics }
```

Matches the mission's conceptual `scan_exact(process/session, regions, primitive_type, target_value, options) -> ScanResultSet` shape closely; the actual design differs only in threading region-selection policy and progress separately (both already-established Stage 2 patterns — `RegionSelectionPolicy` from `read_regions_chunked`, the progress-callback shape from `read_region_chunked_with_progress`), so the new engine composes with rather than duplicates Stage 2's conventions.

**Required options, all present**: `alignment` (§ below), `region policy` (`RegionSelectionPolicy`, reused verbatim from Stage 2 — readable/writable/executable filters, region-kind/commit-state filters, size ceiling), `chunk size` (`ScanOptions.chunk_config`), `cancellation` (parameter), `progress` (callback parameter), `max-results` (`ScanOptions.max_results`, mission §3.9's resource limit). No separate "resource budget" beyond match count was added in Stage 3 (a byte-budget analogous to Stage 2's `ReadBudget` was considered but not required by the mission's exit gate and is a reasonable Stage 4+ addition if evidence calls for it — not fabricated here).

## Built on chunked reads, not a reimplementation of them

`scan_exact` reuses Stage 2's `plan_chunks` (chunk planning) and a newly `pub(crate)`-exposed `read_chunk` (single real `ReadProcessMemory` call + Win32-error classification) — the exact same read mechanics and error classification Stage 2 already certified (`ChunkReadStatus::{Success,PartialRead,AccessDenied,TargetExited,InvalidAddress,OsError,ResourceLimit,Cancelled}`), not a parallel, divergent implementation. What's new is the *orchestration*: rather than accumulating `Vec<ChunkReadResult>` (Stage 2's byte-preserving contract, correct for its own use case), `scan_exact`'s loop decodes-and-compares each chunk's bytes immediately and retains only `ScanMatch{address, value}` entries — a handful of bytes per hit instead of the full chunk buffer — directly serving mission §3.8's scalability requirement.

## Alignment semantics (mission §3.4)

`AlignmentMode::Bytewise` (default, via `#[derive(Default)]`) scans every byte offset; `AlignmentMode::AlignedToType` scans only offsets whose **absolute address** is a multiple of the primitive's own width — computed as `chunk_base + local_offset`, never the chunk-relative local offset alone (a chunk whose own base isn't type-aligned would otherwise misclassify aligned candidates as unaligned or vice versa; `aligned_mode_uses_absolute_address_not_chunk_relative_offset` is a dedicated regression test for exactly this).

**Real, executed proof of the mission's literal example** (a u32 value discoverable at four consecutive byte offsets in bytewise mode): the pure property test `arbitrary_offsets_and_widths_are_found_without_false_positives_or_negatives` plants values at every possible offset for every type across 500 randomized trials; the real-process test `bytewise_mode_finds_unaligned_u32_at_every_offset_0_to_3` and `every_primitive_type_is_found_at_its_planted_offset` confirm the same against a live process's real memory (I32_OFFSET=321, I16_OFFSET=193, and I64_OFFSET=449 are all deliberately unaligned in the fixture and all found). `aligned_mode_finds_only_aligned_candidates_real_process` confirms the negative case: an unaligned real candidate is correctly excluded in `AlignedToType` mode. **No hidden 4-byte stride exists anywhere in this engine** — confirmed by both the pure unit tests (i16/u16 unaligned discovery, `no_hidden_four_byte_stride_for_non_four_byte_types`) and the real-process tests.

## Chunk-boundary correctness (mission §3.5)

`ScanOptions::default_for(primitive_type, chunk_size)` automatically widens `overlap_bytes` to `primitive_type.byte_width() - 1`; `validate_options` rejects (with a typed `InvalidConfiguration` error, not a silent miss) any caller-supplied overlap narrower than that minimum for the primitive being scanned (`insufficient_overlap_for_primitive_width_is_rejected_up_front`).

**Real, executed proof for all three required widths** (2/4/8 bytes), against real process memory, each straddling an independent 1 MiB chunk boundary (the fixture was extended, and a real authoring bug — all three boundary values originally overlapping the same few bytes and silently clobbering each other — was caught and fixed during this stage; see doc 25):
- `boundary_straddling_u16_u32_u64_are_all_found_without_duplication` (Rust) and the equivalent real-JS test in the napi suite both confirm each boundary value is found **exactly once**, not zero times (missed) and not twice (duplicated by the overlap mechanism).

**Deduplication** (mission's explicit "no duplicate results from overlap... must be deterministic and tested" requirement): raw matches from every chunk (which legitimately double-report values inside the overlap zone, exactly as Stage 2 documented for its own byte-count metric) are sorted by address and deduplicated by exact address equality — same address implies same underlying bytes implies same decoded value, so this is lossless. Sorting also gives deterministic, ascending-address result ordering "for free" (mission §3.8's requirement), verified directly by `repeated_value_produces_exactly_two_distinct_addresses`, which asserts both that exactly two distinct addresses are returned for a value planted twice and that they appear in ascending order.

## Resource limits (mission §3.9)

A within-buffer early exit (`scan_buffer_for_matches_bounded`'s `max_total` parameter) prevents a single dense chunk from decoding/allocating far past `max_results` before the next per-chunk budget check runs — this was a real bug caught during this stage's own testing (a decoy-fill region containing thousands of hits for a common byte value initially blew past a `max_results: 3` cap because the per-chunk decode loop had no internal stop condition; see doc 25) and is now fixed with a dedicated regression test (`resource_limit_truncates_and_never_reports_complete`, plus the napi-layer `bounded result paging` test). Reaching the limit **always** produces `ScanCompleteness::ResourceLimit` (never `Complete`), and the returned match list is truncated to exactly `max_results` entries — never silently larger.

## Completeness propagation (mission §3.10)

`scan_exact`'s per-region loop mirrors Stage 2's `read_regions_chunked` propagation rules exactly: any region-level `Cancelled`/`ProcessExited`/`ResourceLimit` stops the whole scan and that state (not `Complete`) is reported; any `CompleteWithSkippedRegions` from a region (or a policy-excluded region) is folded into an overall `CompleteWithSkippedRegions`, never silently upgraded to `Complete`. **The specific "no matches ≠ not found" distinction the mission requires** is proven by two paired, real-process tests: `incomplete_scan_never_claims_authoritative_not_found` (a policy-excluded region — guaranteed incomplete — searching for an absent value returns zero matches **and** `CompleteWithSkippedRegions`, never `Complete`) versus `authoritative_not_found_is_distinct_from_incomplete_zero_matches` (the same absent value, with full region coverage, correctly returns `Complete` with zero matches) — a caller can always tell these two zero-match outcomes apart.
