# Phase 1 / Stage 7 Final Closure — Fresh Worktree Reproducibility

## §19/§29 — genuinely from zero, at the exact final candidate SHA

From candidate SHA `3d4f6f8947926c326bfd9592a5ad39e8d8a4423c` (the final "docs" commit of this closure pass), a fresh isolated detached worktree was created at `C:\Users\chase\AppData\Local\Temp\solith-final-closure-fresh`, confirmed absent of `node_modules`, `native/solith-scanner-core/target/`, any `.node` file, `dist/`, and `dist-electron/` before anything was run.

| Step | Result |
|---|---|
| `npm install` | clean, 489 packages, 0 vulnerabilities |
| `cargo fmt --check` (release fixture context) | clean |
| `cargo clippy --release -- -D warnings` | clean, from scratch |
| `cargo test --release` | **185/185** (1 documented ignore) |
| `npm run build:electron` | native addon **automatically built** (no manual cargo/napi step), Electron output verifier **33/33 PASS** |
| napi tests (`node --expose-gc --test test/*.test.js`) | **initially 2/52 pass, 50/52 fail** — see honest finding below — **52/52 after fix** |
| `npm test` (full JS/TS) | **1813/1813 + 10/10**, zero failures |
| `npx tsc -p tsconfig.json --noEmit` (renderer) | clean |
| `npx tsc -p tsconfig.electron.json --noEmit` (electron) | clean |
| `npm run build:vite` | clean (pre-existing chunk-size advisory warning only, not an error) |
| `npm audit` | 0 vulnerabilities |
| `npx electron-builder --dir --win` | clean, real signing, real native rebuild |
| `node scripts/verify-packaged-native-scan.mjs` | **PASS** — real scan through the packaged addon, resolved path confirmed under `dist/win-unpacked`, never `node_modules` |

## Honest finding from this fresh-worktree pass: napi tests need BOTH release and debug fixture builds

Running only `cargo test --release` (which builds `native/solith-scanner-core/target/release/solith-scanner-fixture.exe`) left the napi test suite unable to run — it looks for the fixture at `target/debug/solith-scanner-fixture.exe`, which only a plain `cargo test` or `cargo build` (debug profile) produces. This is not a regression introduced by this closure pass (the napi test suite's fixture-path expectation predates it) — it is a genuine, previously-undocumented fresh-environment gap: nothing in this repo's docs or scripts states that the napi test suite needs a **debug** fixture build specifically, separate from the release build the main canonical pipeline (`build:electron`) produces. Running plain `cargo test` (debug) in `native/solith-scanner-core` resolved it immediately — 185/185 again (1 ignore) — and the napi suite then passed 52/52.

**This is disclosed rather than silently worked around**: mission §17/CI truth (doc 101) already correctly reports that napi tests are never run in any CI workflow — this finding is additional evidence for why that gap matters (a naive "just run napi tests in CI" fix would hit exactly this same fixture-path trap without first also building the debug profile).

## Conclusion

Aside from the disclosed debug-fixture-build step (a genuine, pre-existing documentation gap, not a regression), the canonical build pipeline reproduces the fully certified state from true zero, with no artifact copied from the primary implementation worktree. The disposable worktree was removed (`git worktree remove --force`) after evidence capture.
