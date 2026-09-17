# Phase 2 P2-3.1 — Fresh Worktree Proof

Mission §15: at the exact code-final SHA, a new clean worktree — no copied `dist`, `dist-electron`, `node_modules` native output, Rust `target`, or `.node` artifacts — must independently reproduce every gate.

## Setup

`git worktree add ../solith-p231-fresh-worktree cbf13aa25876e87e8881c064e88dff03249aa230 --detach` (the exact commit `test(pointer): stress pointer discovery and cancellation` landed at), then canonical setup from that checkout alone:

- `npm install` — 489 packages, 0 vulnerabilities, patch-package + electron-builder install-app-deps ran clean.
- `npm run build:electron` — runs the native `build:scanner` step, the napi release build, `tsup`, and the 33-point output verifier from a completely fresh checkout.
- `cargo build --release --bin solith-scanner-fixture` (native/solith-scanner-core) — the test-only fixture binary, not part of `build:electron`.
- `npm run build:vite`.

## Results — every gate independently reproduced

| Gate | Result |
|---|---|
| `npm install` | Clean, 0 vulnerabilities |
| `build:electron` (native scanner + napi + bundle) | 33/33 output-verifier checks PASS |
| Fixture `cargo build --release` | Clean |
| `build:vite` | Clean |
| Renderer typecheck (`tsconfig.json`) | PASS |
| Electron typecheck (`tsconfig.electron.json`) | PASS |
| Focused P2-3 suite (pointer-scanner\*, pointer-map\*, memory-scanner-truth-matrix, live-memory-session-pointer-map, pointer-map-ui) | 160/160 PASS |
| Real-process critical flow (`test:pointer-map-ui-real-process`) | 3/3 PASS |
| Real-process cancellation (`test:pointer-map-ui-cancellation`) | 3/3 PASS |
| `test:live-memory` | 532/532 PASS, 0 fail, 0 cancelled |
| `npm test` (root) | 2074/2074 + 10/10 PASS, 0 fail, 0 cancelled |
| `electron-builder --dir --win --x64` | Succeeded |
| Packaged UI proof (`test:pointer-map-ui-packaged`) | 1/1 PASS |
| Packaged cancellation proof (`test:pointer-map-ui-cancellation-packaged`) | 1/1 PASS |

Every number here is byte-identical to what the main authoritative worktree (`solith-phase0-convergence`) produced at the same commit — this is independent confirmation, not a restatement.

## Cleanup

No leftover `solith-scanner-fixture.exe`/`Solith.exe`/Electron processes were found before removal (verified via a targeted `tasklist` filter). The verification worktree was removed with `git worktree remove ../solith-p231-fresh-worktree --force` after all gates passed; `git worktree list` confirms it no longer appears, and the main worktree's own state was untouched throughout.
