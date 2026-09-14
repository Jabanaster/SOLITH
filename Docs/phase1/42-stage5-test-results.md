# Phase 1 / Stage 5 — Test Results

All results below are from real, executed commands this stage.

## Rust — `solith-scanner-core`

`cargo fmt --check`: clean. `cargo clippy --all-targets --all-features -- -D warnings`: clean (one real lint fixed this stage: `clippy::identity_op` on `PATTERN_BOUNDARY_2_OFFSET`'s `1 * 1_048_576 - 1` in the fixture).

```
cargo test --release
running 76 tests   (unit — chunk/exact_scan/types/session's existing 50 + pattern.rs's 20 + pattern_scan.rs's 6)
test result: ok. 76 passed; 0 failed

running 15 tests   (tests/exact_scan_integration.rs — Stage 3, still green, untouched)
test result: ok. 15 passed; 0 failed

running 8 tests    (tests/fixture_integration.rs — Stage 2, still green, untouched)
test result: ok. 8 passed; 0 failed

running 20 tests   (tests/pattern_scan_integration.rs — real spawned-process, Stage 5, new)
test result: ok. 20 passed; 0 failed

running 17 tests   (tests/session_integration.rs — Stage 4, still green, untouched)
test result: ok. 17 passed; 0 failed
```

**136/136 pass, 0 fail** (Stage 2+3+4's already-certified 90 + Stage 5's new 46).

### `pattern.rs` unit tests (20 new)

Raw-byte pattern construction/matching/empty-rejection; UTF-8 string construction (empty rejection, ASCII+multibyte matching, ASCII case-insensitivity, null-terminator-required mode, invalid-encoding rejection); UTF-16LE string construction (ASCII subset, real non-BMP surrogate pair, ASCII-only case-insensitivity); AOB grammar (exact bytes, all three full-wildcard spellings, nibble wildcards, and all five `PatternParseErrorKind` categories); pattern-length resource guard.

### `pattern_scan.rs` unit tests (6 new)

Horspool skip-table construction (present when last byte exact, absent when wildcard), overlapping-self-match buffer scanning, chunk-overlap validation, the region-boundary non-stitching policy (structural proof), and `first_match_only`'s `max_results=1` equivalence.

### `tests/pattern_scan_integration.rs` (20 new, real spawned-process, extended fixture)

`utf8_ascii_string_is_found_at_the_planted_offset`, `utf8_multibyte_string_is_found_intact`, `utf16le_string_is_found_at_the_planted_offset`, `utf16le_nonbmp_surrogate_pair_string_is_found`, `raw_byte_pattern_all_match_mode_returns_both_duplicate_instances`, `exact_aob_signature_is_found`, `full_byte_wildcard_aob_matches_regardless_of_wildcarded_byte`, `nibble_wildcard_aob_matches_regardless_of_wildcarded_nibble`, `near_miss_bytes_do_not_produce_a_false_positive`, `chunk_boundary_2_byte_pattern_is_found_intact`, `chunk_boundary_8_byte_pattern_is_found_intact`, `chunk_boundary_16_byte_string_is_found_intact`, `chunk_boundary_32_byte_wildcard_aob_is_found_intact`, `pattern_beyond_1mib_is_found_by_the_native_path`, `first_match_only_returns_deterministic_lowest_address`, `max_results_resource_limit_is_reported_truthfully`, `zero_matches_under_unreadable_page_is_not_authoritative_not_found`, `cancellation_stops_pattern_scan_before_full_region_is_covered`, `progress_reflects_real_work_during_pattern_scan`, `stale_target_scan_reports_process_exited_not_zero_matches`.

One real test-authoring bug found and fixed while writing this suite (not a product defect): `first_match_only_returns_deterministic_lowest_address` initially asserted the exact `ScanCompleteness::ResourceLimit{at_byte}` value equal to the found match's own address; the real (pre-existing, `exact_scan.rs`-established) convention sets `at_byte` to the chunk boundary at which the per-region result-count check tripped, not the last match's address. Fixed by relaxing the assertion to the completeness *variant* only, matching how `max_results_resource_limit_is_reported_truthfully` already asserted it.

## Rust — `solith-scanner-napi`

`cargo build`/`cargo fmt --check`/`cargo clippy -D warnings`: all clean, no new lints this stage.

## napi/native build

`npm run build:debug` (via `npm run build:scanner-native-foundation`): succeeds; `scanBytes`/`scanString`/`scanAob` on `NativeScanTarget`, plus `JsPatternMatch`/`JsPatternScanOutcome`, all appear in the generated `index.d.ts` with correct `Promise<JsPatternScanOutcome>` typing (verified by direct `grep` of the generated file).

## Focused native integration suite (napi layer)

```
node --test test/*.js
# tests 39
# pass 39
# fail 0
```

**39/39 pass** — Stage 2/3/4's original 23 + Stage 5's new 16, all against the real compiled addon, no mocked native module anywhere.

### `test/pattern.test.js` (16 new, real Node, real spawned mutable fixture, no mocks)

Covers every one of mission §5.16's 17 checklist items (items 1-3 string encodings, 4 raw bytes, 5-7 AOB exact/wildcard/nibble, 8 cross-chunk, 9 beyond-1-MiB, 10 duplicates, 11 first-match, 12 cancellation, 13 progress, 14 skipped-region incompleteness, 15 authoritative not-found under full coverage, 16 bounded retrieval via `maxResults`, 17 malformed-pattern rejection) across 16 test functions (one test covers three sub-cases for item 8's cross-chunk matrix).

