# Phase 2 P2-4.1 — Fresh Worktree, Full Local Regression, and Remote CI (No-Retry Certification)

## Worktree isolation (mission §0, standing rule going forward)

This entire stage was done in a dedicated, newly created worktree/branch pair (`G:\ACTIVE_PROJECTS\solith-phase2-pointer-stability-closeout`, `feature/solith-phase2-pointer-stability-closeout`, forked from P2-4's certified head `0711205c1470336eebd84ccb86a1a08523838526`), never in the shared `solith-phase0-convergence` worktree — which was found to have a separate, legitimate peer Claude session's uncommitted debug changes in flight. Per the user's explicit standing rule ("ONE ACTIVE CLAUDE SESSION = ONE WORKTREE"), that worktree's files were never read for editing, staged, committed, stashed, or reset.

## Full local regression matrix (mission §14)

All run against the isolated dev worktree at the final candidate SHA:

| Gate | Result |
|---|---|
| `npm run test:live-memory` | 556/556 (was 554/554 pre-P2-4.1; +2 new tests: real-game campaign, module-relocation proof) |
| `npm test` (root) | Clean, exit 0 (run-node-tests.mjs aborts immediately on any group failure; reaching and cleanly completing the final group proves every prior group also passed) |
| `npx tsc --noEmit` | Clean |
| `npx tsc --project tsconfig.electron.json --noEmit` | Clean |
| `npm run build:vite` + `npm run build:electron` | Clean; 33/33 output-verifier checks |
| `npm run build` (adds electron-builder) | Clean; NSIS installer built and signed |
| `cargo fmt --check` (native/solith-scanner-core) | Clean |
| `cargo clippy --release` | Clean, zero warnings |
| `cargo test --release` | 50/50 (23 + 5 + 17 + 5 across scanner/region-mutation/session/stress-and-concurrency integration suites) |
| NAPI suite (`native/solith-scanner-napi/test/*.test.js`) | 51 pass, 1 intentional skip (`--expose-gc`-gated), 0 fail |
| `pointer-map-ui-real-process.e2e.test.ts` (P2-3) | Pass |
| `pointer-map-ui-cancellation.e2e.test.ts` (P2-3.1) | Pass |
| `pointer-map-ui-packaged.e2e.test.ts` | Pass |
| `pointer-map-ui-cancellation-packaged.e2e.test.ts` | Pass |
| `pointer-map-ui-stability.e2e.test.ts` (P2-4 + P2-4.1) | 2/2 pass (Validate After Restart; Load-as-first-interaction regression) |

## Fresh worktree (mission §15)

A second, separate worktree (`G:\ACTIVE_PROJECTS\solith-p241-fresh-verify`, detached HEAD at the final candidate SHA `1cb64efe45ece75fe1dad12a6f69d3416e67fd45`) was created independently of the dev worktree — canonical `npm install` (489 packages, 0 vulnerabilities), `npm run build:vite`, `npm run build:electron` (33/33 checks), `cargo build --release --bin solith-scanner-fixture`, no copied build outputs from the dev worktree. `npm run test:live-memory`: **556/556**, matching the dev worktree exactly.

## Remote CI — no-retry certification (mission §16)

[PR #35](https://github.com/Jabanaster/SOLITH/pull/35) (`feature/solith-phase2-pointer-stability-closeout` → `master`) — every required check passed on its **first execution**, zero retries:

| Check | Result | Duration |
|---|---|---|
| PR Windows (native + Electron gate) | pass | 8m17s |
| CI Fast | pass | 9m40s |
| PR Static (TypeScript and architecture checks) | pass | 18s |
| Semgrep | pass | 35s |
| OSV-Scanner | pass | 27s |
| Gitleaks | pass | 7s |
| Vendored memoryjs integrity | pass | 12s |

(An earlier PR, #34, was opened targeting `feature/solith-phase2-pointer-stability` and then had its base edited to `master` to trigger the required workflows — editing an existing PR's base does not fire the `pull_request` `synchronize`/`opened` events these workflows key on, so no CI ever ran against it. It was closed, unused for certification, and PR #35 was opened fresh, directly targeting `master`, as the actual certification vehicle.)

## Disposition

Fresh-worktree and remote-CI requirements: **COMPLETE**, with a genuine first-run-clean remote CI result — no reliance on a manual rerun anywhere in this stage's own certification.
