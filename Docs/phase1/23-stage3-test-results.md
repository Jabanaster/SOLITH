# Phase 1 / Stage 3 — Test Results

All results are from real, executed commands this stage, including a re-verification from a disposable fully-clean git worktree (doc 26).

## Rust — `solith-scanner-core`

`cargo fmt --check`: clean. `cargo clippy --all-targets --all-features -- -D warnings`: clean (after fixing two real lints this stage: `manual_is_multiple_of`, `too_many_arguments`, and two `approx_constant` false-positive-but-real deliberate float literals, annotated `#[allow]` with a comment explaining why).

```
cargo test
running 35 tests   (unit — chunk.rs, exact_scan.rs, types.rs's inline #[cfg(test)] modules)
test result: ok. 35 passed; 0 failed

running 15 tests   (tests/exact_scan_integration.rs — real spawned-process, Stage 3)
test result: ok. 15 passed; 0 failed

running 8 tests    (tests/fixture_integration.rs — real spawned-process, Stage 2, still green)
test result: ok. 8 passed; 0 failed
```
**58/58 pass, 0 fail** (Stage 2's 24 + Stage 3's 34 new).

Stage 3 unit tests (19 new, in `exact_scan.rs`/`types.rs`): bytewise/aligned discovery including the mission's literal 4-consecutive-offset u32 example, absolute-address-based (not chunk-relative) alignment, no-hidden-4-byte-stride confirmation for i16/u16, decoy-noise false-positive resistance, `validate_options` rejecting insufficient overlap, `ScanOptions::default_for`'s auto-widening, a 500-iteration randomized property test across all 10 types, plus 11 `types.rs` tests (round-trip for every type including zero/min/max, beyond-safe-integer i64/u64, float specials, malformed-input rejection, LE-convention confirmation).

Stage 3 integration tests (15, each against the real, extended spawned-process fixture): every primitive type found at its planted offset, u64 beyond safe-integer found exactly, repeated value → exactly two ordered addresses, all three boundary widths (2/4/8 bytes) found exactly once without duplication, bytewise unaligned discovery, aligned-mode exclusion of unaligned candidates (real process), NaN never self-matching against a real NaN bit pattern, +Infinity self-matching, incomplete-vs-complete zero-match distinction (both directions), resource-limit truncation, deterministic mid-scan cancellation, process-exit truthfulness, up-front overlap-validation rejection, and real-enumeration region discovery.

## Rust — `solith-scanner-napi`

`cargo build`/`cargo fmt --check`/`cargo clippy -D warnings`: all clean (one `private_interfaces` warning on `ExactScanTask`'s visibility fixed during this stage, matching the identical Stage 2 pattern on `ReadRegionTask`).

## napi/native build

`npm run build:debug`: succeeds; `scanExact` appears in the generated `index.d.ts` with the precise signature in doc 22, including the `ts_return_type`-hinted `Promise<JsExactScanOutcome>` (not a generic `Promise<unknown>`).

## Focused native integration suite (napi layer)

```
npm test
# tests 12
# pass 12
# fail 0
```
**12/12 pass** — Stage 2's original 5 (attach/enumerate, async read, cancellation, BigInt round-trip, fixture sanity) + Stage 3's 7 new (every-type discovery, cross-chunk boundary retrieval, u64-beyond-safe-integer, cancellation, progress, incomplete-vs-complete, bounded paging), all against the real compiled addon — no mocked native module anywhere in this suite.

## TypeScript renderer typecheck

`npx tsc --noEmit`: **0 errors.**

## Electron typecheck

`npx tsc --project tsconfig.electron.json --noEmit`: **0 errors.**

## Builds

`npm run build:vite`: succeeds. `npm run build:electron`: **29/29 checks pass**, identical to the Stage 2 and original certified baseline.

## Existing full JS/TS test suite (regression check)

```
# tests 1781 / # pass 1781 / # fail 0
# tests 10   / # pass 10   / # fail 0
```
**1781/1781 + 10/10 pass, 0 fail — identical to the pre-Stage-3 baseline.** Zero production TypeScript/Electron source was modified this stage; zero pre-existing tests were touched.

## npm audit

Root workspace: `found 0 vulnerabilities`. `native/solith-scanner-napi`: unchanged from Stage 2's `0 vulnerabilities` (no new JS dependency was added this stage).

## Summary

| Gate | Result |
|---|---|
| `cargo fmt --check` (both crates) | clean |
| `cargo clippy -D warnings` (both crates) | clean |
| `cargo test` (solith-scanner-core) | 58/58 pass |
| napi/native build | succeeds, typed `Promise<JsExactScanOutcome>` |
| Focused native integration suite (napi JS) | 12/12 pass |
| TS renderer typecheck | 0 errors |
| TS electron typecheck | 0 errors |
| `build:vite` | succeeds |
| `build:electron` | 29/29 checks pass |
| Full existing JS/TS suite | 1781/1781 + 10/10, unchanged |
| `npm audit` | 0 vulnerabilities |

No test suppression, no skip/xfail, no test-count reduction anywhere in this stage — every number above is a strict addition over Stage 2's already-certified baseline.
