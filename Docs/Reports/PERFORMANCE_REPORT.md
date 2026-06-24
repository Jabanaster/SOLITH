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
- Cold-start optimization remains open; passing the 8000ms test ceiling is not evidence that it is resolved
