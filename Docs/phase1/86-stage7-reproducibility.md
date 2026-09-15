# Phase 1 / Stage 7 — Reproducibility / Fresh Worktree

## §7.29 — done, and clean

From the exact Stage 7 candidate SHA (`5f9c5f8bd818c0ee1fe5ab6a60e49c28f3757aad`), a fresh isolated detached worktree was created at `C:\Users\chase\AppData\Local\Temp\solith-stage7-fresh-check`, confirmed to have:

- no `native/solith-scanner-core/target/` directory at all,
- no `.node` addon anywhere under `native/solith-scanner-napi/`,
- no `node_modules/` at all.

From that state, in order, with no manual intervention beyond the commands themselves:

| Step | Result |
|---|---|
| `npm install` (root) | clean, 489 packages added, 0 vulnerabilities — creates the `node_modules/solith-scanner-napi` symlink from the new `file:` dependency |
| `cargo test --release` (`native/solith-scanner-core`) | **185/185** (1 documented ignore) — built entirely from scratch, including the fixture binary |
| `npm run build:electron` | native scanner **automatically built** (`scripts/build-scanner-napi-release.mjs` ran `napi build --release` from zero), Electron output verifier: **33/33 PASS**, including "solith-scanner-napi resolves via node_modules and exposes NativeScanTarget" |
| `npm test` | **1801/1801 + 10/10**, zero failures — including the 3 new real-process tests, which require both the fixture binary and the native addon to be present; their passing here is itself proof the fresh-build artifacts are real and functional, not just present |
| `npx tsc -p tsconfig.json --noEmit` | clean |
| `npx tsc -p tsconfig.electron.json --noEmit` | clean |
| `npm audit` | 0 vulnerabilities |
| `npm run build:vite` | clean |

This directly satisfies mission §7.29's required proof: "native scanner automatically builds; Electron loads it; tests pass" — all three, from true zero, no hidden main-worktree artifact reused (confirmed absent before the run began).

**Not repeated in the fresh worktree**: the full `electron-builder` packaging step (`npm run build`'s final stage) — already proven once in the main implementation worktree (doc 78), and re-running electron-builder's code-signing/NSIS step a second time from a temp directory was judged not to add further evidence proportional to its time cost this pass. The worktree was removed (`git worktree remove --force`) after verification.