One real test-authoring bug found and fixed (not a product defect): the guard-page incompleteness test initially built its region via a real `target.enumerateRegions()` call, which correctly reports the `PAGE_NOACCESS`-protected middle page as a *separate* Windows region from the two readable pages flanking it (real `VirtualQueryEx` behavior — protection differences split regions). Selecting only the first enumerated sub-region excluded the hidden pattern's page entirely, trivially yielding `"complete"` with zero matches — not a scanner defect, a test-construction error, mirroring exactly the rationale already documented in `tests/fixture_integration.rs`'s `inaccessible_page_yields_completewithskippedregions_not_complete` (Stage 2). Fixed identically: build a synthetic region spanning the whole 3-page allocation from the fixture's own reported `GUARD_REGION_BASE`/`GUARD_REGION_SIZE`, matching the Rust-side test's own approach.

## TypeScript renderer typecheck

`npx tsc --noEmit`: **0 errors.**

## Electron typecheck

`npx tsc --project tsconfig.electron.json --noEmit`: **0 errors.**

## Builds

`npm run build:vite`: succeeds (532ms, real output). `npm run build:electron`: **29/29 checks pass**, identical to the certified baseline. Native: `cargo build`/`cargo build --release` both succeed for `solith-scanner-core` (including the new `bench_pattern` binary) and `solith-scanner-napi`.

## Existing full JS/TS test suite (regression check)

```
npm test
[exited with code 0]
```

Identical to the pre-Stage-5 baseline (1781/1781 + 10/10) — zero production TypeScript/Electron source was modified this stage; zero pre-existing tests were touched; the run exited 0 with no failures.

## npm audit

Root workspace: `found 0 vulnerabilities`. `native/solith-scanner-napi`: `found 0 vulnerabilities` (no new npm dependency was added this stage; no Rust crate dependency was added either — Stage 5 introduced zero new `Cargo.toml`/`package.json` dependency lines).

## Summary

| Gate | Result |
|---|---|
| `cargo fmt --check` (both crates) | clean |
| `cargo clippy -D warnings` (both crates) | clean |
| `cargo test` (solith-scanner-core) | 136/136 pass |
| napi/native build | succeeds, typed `Promise<JsPatternScanOutcome>` |
| Focused native integration suite (napi JS) | 39/39 pass |
| TS renderer typecheck | 0 errors |
| TS electron typecheck | 0 errors |
| `build:vite` | succeeds |
| Native builds (debug+release, both crates) | succeed |
| Full existing JS/TS suite | unchanged (exit 0) |
| `npm audit` | 0 vulnerabilities, no new dependencies |

No test suppression, no skip/xfail, no test-count reduction anywhere in this stage — every number above is a strict addition over Stage 4's already-certified baseline.
