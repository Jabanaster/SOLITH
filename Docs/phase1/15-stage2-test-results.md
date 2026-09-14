# Phase 1 / Stage 2 — Test Results

All results below are from real, executed commands on this session's machine (AMD Ryzen 7 9850X3D, Windows 11, Rust 1.95.0, Node v22.23.2), re-verified a second time from a disposable, fully clean git worktree (doc 18) with identical results.

## Rust — `solith-scanner-core`

`cargo fmt --check`: clean (0 diffs).
`cargo clippy --all-targets --all-features -- -D warnings`: clean (0 warnings, 0 errors).

`cargo test`:
```
running 16 tests   (unit — chunk.rs's inline `#[cfg(test)] mod tests`)
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

running 8 tests    (tests/fixture_integration.rs — real spawned-process integration)
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```
**24/24 pass, 0 fail.**

Unit tests (16): chunk-planning correctness across the full mission §19 matrix (region size 0 / smaller-than-chunk / exactly-chunk / chunk+1 / multi-chunk, overlap 0 / width−1 / ≥chunk-size-invalid, address-near-`u64::MAX`, arithmetic-overflow-refused ×2, partial-final-chunk, boundary-straddling-value, arbitrary-pattern-widths 1–32 bytes, and a 2000-iteration randomized property test).

Integration tests (8, each against a real spawned `solith-scanner-fixture` process): >1 MiB region full coverage + sentinel read-back, unaligned-byte read-back, chunk-boundary-straddling pattern read-back, inaccessible-page → `CompleteWithSkippedRegions` (not `Complete`), process-exit → `ProcessExited` (not hang/crash/silent-success), deterministic mid-operation cancellation, own-process architecture detection (`X64`, not `X86OnWow64`), 500-cycle handle-leak check.

## Rust — `solith-scanner-napi`

`cargo build`: clean. `cargo fmt --check`: clean. `cargo clippy --all-targets --all-features -- -D warnings`: clean (after fixing one `private_interfaces` warning on `ReadRegionTask`'s visibility, resolved during this stage).

## napi/native build

`npm run build:debug` (wraps `napi build --platform`, `@napi-rs/cli` 3.9.1): succeeds, produces `index.js`, `index.d.ts`, `solith-scanner-napi.win32-x64-msvc.node`.

## Focused native integration suite (napi layer, real JS against the compiled addon)

`npm test` (`node --test test/*.test.js`) in `native/solith-scanner-napi/`:
```
# tests 5
# pass 5
# fail 0
```
**5/5 pass.** Covers: BigInt round-trip/collision-avoidance, attach + region enumeration + architecture detection, a real async chunked read (non-blocking, sentinel-value verified), JS-initiated cancellation of an in-flight read, and a fixture-binary launch/exit sanity check.

## TypeScript renderer typecheck

`npx tsc --noEmit`: **0 errors.**

## Electron typecheck

`npx tsc --project tsconfig.electron.json --noEmit`: **0 errors.**

(Zero production TypeScript source was modified this stage — these confirm the new native crates and the additive `package.json`/`.gitignore` changes introduced no regression, as expected.)

## Builds

`npm run build:vite`: succeeds (291 modules transformed, build completes in ~3.5s; pre-existing chunk-size warnings only, unrelated to this stage).

`npm run build:electron` (includes the pre-existing `build:scanner` step for `native/solith-readonly-scanner`, then `tsup`, then the output verifier): **29/29 checks pass** — identical count and identical checks to the certified Step 0.14.1 baseline; the pre-existing native readonly-scanner build (untouched by Stage 2) still succeeds and its `.exe` still passes size-sanity checks 28–29.

## Existing full JS/TS test suite (regression check)

`npm test` (the root script — ~190 test files, ~1781 tests, plus a separate 10-test SQL-parameter-binding suite):
```
# tests 1781
# suites 310
# pass 1781
# fail 0
```
plus
```
# tests 10
# suites 1
# pass 10
# fail 0
```
**1781/1781 + 10/10 pass, 0 fail — identical to the pre-Stage-2 certified baseline (Step 0.14.1).** Zero pre-existing tests were modified, weakened, skipped, or deleted this stage. `native/solith-scanner-*` tests run under their own crate-local `cargo test`/`npm test` invocations (via `build:scanner-native-foundation`), **not** as part of this root suite — the two toolchains are additive/parallel, not merged, per Stage 2's "does not switch production scanner traffic" boundary.

## npm audit

Root workspace: `found 0 vulnerabilities`.
`native/solith-scanner-napi` (isolated `npm install`, own `package-lock.json`): `found 0 vulnerabilities`.

## Quality-gate summary

| Gate | Result |
|---|---|
| `cargo fmt --check` (both crates) | clean |
| `cargo clippy -D warnings` (both crates) | clean |
| `cargo test` (solith-scanner-core) | 24/24 pass |
| napi/native build | succeeds |
| Focused native integration suite (napi JS tests) | 5/5 pass |
| TS renderer typecheck | 0 errors |
| TS electron typecheck | 0 errors |
| `build:vite` | succeeds |
| `build:electron` | 29/29 checks pass |
| Existing scanner tests (TypeScript, untouched) | still green, part of the 1781 |
| Full existing JS/TS suite | 1781/1781 + 10/10, 0 fail (unchanged from baseline) |
| `npm audit` (root + napi package) | 0 + 0 vulnerabilities |

No test suppression, no skip/xfail, no test-count reduction anywhere in this stage.
