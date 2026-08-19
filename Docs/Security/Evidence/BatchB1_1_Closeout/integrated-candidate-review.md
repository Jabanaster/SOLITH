# Integrated B1.1 Candidate Review

Date: 2026-08-01
Worktree: `G:\ACTIVE_PROJECTS\solith-b11-integration`
Branch: `integration/b1-1-closeout`
HEAD (verified): `fa482c8c1917bbe3990d878a67f3f00cdc33364d`
Verified baseline (branch point from local `master`): `406253d73042c5acb07fd5da134d6c68a98d4b2d`
Commit range reviewed: `406253d73042c5acb07fd5da134d6c68a98d4b2d..fa482c8c1917bbe3990d878a67f3f00cdc33364d`

## Repository/authority state (Phase 0)

- `git branch --show-current`: `integration/b1-1-closeout`
- `git rev-parse HEAD`: `fa482c8c1917bbe3990d878a67f3f00cdc33364d`
- `git status --short --untracked-files=all`: empty
- `git diff --cached --name-status`: empty
- `git diff --check`: exit 0
- No active merge/rebase/cherry-pick/revert/bisect/sequencer state.
- No unexplained untracked files.
- `git status -sb`: `## integration/b1-1-closeout` — no upstream tracking branch configured; nothing pushed this session or prior.
- `git remote -v`: `origin https://github.com/Jabanaster/SOLITH.git` (fetch/push) — fetched for read-only comparison only, no push performed.

## Integrated-change ledger (Phase 1)

Four commits integrated via fast-forward on 2026-08-01 (prior session), on top of the already-integrated Gate 2.x/NEW-1/NEW-2/Game Bar/Electron-TS-baseline work already present at `502300b4498828b40dcbb5be320c2f8d48603089`:

| SHA | Subject | Classification | Files | Workstream | Reversible independently |
|---|---|---|---|---|---|
| `9aad1cf` | perf: remove trainer catalog sync from critical startup path | production | `electron/main.ts`, `electron/startup-timing.ts` (new) | startup-performance | No — depends on being first in the 4-commit chain |
| `c5202f3` | chore: add startup measurement harness | tooling/diagnostic | `scripts/measure-startup.mjs` (new), `package.json` (+1 script line) | startup-performance | Yes — not wired into `npm test` |
| `110c9d0` | test: cover deferred startup and visibility gating | test | `tests/startup-performance-static.test.ts` (new), `tests/startup-visibility-behavior.e2e.test.ts` (new), `package.json` (+2 script lines) | startup-performance | Yes, but validates `9aad1cf` — do not revert independently |
| `fa482c8` | docs: record startup performance investigation | docs | `Docs/Reports/PERFORMANCE_REPORT.md` | startup-performance | Yes |

No commit contains unrelated work. No later commit in this range corrects an earlier one (the corrective pass from the prior investigation was folded into these four commits before integration, not layered on top). All four were independently reviewed twice (implementation review + integration-readiness review) before the fast-forward, both returning `VERIFIED COMPLETE`.

Earlier history in the branch (`502300b` and before) covers NEW-1/NEW-2 trust-boundary hardening, Game Bar transport integration, and the Electron TypeScript baseline cleanup (OD-2.5-001) — all previously verified and evidenced under `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/` and `NEW1_NEW2_TrustBoundary/`. This review does not re-litigate those; it re-verifies them still hold on the current integrated HEAD (see below).

## Phase 2 — Full integrated verification battery (this session, exact commands and results)

Toolchain: Node `v22.23.1` / npm `10.9.8`, pinned via `G:\ACTIVE_PROJECTS\_tooling\node-v22.23.1-win-x64` (matches `package.json` `engines: ">=22 <23"` and `.nvmrc: 22`). `where node` also resolves a system Node 24 install; the pinned path was prepended for every command below.

`node_modules` already present from a prior validated `npm ci` in this worktree; `git status --short package-lock.json` clean, so `npm ci` was not re-run (would not have disturbed validated state, but was unnecessary).

| Command | Result |
|---|---|
| `npm audit` | `found 0 vulnerabilities` |
| `npx tsc -p tsconfig.electron.json --noEmit --pretty false` | exit 0, 0 diagnostics |
| `npx tsc -p tsconfig.json --noEmit --pretty false` | exit 0, 0 diagnostics |
| `npm test` (literal) | `# tests 1055 / # pass 1055 / # fail 0` + `# tests 10 / # pass 10 / # fail 0` (two chained `tsx --test` invocations), exit 0 |
| `npm run test:startup-visibility` | 10/10 passed (Playwright, real Electron) |
| `npm run test:live-memory` | `# tests 257 / # pass 257 / # fail 0`, exit 0 |
| `npm run build:vite` | exit 0, built in 320ms |
| `npm run build:electron` | 29/29 output checks passed, exit 0 |
| `npm run verify:electron-output` (standalone rerun) | 29/29 passed, exit 0 |
| `git diff --check` | exit 0 |
| `git status --short` | empty after all of the above |

No test or build command left tracked-file modifications.

Focused security suites (trusted-sender registry, NEW-1/NEW-2 sender validation, live-memory write policy/consent/rollback, TrainerHost approve/write/rollback, hook confirmation/rollback, navigation/popup policy) are wired into the literal `npm test` file list (`tests/trusted-sender-registry.test.ts`, `tests/new1-new2-sender-validation.test.ts`, `tests/live-memory/write-policy*.test.ts`, `tests/live-memory/write-consent.test.ts`, `tests/live-memory/rollback-*-integrity.test.ts`, `tests/trainer-host/*.test.ts`, `tests/live-memory/gate2-1-test-build-hooks.test.ts`) — all included in the 1055/1055 total above, not run separately.

## Phase 3 — Regression and cross-workstream review

