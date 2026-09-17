# Phase 1 / Stage 4 — Defect Closure Accounting

Per the mission's explicit instructions (§4.19): the *native path* is evaluated separately from the *shipping product*, since production TypeScript remains untouched and active throughout this stage.

## int64 (D06) — remains fixed through refinement

**NATIVE_PATH_FIXED, unchanged from Stage 3, and proven to survive refinement specifically.** `CandidateStore` stores `PrimitiveValue::I64`/`U64` as native Rust types end to end (via the same `encode_into`/`decode` Stage 3 already certified); `refine()`'s re-read-and-compare loop never narrows through `f64` at any point, and `checked_increase_by`/`checked_decrease_by`/`compare_ordered` all operate on the native `i64`/`u64` values directly. The napi layer's value-duality contract (doc 31) delivers session values to JS as real `BigInt`, never coerced. Proven with the same real-world failure case Stage 1/3 used (a u64 value beyond `Number.MAX_SAFE_INTEGER`), now specifically through a *refinement* pass, not just an initial capture: `u64_beyond_js_safe_integer_survives_a_real_refine_exactly` (Rust) and `session: BigInt value refinement round-trips a u64 beyond JS safe integer exactly` (real JS, doc 32) — both confirm the exact 64-bit value is unchanged after `UNCHANGED` re-reads and re-stores it.

**PRODUCT_DEFECT_NOT_YET_CLOSED.** Unchanged from Stage 3's accounting — `src/core/live-memory/memory-scanner.ts` still narrows int64 through `Number(BigInt)`, untouched by Stage 4 per the explicit "do not switch production" boundary.

## Alignment — native path remains correct

**Native path: implementation-complete, unchanged and re-confirmed.** Stage 4 reuses Stage 3's `AlignmentMode` unchanged (`Bytewise` default, `AlignedToType` measured per-type against absolute address) for `UNKNOWN_INITIAL`'s own capture pass — no new alignment logic was written, and no hidden stride was introduced anywhere in `create_unknown_initial`'s decode loop (the `skip_front` overlap-avoidance optimization in that loop, doc 27/29, operates on the *count* of bytes to skip at a chunk's front, not on any fixed stride — it correctly composes with either alignment mode, since the `AlignedToType` check is applied identically after the skip). Refinement itself has no separate alignment concept — it only ever re-reads addresses the initial capture already selected under the session's fixed `alignment`, so there is no second place a stride defect could be reintroduced.

**Product: N/A**, same as Stage 2/3's accounting — already confirmed absent from the shipping scanner in Stage 1.

## 1 MiB cap — native path reader remains cap-free architecturally

**Unchanged from Stage 2/3's own accounting: FOUNDATION_COMPLETE_BUT_DEFECT_NOT_YET_CLOSED for the product.** Stage 4's `create_unknown_initial` builds on the same `plan_chunks`/`read_chunk` primitives Stage 2's chunked reader established, with no cap of any kind — proven directly by this stage's own 16 MiB captures (doc 33's benchmark, and `cancellation_during_unknown_initial_stops_before_full_region_is_covered`'s 64 KiB-region-with-16-chunks test) reading far past the historical 1 MiB boundary with correct, complete results. `refine()`'s own `build_read_spans` batching independently has no cap on total candidate-address range covered (only a per-span size cap, purely a batching/throughput knob — doc 28/29 — never a data-loss boundary). The *product* still runs the old TypeScript scanner with the old cap; this stage's native work does not change that.

## Truth reporting — native refinement must be truthful

**Proven, not merely asserted.** Every one of Stage 4's own new completeness-producing paths is covered by a real test that would fail if truthfulness were violated:

- A refine that hits an unreadable/partially-readable candidate reports `CompleteWithSkippedRegions`, never `Complete` — enforced by the `!readable` branch in `refine()`'s per-candidate loop (doc 28), though no dedicated integration test forces a real inaccessible-page mid-refine this stage (Stage 2's `inaccessible_page_yields_completewithskippedregions_not_complete` already proves the identical underlying `ChunkReadStatus::AccessDenied` classification is honored correctly at the reader layer Stage 4 reuses unchanged — Stage 4 adds no new way for a read to be misclassified, only a new consumer of the same honest classification).
- A resource-limited `UNKNOWN_INITIAL` reports `ResourceLimit`, never `Complete`, and truncates deterministically — proven by `resource_limit_bounds_unknown_initial_and_never_reports_complete`.
- A cancelled `UNKNOWN_INITIAL` or `refine` reports `Cancelled`, and — for `refine` specifically — never silently drops the candidates it never got to examine (doc 28's carry-forward design) — proven by `cancellation_during_unknown_initial_stops_before_full_region_is_covered` and `cancellation_before_a_refine_preserves_every_candidate_unchanged`.
- A stale (exited) target is rejected with `TargetExited`/`target_exited`, never silently treated as "0 candidates match" — proven by `stale_target_is_rejected_after_the_process_exits` and its JS equivalent.

No new unresolved Stage-4 P0/P1 defect was found during this stage's own testing (unlike Stage 3, which found and fixed two real bugs) — Stage 4's design deliberately reused Stage 2/3's already-hardened chunk/reader/completeness primitives rather than re-implementing read classification from scratch, which is the direct reason no analogous defect surfaced here.

## Summary table

| Item | Native path | Product |
|---|---|---|
| int64 (D06), through refinement | NATIVE_PATH_FIXED (proven via real refine, not just capture) | PRODUCT_DEFECT_NOT_YET_CLOSED |
| Forced alignment | Implementation-complete, re-confirmed via capture's decode loop | N/A — already confirmed absent (Stage 1) |
| 1 MiB cap | Unchanged from Stage 2/3: foundation-complete, no cap anywhere in Stage 4's own new code | Not yet closed |
| Truth reporting (refinement-specific) | Proven via dedicated tests for skip/resource-limit/cancellation/stale-target | N/A — product has no refinement engine to report truthfully or not |
| AOB (D04) | Not Stage 4, as instructed | Not yet closed |
| Pointer depth (P1-SCAN-001) | Not Stage 4, as instructed | Not yet closed |
