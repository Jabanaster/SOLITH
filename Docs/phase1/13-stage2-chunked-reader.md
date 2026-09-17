# Phase 1 / Stage 2 — Chunked Reader

## Chunk planning (pure, OS-independent — `chunk.rs`)

`plan_chunks(region_base, region_size, ChunkPlanConfig{chunk_size_bytes, overlap_bytes})` splits `[0, region_size)` into a sequence of `ChunkSpec`s (`chunk_base`, `requested_size`, `overlap_before`, `overlap_after`), each subsequent chunk starting `stride = chunk_size_bytes - overlap_bytes` bytes after the previous one, so adjacent windows overlap by exactly `overlap_bytes`. This removes the current TypeScript scanner's "one region, one `readBuffer` call, hard boundary" design (Stage 1 doc 01 §5 / doc 02 D02) — the mechanism behind the silent 1 MiB cap — and, independently, closes the cross-region-boundary gap identified as P1-SCAN-004 for the *within-one-region* case (cross-*region* boundaries are closed at the higher `read_regions_chunked` level only insofar as each region is itself fully covered; true cross-region stitching, for a value literally split across two separately-enumerated regions, remains explicitly out of Stage 2's scope — see doc 17).

Chunk size is a runtime `u64` config value, not a compile-time constant — `ChunkPlanConfig::default_for_testing()` (1 MiB chunk, 7-byte overlap) is a named, documented default for tests/early benchmarking, not a hardcoded permanent value (mission §9's explicit "do not hardcode an arbitrary permanent value without evidence" — the actual tuning value for Stage 3's real scan modes is deferred to evidence from doc 16's benchmark).

**Required relationship, enforced and tested**: `overlap_bytes < chunk_size_bytes` is validated (`ScannerError::InvalidConfiguration` otherwise); the mission's `overlap ≥ max_candidate_width − 1` requirement is verified for widths 1–32 bytes in `arbitrary_pattern_widths_get_full_coverage_with_matching_overlap` — every candidate width's boundary-straddling placement is proven fully contained in some chunk.

## Chunk test matrix (mission §19) — coverage achieved

| Case | Test |
|---|---|
| region size = 0 | `region_size_zero_produces_no_chunks` |
| region smaller than chunk | `region_smaller_than_chunk_produces_one_partial_chunk` |
| region exactly chunk | `region_exactly_chunk_size_produces_one_full_chunk` |
| region chunk + 1 | `region_chunk_plus_one_produces_two_overlapping_chunks` |
| multiple chunks | `multiple_chunks_cover_a_large_region_with_no_gaps` |
| overlap = 0 | `overlap_zero_is_valid_and_produces_contiguous_chunks` |
| overlap = width−1 | `overlap_equal_to_width_minus_one_is_valid` + `arbitrary_pattern_widths_...` (widths 1–32) |
| overlap ≥ chunk invalid | `overlap_greater_or_equal_to_chunk_size_is_rejected` (+ `zero_chunk_size_is_rejected`) |
| address near maximum | `address_near_u64_max_that_fits_is_planned_correctly` |
| chunk arithmetic overflow | `address_arithmetic_overflow_is_refused_not_wrapped`, `chunk_offset_overflow_mid_plan_is_refused_not_wrapped` |
| partial final chunk | `partial_final_chunk_is_shorter_than_chunk_size` |
| partial read | `inaccessible_page_yields_completewithskippedregions_not_complete` (real fixture — see below) |
| unreadable middle page | same test, real `PAGE_NOACCESS` page via `VirtualProtect` |
| cancel before first chunk / cancel between chunks | `cancellation_mid_operation_stops_before_full_region_is_read` (deterministic, via the progress-callback hook — see doc 14) |
| arbitrary chunk boundaries (property/fuzz) | `arbitrary_chunk_boundaries_never_lose_coverage_or_panic` — 2000 randomized `(chunk_size, overlap, region_size, base)` combinations, deterministic seed, asserts full coverage and no panic on every one |

16/16 unit/property tests pass (`cargo test --lib`), 8/8 real spawned-process integration tests pass (`cargo test --test fixture_integration`) — 24/24 total.

## Chunked read execution (real Windows I/O — `reader.rs`)

`read_region_chunked(_with_progress)` plans a region's chunks, then for each: checks cancellation (between chunks, never mid-syscall — see doc 14), checks the budget, re-verifies target liveness (`GetExitCodeProcess`) before issuing the read, calls real `ReadProcessMemory`, and classifies the outcome into one of `ChunkReadStatus::{Success, PartialRead{bytes_read}, AccessDenied, TargetExited, InvalidAddress, OsError{code}, ResourceLimit, Cancelled}` — mapping real Win32 error codes (`ERROR_PARTIAL_COPY`=299 and `ERROR_ACCESS_DENIED`=5 → `AccessDenied`; `ERROR_INVALID_PARAMETER`=87 → `InvalidAddress`; anything else → `OsError{code}`), per the mission's explicit classification list (§10). **No failure is ever silently turned into "skip and continue" without being recorded** — every non-`Success` chunk becomes a `SkippedRange{base_address, size, reason}` entry that feeds the completeness record (doc 06/mission §11), the structural fix for D01 (five sibling TypeScript functions' silent `catch { continue; }`).

## >1 MiB coverage — real, executed proof

`region_over_1mib_is_fully_covered_and_sentinel_value_readable` attaches to a real spawned process with a real 4 MiB `VirtualAlloc`'d region (`BIG_REGION_SIZE`, `src/bin/fixture.rs`), reads it in full via `read_regions_chunked` with the default 1 MiB/7-byte-overlap chunk config, and asserts: `completeness == Complete`, `chunks_read > 1` (5 real chunks for a 4 MiB region), and — reconstructing the planted `u32` sentinel at offset 1,500,000 (well past the old 1 MiB cap) from the returned chunk data — the exact value `0xCAFEBABE` is read back correctly. This is the same class of failure D02 documented (Stage 1 doc 02): the value existed but the old TypeScript scanner's 1 MiB `readBuffer` cap made it categorically unreachable. Here it is read successfully, by construction.

`bytes_read` for this operation legitimately exceeds `region.size` by exactly `(chunks_read + chunks_partial − 1) × overlap_bytes` — the overlap bytes are read twice, by two separate real `ReadProcessMemory` calls, which is the intended, verified behavior (asserted exactly, not just bounded, in the test).

## Chunk-boundary and unaligned coverage — real, executed proof

`chunk_boundary_straddling_pattern_is_read_intact_via_overlap`: an 8-byte pattern planted at `chunk_size − 4` (straddling the naive non-overlapping 1 MiB boundary) is read back byte-exact from a single chunk, proving the overlap mechanism works against real memory, not just the pure planner logic. `unaligned_sentinel_byte_is_read_intact`: a byte planted at a non-type-width-aligned offset (4,097) is read back correctly — the chunked reader has no alignment assumption at all (it reads raw bytes; alignment is a future scan-mode concern per Stage 1 doc 07, not a reader concern).

## Partial reads / unreadable regions — real, executed proof

`inaccessible_page_yields_completewithskippedregions_not_complete`: a real 3-page `VirtualAlloc`'d region with its middle page `VirtualProtect`'d to `PAGE_NOACCESS`, read with page-aligned 4096-byte chunks. Result: exactly 3 chunks attempted, 2 succeed, 1 fails (`AccessDenied`), and the returned completeness is `CompleteWithSkippedRegions{skipped: [1 entry]}` — **never** `Complete`, satisfying the mission's explicit "prove completeness is NOT Complete" requirement with a real OS-level access failure, not a simulated one.

## Process exit — real, executed proof

`process_exit_is_reported_truthfully_not_silently_ignored`: the fixture process is killed abruptly (`std::process::exit` via a `die` command sent over its stdin) before the read starts; the subsequent `read_region_chunked` call returns `Ok` (never an `Err` — a dead target is a completeness state, not a Rust-level error) with `ScanCompleteness::ProcessExited{..}`.