### 3.1 Startup ordering (verified by direct source read, `electron/main.ts`)

Confirmed present and in order inside `app.whenReady().then(...)`:
1. `registerSolithAssetProtocol()`
2. Game Bar transport start/done/failed (awaited, try/catch, non-fatal on failure) — unchanged since `502300b`
3. DB init (`dbModule.initDatabase()`, awaited)
4. `unlockTrainerCapabilities()` / `registerTrainerHotkeys()`
5. Crash recovery (`operationsModule.recoverInterruptedOperations()`, awaited)
6. V2 lifecycle wiring (`createLifecycleWiring`)
7. `createWindow()`

Trainer catalog sync (`bootstrapTrainerCatalog` / `reconcileCommunitySyncPolling` / `startCatalogProcessWatch`) is **not** in this awaited chain — it is deferred into `runDeferredTrainerCatalogBootstrap()`, guarded by a module-level `trainerCatalogBootstrapStarted` boolean (idempotent, single call site inside `showOnce()`), kicked off only once the window is actually shown via `ready-to-show` or the bounded fallback `setTimeout` (`SOLITH_READY_TO_SHOW_TIMEOUT_MS`, default 10s). `BrowserWindow` uses `show: false`; the fallback timer is cleared on `closed`. Destroyed-window path guarded (`readyToShowWindow.isDestroyed()` check inside `showOnce`). All confirmed by source read and independently confirmed behaviorally by `tests/startup-visibility-behavior.e2e.test.ts` (10/10 pass, real Electron, see table above).

### 3.2 Security composition

No changes to trusted-sender registration, frame identity, URL authorization, preload boundaries, navigation guards, or popup guards were introduced by the startup-performance commits (`git diff --stat` for the 4-commit range touches only `electron/main.ts`, `electron/startup-timing.ts`, `scripts/measure-startup.mjs`, `package.json`, 3 test/docs files — no security-boundary source file). `registerTrustedSolithWindow` and `applyWindowNavigationPolicy` calls for the main window remain unchanged and unconditionally run inside `createWindow()`, before `did-finish-load`. Dev-server trust (`http://localhost:3000`) remains strictly gated behind `isDev` (`--dev` arg or `SOLITH_DEV=1`); packaged builds trust only the packaged `file://` route.

### 3.3 Wisp isolation

`git diff 502300b4498828b40dcbb5be320c2f8d48603089..fa482c8c1917bbe3990d878a67f3f00cdc33364d -- src/core/companion/wisp.ts tests/companion-wisp.test.ts electron/wisp-overlay.ts`: **zero lines changed** on all three paths. No Wisp product work occurred in this range.

### 3.4 Game Bar isolation

`git diff 502300b..fa482c8 --stat` touches no Game Bar file (`gamebar-transport.ts` etc. absent from the changed-file list). Game Bar transport start/done/failed ordering in `main.ts` is unchanged (still first in the awaited chain, still non-fatal on failure).

### 3.5 CT Import isolation

No CT Import source file appears in the 4-commit diff; CT Import tests are part of the 1055/1055 `npm test` total (unchanged pass status).

### 3.6 Renderer variance re-measurement (this session, `scripts/measure-startup.mjs`)

3 cold + 3 warm real launches, cleanup validated (0 of 6 spawned processes remained alive; no orphan `electron.exe` referencing this bundle):

| Checkpoint | min (ms) | median (ms) | max (ms) | n |
|---|---|---|---|---|
| `create-window-start` | 285.2 | 304.2 | 320.0 | 6 |
| `browserwindow-constructed` | 303.9 | 322.3 | 338.1 | 6 |
| `ready-to-show` | 450.6 | 467.2 | 737.3 | 6 |
| `trainer-catalog-bootstrap-start` | 470.2 | 487.4 | 752.9 | 6 |

Window construction remains consistently fast and tight (285.2–338.1ms across all 6 runs, both cold and warm). `ready-to-show` (first paint) this round shows a narrower spread (450.6–737.3ms) than the original investigation's worst-case (0.4s–8.4s), consistent with a less-loaded machine at measurement time — this does **not** prove the variance is resolved; it is a smaller sample under different load conditions. Status is maintained unchanged:

```
STARTUP WINDOW CREATION — VERIFIED IMPROVED
RENDERER FIRST-PAINT VARIANCE — OPEN
```

No renderer asset was modified in this phase.

## Phase 4 — Evidence reconciliation summary

- Gate 2.5 status (from `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/owner-decision-package.md`): OD-2.5-001 (Electron TS baseline) technically resolved, independently reviewed twice, **owner acceptance still required**. OD-2.5-002 (whitespace baseline) named/documented, not cleaned up (still prohibited without separate authorization). OD-2.5-003 (B1.1 promotion) **NOT AUTHORIZED**. OD-2.5-004 (master verification) **NOT STARTED** as of that document's authorship — still accurate: `master` has never had this integrated work run against it (see Phase 5 below). OD-2.5-005 (documentation reconciliation) — scoped edits applied, explicitly **not marked complete**, informational/non-blocking per its own record; this review does not change that status, since no new durable independent documentation-review evidence was produced this session for that specific item.
- Startup-performance status reconciled as `STARTUP WINDOW CREATION — VERIFIED IMPROVED` / `RENDERER FIRST-PAINT VARIANCE — OPEN`, consistent with the prior investigation and this session's re-measurement.
- These concepts remain distinct and are not conflated anywhere in this document: source/test verification (done, this doc), integration verification (done, this doc), `master` verification (not done — see master-readiness doc), packaged verification (not done — no candidate exists), clean-machine acceptance (not done — see clean-machine plan), B1.1 promotion (not done — see promotion decision package), release authorization (not done — see release-readiness decision package), B2/B2A (not started, out of scope).
