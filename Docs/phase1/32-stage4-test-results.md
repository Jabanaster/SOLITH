# Phase 1 / Stage 4 — Test Results

All results below are from real, executed commands this stage.

## Rust — `solith-scanner-core`

`cargo fmt --check`: clean. `cargo clippy --all-targets --all-features -- -D warnings`: clean (two real lints fixed this stage: a `too_many_arguments` on `record_generation`, and a Windows-only `#[allow(dead_code)]`-avoiding real getter added for `chunk_config` rather than suppressing the warning — see doc 27).

```
cargo test
running 50 tests   (unit — chunk.rs/exact_scan.rs/types.rs's existing 35 + session.rs's new 15)
test result: ok. 50 passed; 0 failed

running 15 tests   (tests/exact_scan_integration.rs — Stage 3, still green, untouched)
test result: ok. 15 passed; 0 failed

running 8 tests    (tests/fixture_integration.rs — Stage 2, still green, untouched)
test result: ok. 8 passed; 0 failed

running 17 tests   (tests/session_integration.rs — real spawned-process, Stage 4, new)
test result: ok. 17 passed; 0 failed
```

**90/90 pass, 0 fail** (Stage 2+3's already-certified 58 + Stage 4's new 32).

### `session.rs` unit tests (15 new)

`CandidateStore` round-trip and memory-formula tests, `build_read_spans` merge/split/cap behavior, `CHANGED`/`UNCHANGED` mutual exclusivity, NaN-is-always-changed, signed/unsigned `INCREASED`/`DECREASED` direction, NaN-never-orders, checked-arithmetic overflow/underflow rejection for `INCREASED_BY`/`DECREASED_BY`, inclusive `BETWEEN`, `validate_refine_mode`'s three rejection cases (inverted bounds, NaN bounds, mismatched delta type), and a 500-iteration randomized property test confirming `INCREASED`/`DECREASED` agree with direct signed comparison for arbitrary value pairs.

### `tests/session_integration.rs` (17 new, real spawned-process, extended mutable fixture)

`unknown_initial_captures_the_exact_value_just_written`, `changed_and_unchanged_partition_correctly_after_a_real_write`, `unchanged_survives_only_the_untouched_candidate`, `increased_and_decreased_respect_direction_against_real_writes`, `increased_by_matches_an_exact_delta_and_rejects_a_different_change`, `decreased_by_never_matches_a_real_unsigned_underflow`, `between_filters_a_real_written_value_by_inclusive_range`, `float_refinement_handles_nan_and_infinity_against_real_memory`, `u64_beyond_js_safe_integer_survives_a_real_refine_exactly`, `stale_target_is_rejected_after_the_process_exits`, `a_second_independent_session_is_unaffected_by_the_first_process_dying`, `cancellation_before_a_refine_preserves_every_candidate_unchanged`, `cancellation_during_unknown_initial_stops_before_full_region_is_covered`, `resource_limit_bounds_unknown_initial_and_never_reports_complete`, `generation_history_records_every_refine_and_respects_retention_cap`, `candidates_page_is_bounded_and_deterministically_ordered`, `repeated_create_refine_close_cycles_do_not_leak_os_handles` (uses real `GetProcessHandleCount`/`GetCurrentProcess` via a scoped dev-dependency on `windows-sys`, see doc 35).

## Rust — `solith-scanner-napi`

