# Phase 1 / Stage 3 — Defect Closure Accounting

Per the mission's explicit instructions (§3.16): distinguishing what the *native path* now does correctly from what the *shipping product* still does, since production TypeScript remains untouched and active.

## Forced-alignment defect

**Native path: implementation-complete.** `AlignmentMode::Bytewise` (default) has no hardcoded stride of any kind; `AlignedToType` is measured per-type against the primitive's own width via absolute address, not a fixed 4. Proven by 500 randomized property-test trials (pure) plus 7 real-process integration tests (doc 20).

**Product defect: NOT closed.** This was already confirmed **absent** from the current TypeScript scanner during Stage 1 (doc 02: "B. Forced 4-byte alignment — NOT PRESENT... genuinely absent"), so there is no live product defect of this specific kind to close in the first place — Stage 3's native work here is a forward-looking correctness guarantee (never introducing the defect as the codebase grows), not a fix for an existing shipped bug. Recorded for completeness per the mission's explicit checklist item, not because a live defect existed.

## int64 defect (D06)

**NATIVE_PATH_FIXED.** Both halves of D06 are now closed in the new code path: addresses (already fixed in Stage 2 via `readPointer`-style BigInt) and, new this stage, **values** — `PrimitiveValue::I64`/`U64` stay native Rust types end to end, and `solith-scanner-napi`'s value-duality contract (doc 22) delivers them to JS as real `BigInt`, never coerced through `Number`. Proven with the exact real-world failure case Stage 1 doc 02 reproduced (two distinct u64 values that collide under `Number()`) remaining distinct through the full Rust → napi → Node/JS → assertion path, in both the Rust integration suite and, independently, real JavaScript (`u64_beyond_js_safe_integer_is_found_exactly`, `exact scan: u64 beyond JS safe integer round-trips exactly via BigInt`).

**PRODUCT_DEFECT_NOT_YET_CLOSED.** `src/core/live-memory/memory-scanner.ts`'s `decodeValue`/`encodeValue` still narrow `int64` through `Number(BigInt)` today (Stage 1 doc 02's original reproduction) — untouched by Stage 3, per the explicit "do not switch production" boundary. D06 remains open in the shipping product until a later stage actually replaces that TypeScript code path with the now-proven native one.

## 1 MiB cap (D02)

**Do not claim product closure — not claimed.** No change from Stage 2's own accounting (doc 17): the native chunked reader Stage 3 builds on has no analogous cap, and Stage 3's own fixture proves values beyond the old 1 MiB boundary are found correctly by `scan_exact` (e.g. `U64_HUGE_OFFSET=576` sits well within the fixture's first MiB, but the boundary-straddling tests at offsets past 1/2/3 MiB independently exercise reads and scans past the historical cap). This remains `FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED` exactly as Stage 2 left it — Stage 3 adds a real scan mode on top of the already-fixed reader, but the *product* still runs the old TypeScript scanner with the old cap.

## AOB

**Not Stage 3, as instructed.** No AOB/pattern-matching code was added or modified this stage. D04's status is unchanged from Stage 2's accounting (doc 17: foundation-capable, no native AOB engine exists yet).

## Pointer depth (D05 / P1-SCAN-001)

**Not Stage 3, as instructed** — pointer scanning is not scanner-core-owned truth-model work in this stage's sense; no pointer-chain code was added or modified. P1-SCAN-001's status (real 32-bit/WOW64 target validation still not executable in this environment — no `i686-pc-windows-msvc` Rust target installed) is unchanged from Stage 2's doc 17 accounting.

## New Stage-3-specific findings, dispositioned within this stage (not carried forward as open defects)

Two real implementation bugs were found and fixed **during** this stage's own testing, before any evidence doc was written claiming success — recorded transparently rather than silently absorbed:

1. **Fixture authoring bug**: the three chunk-boundary-straddling constants (u16/u32/u64) were initially all placed within a few bytes of the *same* 1 MiB boundary, so writing the u64 test pattern silently overwrote the u16 and u32 patterns already written at overlapping offsets. Caught by a failing `boundary_straddling_u16_u32_u64_are_all_found_without_duplication` test (0 hits instead of 1) and root-caused via direct memory inspection (a temporary debug binary, built and deleted within this session, confirming the actual bytes at the target address did not match the expected u16 pattern). Fixed by spacing the three boundary tests across three independent 1 MiB multiples and growing the fixture region accordingly (doc 20).
2. **Resource-limit scalability gap**: the original `scan_exact_region` loop checked `max_results` only *between* chunks, so a single chunk containing far more matches than the cap (e.g. thousands of occurrences of a common decoy byte) could push `matches.len()` far past `max_results` in one step, and a code path in the outer aggregation function skipped the final truncation step whenever an inner region-level `ResourceLimit` had already fired. Caught by a failing `resource_limit_truncates_and_never_reports_complete` test (returned more than the requested cap) and fixed with a within-buffer early-exit (`scan_buffer_for_matches_bounded`) plus an unconditional final truncation/re-labeling step in `scan_exact` (doc 20).

Both are now covered by dedicated, currently-passing regression tests (doc 23) — recorded here as the mission's own "no new unresolved Stage-3 P0/P1 defect" exit-gate item, satisfied by fixing rather than leaving open.

## Summary table

| Item | Native path | Product |
|---|---|---|
| Forced alignment | Implementation-complete (bytewise default, no hidden stride) | N/A — already confirmed absent from the shipping scanner (Stage 1) |
| int64 (D06) | NATIVE_PATH_FIXED (addresses + values, real BigInt end to end) | PRODUCT_DEFECT_NOT_YET_CLOSED |
| 1 MiB cap (D02) | Unchanged from Stage 2: foundation-complete | Not yet closed |
| AOB (D04) | Not Stage 3 | Not yet closed |
| Pointer depth (P1-SCAN-001) | Not Stage 3 | Not yet closed |
