# Phase 1 / Stage 7.4 §18 — Final Fresh Worktree Reproducibility

## Genuinely from zero, at the exact final candidate SHA

Candidate SHA: `bad9caf25c4cc22a97baa0ed6c1069bb2536c6ae` (this pass's final "docs" commit). A disposable, isolated, detached worktree was created via `git worktree add --detach` at a temp path outside any existing worktree, confirmed absent of `node_modules`, `native/solith-scanner-core/target/`, and `dist/` before anything was run.

| Step | Result |
|---|---|
| `npm install` | clean, 489 packages, **0 vulnerabilities** |
| `cargo fmt --check` | clean |
| `cargo clippy --release -- -D warnings` | clean, from scratch |
| `npm run build:electron` | native addon **automatically built** (no manual cargo/napi step), Electron output verifier **33/33 PASS** |
| `cargo test --release` | **185/185** (1 documented ignore) |
| `cargo build` (debug, napi fixture dependency) | clean |
| napi tests (`node --expose-gc --test test/*.test.js`) | **52/52** |
| `npx tsc -p tsconfig.json --noEmit` (renderer) | clean |
| `npx tsc -p tsconfig.electron.json --noEmit` (electron) | clean |
| `npm run build:vite` | clean (pre-existing chunk-size advisory only, not an error) |
| `npm test` (full JS/TS) | **1869/1869 + 10/10**, zero failures |
| `npx electron-builder --dir --win` | clean, real signing, real native rebuild |
| `node scripts/verify-packaged-native-scan.mjs` | **PASS** — real scan through the packaged addon (sentinel u32), plus the new u16-unaligned/u64::MAX/AOB smoke checks all **PASS**. SHA-256 `7d713e302db0feae41f154613d45dd6c09afb955babb18c926eb460f3f377e81` (independently recomputed in the fresh worktree — differs from the primary worktree's `6313773b...` only because the addon was rebuilt from source in a new location; both real, both pass) |
| Default backend, zero override, real attach to a real spawned fixture process, real u16/u64/AOB scans | `DEFAULT_MODE: NATIVE`; u16 boundary value found (`U16_BACKEND: native`); u64::MAX found exactly (`U64_BACKEND: native`, exact BigInt match confirmed); AOB pattern found (`AOB_BACKEND: native`) — the fresh-worktree build genuinely closes every named Stage 7.4 defect with zero manual configuration |

No hidden artifacts were copied from the primary implementation worktree — everything above was produced by the canonical commands alone, run in a location that started genuinely empty of every generated artifact.

## Conclusion

The canonical build pipeline reproduces the fully certified Stage 7.4 state — including u16/u64 wire support, alignment closure, and AOB caller migration, all defaulting to NATIVE — from true zero, at the exact candidate SHA. The disposable worktree was removed (`git worktree remove --force`) after evidence capture; `git worktree list` confirms all 25 other pre-existing worktrees in `G:\ACTIVE_PROJECTS\` remain untouched.

**FRESH WORKTREE: PASS.**