`cargo build`/`cargo fmt --check`/`cargo clippy -D warnings`: all clean (one real lint fixed this stage: `too_many_arguments` on the new `refine_mode_from_js` helper, same pattern as Stage 3's `scan_exact` method).

## napi/native build

`npm run build:debug`: succeeds; `NativeScanSession` with `createUnknownInitial`/`refine`/`getResults`/`generationHistory`/`status`/`close`/`isInitialized`, plus `JsRefineOutcome`/`JsSessionStatus`/`JsGenerationRecord`, all appear in the generated `index.d.ts` with correct `Promise<JsRefineOutcome>` return typing on the two async methods (verified by direct `grep` of the generated file, not just "it compiled").

## Focused native integration suite (napi layer)

```
npm test
# tests 23
# pass 23
# fail 0
```

**23/23 pass** — Stage 2's original 5 + Stage 3's 7 + Stage 4's new 11, all against the real compiled addon — no mocked native module anywhere in this suite.

### `test/session.test.js` (11 new, real Node, real spawned mutable fixture, no mocks)

Covers every one of mission §4.17's 20 checklist items: spawn mutable fixture (1), create unknown-initial session (2), mutate subset via real `write` commands (3), CHANGED (4)/UNCHANGED (5), real increase (6)/INCREASED (7), real decrease (8)/DECREASED (9), exact-delta mutation (10)/INCREASED_BY+DECREASED_BY (11), range mutation (12)/BETWEEN (13), BigInt value refinement of a real u64 beyond `Number.MAX_SAFE_INTEGER` (14), progress (15), cancellation (16), stale-process rejection (17), paged result retrieval (18), session close (19), and a 5-cycle repeated create/refine/close loop with no leaked/crashed state (20).

One real test-authoring bug was found and fixed while writing this suite (not a product defect): the fixture's ~40 `KEY=VALUE` startup lines commonly arrive in a single stdout chunk, faster than a naive one-line-at-a-time async consumer could register a new waiter between lines — the original line-reader used a single-slot waiter (`lineWaiters.shift()(line)`), which threw on the second-and-later line in a burst chunk (`shift()` returning `undefined`, then calling `undefined(line)`). Fixed with a proper backlog queue (push to `lineQueue` when no waiter is ready; `nextLine()` drains the queue first) — the same "message queue, not a single mailbox" fix any async line-protocol consumer needs. A second, smaller fix: `assert.rejects(() => session.refine(...))` against an *uninitialized/closed* session failed because that specific rejection is a **synchronous** throw (validated before any `Promise`/`AsyncTask` is constructed, per doc 31) rather than a promise rejection — wrapping the callback in `async () => ...` fixed it, and this exact synchronous-vs-asynchronous-throw distinction is now documented in doc 31 so a future reader isn't surprised by it either.

## TypeScript renderer typecheck

`npx tsc --noEmit`: **0 errors.**

## Electron typecheck

`npx tsc --project tsconfig.electron.json --noEmit`: **0 errors.**

## Builds

`npm run build:vite`: succeeds. `npm run build:electron`: **29/29 checks pass**, identical to the Stage 2/3 and original certified baseline. Native: `cargo build`/`cargo build --release` both succeed for `solith-scanner-core` (including the new `bench_session` binary) and `solith-scanner-napi`.

## Existing full JS/TS test suite (regression check)

```
# tests 1781 / # pass 1781 / # fail 0
# tests 10   / # pass 10   / # fail 0
```

**1781/1781 + 10/10 pass, 0 fail — identical to the pre-Stage-4 baseline.** Zero production TypeScript/Electron source was modified this stage; zero pre-existing tests were touched.

## npm audit

Root workspace: `found 0 vulnerabilities`. `native/solith-scanner-napi`: `found 0 vulnerabilities` (no new JS dependency was added this stage; the new `windows-sys` dev-dependency in `solith-scanner-core`'s `Cargo.toml` is a Rust crate, not an npm package, and is the exact same crate/version already used as a main dependency — see doc 35).

## Summary

| Gate | Result |
|---|---|
| `cargo fmt --check` (both crates) | clean |
| `cargo clippy -D warnings` (both crates) | clean |
| `cargo test` (solith-scanner-core) | 90/90 pass |
| napi/native build | succeeds, typed `Promise<JsRefineOutcome>` |
| Focused native integration suite (napi JS) | 23/23 pass |
| TS renderer typecheck | 0 errors |
| TS electron typecheck | 0 errors |
| `build:vite` | succeeds |
| `build:electron` | 29/29 checks pass |
| Full existing JS/TS suite | 1781/1781 + 10/10, unchanged |
| `npm audit` (root + napi package) | 0 vulnerabilities |

No test suppression, no skip/xfail, no test-count reduction anywhere in this stage — every number above is a strict addition over Stage 3's already-certified baseline.
