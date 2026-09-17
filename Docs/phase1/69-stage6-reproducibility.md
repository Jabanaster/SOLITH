# Phase 1 / Stage 6 — Full Verification and Fresh-Worktree Reproducibility

## §6.27 — full verification battery

Run at the implementation-candidate commit `92644d647bfaf2359c23367eef82c82307e07705` (after the three `feat` commits and the `test` commit, before the docs-only commits).

**Rust (`native/solith-scanner-core`):**

| Check | Result |
|---|---|
| `cargo fmt --check` | Clean |
| `cargo clippy --all-targets --all-features -- -D warnings` | Clean |
| `cargo test --release` | 185/185 (110 unit + 17 exact_scan_integration + 8 fixture_integration + 23 pattern_scan_integration + 5 region_mutation_integration + 17 session_integration + 5 stress_and_concurrency_integration); 1 additional `#[ignore]`d Stage 5.4 manual-only perf test, unchanged, not counted in the default gate |

**napi (`native/solith-scanner-napi`):**

| Check | Result |
|---|---|
| `cargo fmt --check` / `cargo clippy --all-targets --all-features -- -D warnings` | Clean |
| Clean native build (`npm run build`) | Success |
| All napi JS tests (`npm test`) | 51/51 + 1 documented skip (the GC test, without `--expose-gc`) = 52 declared, 0 failed; 52/52 when run with `node --expose-gc --test test/*.test.js` |
| `npm audit` | 0 vulnerabilities |

**SOLITH root:**

| Check | Result |
|---|---|
| Full JS/TS suite (`npm test`) | 1,781/1,781 + 10/10 (sql-parameter-binding), exit 0 — unchanged from Stage 5.4, confirming zero regression from native-only changes |
| Renderer typecheck (`tsc --noEmit -p tsconfig.json`) | 0 errors |
| Electron typecheck (`tsc --noEmit -p tsconfig.electron.json`) | 0 errors |
| `npm run build:vite` | Success |
| `npm run build:electron` | Success — 29/29 output-verifier checks passed |
| `npm audit` (root) | 0 vulnerabilities |

**No ROADMAP.md changes** (confirmed empty diff). **No production scanner switch** (confirmed: only `native/` and `Docs/` changed against the Stage 5.4 baseline).

## §6.28 — fresh isolated worktree

A disposable, detached `git worktree add --detach` was created at the exact implementation-candidate SHA `92644d647bfaf2359c23367eef82c82307e07705`, confirmed absent of any pre-existing native artifacts before building (`native/solith-scanner-core/target`, root `node_modules`, and `native/solith-scanner-napi/*.node` all confirmed not present immediately after checkout).

| Check | Result |
|---|---|
| Rust build (debug + release) | Success |
| Rust tests | 185/185 (identical breakdown to the in-place run above) |
| napi clean install + build | Success, 0 vulnerabilities |
| napi tests | 51/51 + 1 documented skip |
| Full JS/TS suite | 1,781/1,781 + 10/10 |
| Both typechecks | 0 errors each |
| `npm run build:vite` | Success |
| `npm run build:electron` | Success — 29/29 checks passed |

No hidden artifact dependence — every result above was produced by a from-scratch `npm install`/`cargo build` in a worktree that started with none of the previous worktree's build output. The fresh worktree was removed (`git worktree remove --force`) immediately after verification; no changes were made inside it, so nothing was discarded.

## Zero regressions

Every test that passed at the end of Stage 5.4 (157 Rust + 46 napi + 1,781+10 JS/TS) still passes; every new Stage 6 test (28 new Rust integration tests across two new test files plus additions to two existing ones, 3 new napi misuse/persistence tests, 2 new persistence-round-trip tests, 1 GC test) passes as well.
