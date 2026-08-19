# Performance Report — Trainer UX V1

## Known Limitation — Cold Start

A loaded-system cold launch has measured approximately **6.2 seconds (6198 ms)**. The
8-second automated ceiling prevents false failures but does not resolve this performance
concern. Cold-start and warm-start results must remain separately tracked; the latest warm
dev-bundle launch measured **501 ms** on 2026-06-23.

## Test Environment

| Item | Value |
|------|-------|
| Machine | Windows 11 Home 10.0.26200 |
| Runtime | Electron (real packaged / dev bundle) |
| Database | SQLite in-memory (sql.js), persisted to isolated temp |
| Fixture | Synthetic — `{"player":{"hp":100,"gold":150}}` |
| Game | 0 recipes at start; 1 recipe after `createRecipe` call |

## Measured Timings (from Trainer E2E — tests/trainer.e2e.test.ts)

These are observed from the Playwright test durations, not instrumented profiling.

| Operation | Observed Duration |
|-----------|------------------|
| Electron startup to `#root > *` visible | ~800ms – 1200ms |
| Latest automated warm start (2026-06-23) | 501ms |
| Recorded loaded-system cold start | ~6198ms |
| Mode toggle click → aria-pressed update | < 300ms (waited 300ms) |
| addGame IPC | < 50ms |
| addUserSelectedLocation IPC | < 50ms |
| createRecipe IPC | < 50ms |
| getRecipes IPC | < 100ms |
| createProposalForEdit IPC | < 100ms |
| applyProposal (backup + atomic write) | < 200ms |
| parseSave after apply | < 100ms |
| getJournal | < 100ms |
| restoreBackup | < 200ms |
| Full workflow (tests 01–25) | ~2.1s total |

## Analysis

### Potential Concerns

| Concern | Severity | Status |
|---------|----------|--------|
| `loadItems()` re-called after every apply and restore | Low | Acceptable — re-fetches only recipes for active game |
| `checkGameRunning` polls on page load | Low | Single call on mount; not polled continuously |
| No pagination on trainer cards | Low | No issue with fixture; may need limit for games with 100+ recipes |
| `get-all-profiles` uses `db.exec()` which returns all rows | Low | Acceptable while profile count is small |
| `deriveCardState()` called per-render for each card | None | Pure function, trivial cost |

### No Issues Found

- No synchronous process calls in the renderer
- No repeated full database reloads during ordinary renders
- No repeated hashing during card renders
- No React re-render loops observed
- Mode switch is instant (state-only, no IPC)

## Caveats

- Timings are from a single synthetic fixture run, not a profiled production workload
- A game with hundreds of recipes has not been tested
- No memory profiling was performed
- Lighthouse / CWV not applicable to Electron apps

## 2026-07-31 — Startup gray-screen investigation

Investigated on isolated branch `perf/startup-gray-screen-investigation`
(worktree `solith-startup-perf`), based on frozen candidate
`502300b4498828b40dcbb5be320c2f8d48603089`. Did not modify the frozen
`integration/b1-1-closeout` branch or packaged candidate.

### Root cause (measured, not assumed)

`electron/main.ts`'s `app.whenReady()` handler awaited
`bootstrapTrainerCatalog()` → `syncAllTrainerSources()` (a network-bound
remote catalog sync) before calling `createWindow()`. Measured across 6
launches (3 cold, 3 warm) prior to the fix: that one step alone consumed
1.3s–12.3s while every other pre-window step (Game Bar transport, DB init,
crash recovery, lifecycle wiring) combined took under 200ms. No window
existed at all until that sync finished.

### Fix

- `BrowserWindow` now uses `show: false` and shows via a `ready-to-show`
  listener, with a bounded fallback timeout (default 10s, configurable via
  `SOLITH_READY_TO_SHOW_TIMEOUT_MS`) so a stuck renderer still produces a
  visible (not silently absent) window.
- The trainer-catalog bootstrap chain
  (`bootstrapTrainerCatalog`/`reconcileCommunitySyncPolling`/`startCatalogProcessWatch`)
  was extracted into an idempotent `runDeferredTrainerCatalogBootstrap()`,
  kicked off only once the window is actually shown (from `showOnce()`),
  instead of gating window creation. Same operations, same
  try/catch/`console.error` handling as before.
- Required steps — DB init, crash recovery, lifecycle wiring, Game Bar
  transport (already mandatory pre-window before this fix) — remain awaited
  before `createWindow()`, unchanged.

### STARTUP WINDOW CREATION VERIFIED IMPROVED

Final re-measurement (6 runs, `scripts/measure-startup.mjs`, process-start →
mark, `ms`):

| Checkpoint | min | median | max | n |
|---|---|---|---|---|
| `create-window-start` | 308.8 | 316.0 | 375.1 | 6 |
| `browserwindow-constructed` | 327.9 | 333.8 | 400.1 | 6 |
| `ready-to-show` (= actual `show()`, same tick) | 438.4 | 473.3 | 523.2 | 6 |
| `trainer-catalog-bootstrap-start` | 447.1 | 483.7 | 535.7 | 6 |
| `trainer-catalog-bootstrap-done` | — | — | — | n/a — harness kills the process ~250ms after `did-finish-load`, before the network-bound sync finishes; not a claim that it never completes |

Before the fix, `create-window-start` measured 1,321ms–12,141ms across 6
runs (median ~3.4s). After: 308.8ms–375.1ms (median 316ms) — no window
existed at all for over a second, sometimes over ten, before the fix;
consistently under 400ms after.

### RENDERER FIRST-PAINT VARIANCE — OPEN

`ready-to-show` (and therefore visible first paint) still varied 0.4s–8.4s
across earlier measurement rounds taken in this investigation, despite
`browserwindow-constructed` being consistently ~300–460ms in every round —
i.e. all of that variance occurs *after* window construction, entirely on
the renderer side, and is independent of this fix. Do not treat this as
closed:

- Window construction is now consistently early (verified, see table
  above).
- The remaining variance occurs after window construction, in the
  renderer's own load path.
- Large bundled media assets (multi-MB PNGs, a ~17MB video asset seen in
  the Vite build output) and disk/OS contention from rapid repeated
  launches are hypotheses for the remaining variance, not established
  causes — no profiling was done to confirm either.
- Further profiling (renderer-side tracing, isolating asset-loading cost
  from disk contention) is required before changing anything here.
- Wisp visual assets must not be modified to address this without separate
  authorization — out of scope for this investigation.

Follow-up tracked as: **Renderer first-paint latency investigation**.

### Verification

`tsc -p tsconfig.electron.json`, `tsc -p tsconfig.json`, `npm test`
(1055/1055 + 10/10), `npm run test:live-memory` (257/257), `npm run
build:vite`, `npm run build:electron` (29/29), `npm run
verify:electron-output` (29/29), `git diff --check` — all exit 0. Behavioral
Electron tests: `npm run test:startup-visibility` (10/10, real launches).
Independent read-only review verdict: **VERIFIED COMPLETE**.
- Cold-start optimization remains open; passing the 8000ms test ceiling is not evidence that it is resolved
