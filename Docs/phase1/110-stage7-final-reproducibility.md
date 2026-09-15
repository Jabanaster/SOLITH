# Phase 1 / Stage 7.3 §24 — Final Fresh Worktree Reproducibility

## Genuinely from zero, at the exact final candidate SHA

Candidate SHA: `fb5f7d0e58301d68c943e8b20fc2b789d806add5` (the final "docs" commit of this closure pass). A disposable, isolated, detached worktree was created via `git worktree add --detach` at a temp path, confirmed absent of `node_modules`, `native/solith-scanner-core/target/`, any `.node` file, and `dist/` before anything was run.

| Step | Result |
|---|---|
| `npm install` | clean, 489 packages, **0 vulnerabilities** |
| `cargo fmt --check` | clean |
| `cargo clippy --release -- -D warnings` | clean, from scratch |
| `npm run build:electron` | native addon **automatically built** (no manual cargo/napi step), Electron output verifier **33/33 PASS** |
| `cargo test --release` | **185/185** (1 documented ignore) |
| `cargo build` (debug, napi fixture dependency) | clean |
| napi tests (`node --expose-gc --test test/*.test.js`) | **52/52** |
| `npm test` (full JS/TS) | **1836/1836 + 10/10**, zero failures |
| `npx tsc -p tsconfig.json --noEmit` (renderer) | clean |
| `npx tsc -p tsconfig.electron.json --noEmit` (electron) | clean |
| `npm run build:vite` | clean (pre-existing chunk-size advisory only, not an error) |
| `npm audit` | 0 vulnerabilities |
| `npx electron-builder --dir --win` | clean, real signing, real native rebuild |
| `node scripts/verify-packaged-native-scan.mjs` | **PASS** — real scan through the packaged addon, resolved path confirmed under `dist/win-unpacked`, SHA-256 `f59715f4f80ef14c3b155baffde9318ca8910547636f00f9801d822449310f6a` (independently recomputed in the fresh worktree — differs from the primary worktree's `6313773b...` only because the addon was rebuilt from source in a new location; both are real, both pass) |
| Default backend, zero override, real attach to a real spawned fixture process | **`DEFAULT_MODE: NATIVE`, `SCAN_BACKEND: native`** — the fresh-worktree build genuinely defaults to native with no manual step |

No hidden artifacts were copied from the primary implementation worktree — everything above was produced by the canonical commands alone, run in a location that started genuinely empty of every generated artifact.

## Conclusion

The canonical build pipeline reproduces the fully certified state — including the new NATIVE production default — from true zero, at the exact candidate SHA. The disposable worktree was removed (`git worktree remove --force`) after evidence capture; `git worktree list` confirms all 25 other pre-existing worktrees in `G:\ACTIVE_PROJECTS\` remain untouched.

**FRESH WORKTREE: PASS.**
