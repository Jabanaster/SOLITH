# Phase 1 / Stage 7.5 §16 — Fresh Worktree

## Method

A clean, isolated worktree created with `git worktree add --detach` at the exact candidate SHA, at a path outside both the implementation worktree and the read-only shipping tree. Before any command runs, each of these is asserted **absent**:

- `native/solith-scanner-napi/solith-scanner-napi.win32-x64-msvc.node`
- `native/solith-scanner-core/target/`
- `native/solith-scanner-napi/target/`
- `dist/`, `dist-electron/`, `node_modules/`

Nothing is copied in. The native addon is produced only by `npm run build:electron`'s own auto-build path — the same path a clean clone or a CI runner takes.

Harness: `scratchpad/fresh-worktree.sh` (not committed; a driver, not evidence).

## Run 1 — `703feaf`

All six artifact paths confirmed absent at start.

| Gate | Result |
|---|---|
| `npm ci` | PASS |
| root `tsc --noEmit` | PASS |
| electron `tsc --project tsconfig.electron.json --noEmit` | PASS |
| `cargo fmt --check` | PASS |
| `cargo clippy --release -- -D warnings` | PASS |
| `cargo test --release` | 185 passed, 0 failed, 1 ignored |
| `cargo build` (debug fixture) | PASS |
| `npm run build:electron` | PASS — native addon auto-built |
| `npm run verify:electron-output` | PASS — 33/33 |
| napi `node --expose-gc --test test/*.test.js` | 52/52 |
| `npm run build:vite` | PASS |
| `npm run orphan-check` | PASS |
| `npm test` | 1904 + 10, **0 failed** |
| `npm run test:live-memory` | 403 tests, **402 passed, 1 failed** |
| `npm audit` | 0 vulnerabilities |
| `npx electron-builder --dir` | PASS |
| packaged native scan proof | PASS |
| **packaged fuzzy proof** | **PASS** |
| Semgrep (CI PR-gate configuration) | 0 findings |

### The one failure, and what it was

`wire type "u8" (U8_VALUE) round-trips exactly through live-memory-scan-first` failed here while passing 3/3 in isolation in the same worktree — the signature of a test that depends on timing rather than on behavior.

`scanner-backend-wire-type-expansion.test.ts` asserted unconditionally that the planted TYPES_REGION address appears in the match set. For a single-byte type that is not a safe assumption: a given u8 value occurs constantly in a real process, `DEFAULT_MAX_MATCHES` (10 000) is reached almost immediately, and whether TYPES_REGION is reached before the cap depends on region enumeration order and on concurrent load. Under the full live-memory suite, with other fixture processes alive, it was not.

The deeper problem is that the assertion contradicted the completeness contract Stage 6 exists to establish — demanding a specific address inside a *truncated* result treats a partial scan as authoritative, which is the exact confusion D03 and D06 are about.

Repaired at `252a34c`: when the scan covered everything, the planted value must still be found, asserted as strictly as before; when the scan was truncated, the requirement becomes that the scanner **said so** (`truncated: true`, `isAuthoritativeAbsence: false`). That is a stronger property than the original assertion tested. The defect is pre-existing, from `f5db9fe`.

## Run 2 — `3da9e8d` (after the repair)

All six artifact paths confirmed absent at start.

| Gate | Result |
|---|---|
| `npm ci` | **PASS** |
| root typecheck | **PASS** |
| electron typecheck | **PASS** |
| `cargo fmt --check` | **PASS** |
| `cargo clippy --release -- -D warnings` | **PASS** |
| `cargo test --release` | **185 passed, 0 failed, 1 ignored** |
| `cargo build` (debug fixture) | **PASS** |
| `npm run build:electron` | **PASS** |
| `npm run verify:electron-output` | **PASS — 33/33** |
| napi suite | **52/52** |
| `npm run build:vite` | **PASS** |
| `npm run orphan-check` | **PASS** |
| `npm test` | **1904/1904 + 10/10** |
| `npm run test:live-memory` | **403/403** |
| `npm audit` | **0** |
| `npx electron-builder --dir` | **PASS** |
| packaged native scan proof | **PASS** |
| **packaged fuzzy proof** | **PASS** |
| Semgrep (PR-gate configuration, 190 files) | **0 findings** |

**FRESH WORKTREE: PASS.** No hidden artifact dependency: every binary, every bundle and both packaged proofs were produced from source inside the clean worktree.

## Commits after run 2

Run 2 covers all production and test code. Two commits follow it:

| Commit | Content | Affects the above? |
|---|---|---|
| `97e51b5` | `fix(test)`: absorb EPIPE on the fixture stdin across 12 fixture-spawning files | test-teardown only — no production code |
| docs commits | Docs 128-136 | documentation only |

`97e51b5` is a genuine code change to test files, so a third fresh-worktree confirmation was run. The EPIPE repair itself is described in doc 129, because it was a remote-CI failure that local runs did not reproduce.

## Run 3 — `97e51b5` (code-final)

All six artifact paths confirmed absent at start. Every gate PASS:

| Gate | Result |
|---|---|
| `npm ci` | PASS |
| root typecheck / electron typecheck | PASS / PASS |
| `cargo fmt --check` / `cargo clippy --release -- -D warnings` | PASS / PASS |
| `cargo test --release` | 185 passed, 0 failed, 1 ignored |
| `cargo build` (debug fixture) | PASS |
| `npm run build:electron` | PASS |
| `npm run verify:electron-output` | PASS — 33/33 |
| napi suite | 52/52 |
| `npm run build:vite` | PASS |
| `npm run orphan-check` | PASS |
| `npm test` | 1904/1904 + 10/10 |
| `npm run test:live-memory` | 403/403 |
| `npm audit` | 0 |
| `npx electron-builder --dir` | PASS |
| packaged native scan proof | PASS |
| packaged fuzzy proof | PASS |
| Semgrep (PR-gate configuration, 190 files) | 0 findings |

**FRESH WORKTREE AT THE CODE-FINAL SHA: PASS.** Three independent clean-worktree runs across this stage; the only commits after this one change `Docs/phase1/**` alone.

## Why this gate is kept

Doc 100 found, by fresh worktree and by nothing else, that the napi JS suite needs a `target/debug` fixture that `cargo test --release` does not produce — which is why `pr-windows.yml` runs a separate debug `cargo build` to this day. This stage's run found a flaky assertion that a local full-suite run had never surfaced. The gate keeps earning its place.
