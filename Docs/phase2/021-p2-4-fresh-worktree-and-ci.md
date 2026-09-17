# Phase 2 P2-4 — Fresh Worktree and Remote CI

## Fresh worktree (mission §28)

`git worktree add ../solith-p24-fresh-worktree 2857b89e508a3be81316af688b21f3a2df947219 --detach` — the exact final P2-4 commit, no copied `dist`/`dist-electron`/`node_modules` native output/Rust `target`/`.node` artifacts. Canonical setup from that checkout alone (`npm install`, `build:electron`, `cargo build --release --bin solith-scanner-fixture`, `build:vite`), then every required gate:

| Gate | Result |
|---|---|
| `npm install` | Clean, 0 vulnerabilities |
| `build:electron` | 33/33 output-verifier checks PASS |
| Fixture `cargo build --release` | Clean |
| `build:vite` | Clean |
| Renderer + electron typecheck | PASS |
| Focused P2-3/P2-4 suite (excluding the 10-restart campaign) | 188/188 PASS |
| 10-restart real-process campaign | 10/10 PASS (independently reproduced, real ASLR/heap relocation observed identically) |
| Real-process critical flow (`test:pointer-map-ui-real-process`) | 3/3 certification PASS (one earlier ad-hoc run failed at the same cold-start-after-fresh-build Attach step documented in P2-3.1 — not part of the official 3-run certification block, and did not recur) |
| Real-process cancellation e2e | PASS |
| Real-process stability (Validate After Restart) e2e | PASS |
| `test:live-memory` | 554/554 PASS, 0 fail, 0 cancelled |
| `npm test` (root) | 2102/2102 + 10/10 PASS, 0 fail, 0 cancelled |
| `electron-builder --dir --win --x64` | Succeeded |
| Packaged UI proof | PASS |
| Packaged cancellation proof | PASS |

Every count is byte-identical to what the authoritative worktree (`solith-phase0-convergence`) produced at the same commit. No leftover fixture/Electron processes were found before removal; the worktree was removed with `git worktree remove ../solith-p24-fresh-worktree --force` afterward and `git worktree list` confirms it no longer appears.

## Remote CI (mission §29)

Every workflow in `.github/workflows/` triggers only on `pull_request`/`push` against `master` (or, for `ci-fast.yml`, `cursor/**`) — none run on a plain feature-branch push, matching the exact structural constraint P2-3.1 already documented. Mission §16 explicitly requires `feature/solith-phase2-pointer-stability` stay isolated from PR #32's certified P2-3 head, so a **separate** PR was opened from this branch (rather than reusing or moving PR #32) to obtain real CI results — see the P2-4 final certification report for its number and exact result. PR #32 itself was not touched.
