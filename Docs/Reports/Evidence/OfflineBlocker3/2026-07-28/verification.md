# Solith Offline Blocker 3 Verification

Date: 2026-07-28

## Classification

```text
SOLITH OFFLINE BLOCKER 3
Status: OPEN
Page audit complete: YES
Pages requiring help: 16
Pages with complete help: 16
Pages partial: 0
Pages missing: 0
Pages N/A: 0
Activity Journal help: PASS
Route-change auto-close: PASS (automated)
Stale walkthrough content after navigation: NO (automated)
Rendered UI tests: PASS
Manual Electron verification: PASS
Implementation commit: PENDING
Observed issues:
- Blocker 3 implementation commit remains pending
```

The manual Electron checklist passed. Blocker 3 remains OPEN only until the
implementation is committed.

## Root cause and implementation

The walkthrough component previously retained open page identifiers in a
module-level set. Unmounting a page did not clear that set, so returning to a
previous route could reopen stale help.

The implementation now gives the active application context one walkthrough
owner. It permits at most one open walkthrough and is remounted when the route,
selected game, deck catalog game, or library launch game changes. Ordinary
same-page state changes do not remount the owner. Closing by button or Escape
returns focus to the help trigger.

Activity Journal now has a page walkthrough describing the actual local audit
records, local SQLite storage, 100-entry display limit, game-context behavior,
privacy boundary, read-only behavior, and current lack of clear/delete/export
controls.

## Page audit matrix

| Navigation page | Walkthrough ID | Result |
| --- | --- | --- |
| Game Library | `game-library` | PASS |
| Trainer Library | `trainer-library` | PASS |
| Backups | `backups` | PASS |
| Save Locations | `save-locations` | PASS |
| Activity Journal | `activity-journal` | PASS |
| Save Editor | `save-editor` | PASS |
| Trainer Controls | `trainer-controls` | PASS |
| Discovery Lab | `discovery-lab` | PASS |
| Trainer Research Lab | `trainer-research-lab` | PASS |
| CT Library | `ct-library` | PASS |
| Registry Explorer | `registry-explorer` | PASS |
| Data Editor | `data-editor` | PASS |
| Compatibility | `compatibility` | PASS |
| Recipes | `recipes` | PASS |
| Session Monitor | `session-monitor` | PASS |
| Live Memory Trainer | `live-memory-trainer` | PASS |

The audit matrix is executable application data. Its test compares it with the
current application navigation, page bindings, and walkthrough registry so
future navigation drift fails verification.

## Automated verification

All commands used the project-local Node 22.23.1 runtime.

| Gate | Result |
| --- | --- |
| `npm run test:trainer-catalog` | PASS — 44/44 |
| `tsx --test tests/page-walkthrough.test.tsx` | PASS — 9/9 |
| `npm run test:walkthrough-e2e` | PASS — 2/2 real Electron navigation tests |
| `npm run test:electron-smoke` | PASS — 6/6 |
| `npm run build:vite` | PASS |
| `npm run build:electron` | PASS — Electron output verification 29/29 |
| `npm run verify:electron-output` | PASS — 29/29 |
| `tsc --noEmit` | PASS |

The rendered Electron tests prove:

- a walkthrough stays open during unrelated same-page sidebar state changes;
- navigation closes the previous walkthrough immediately;
- returning to the earlier page does not reopen stale content;
- opening help on the new page shows only that page's content;
- Escape and the close button close help and return focus to the trigger;
- Activity Journal renders its registered walkthrough content.

## Manual Electron result

PASS. All 16 navigation pages were exercised in the Electron application. The
Registry Explorer overlap initially failed because Wisp controls rendered above the
walkthrough. After raising the walkthrough stacking level above the Wisp, the
focused retest passed and the panel was fully readable and unobstructed.

Evidence: egistry-explorer-wisp-layering-pass.png`r

## Manual Electron verification

Start Solith with Node 22:

```powershell
cd "G:\ACTIVE_PROJECTS\SOLITH"
$env:Path = "G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64;$env:Path"
npm run dev
```

For each of the 16 pages in the matrix:

1. Navigate to the page.
2. Open **How this works**.
3. Confirm the title and instructions describe the current page.
4. Confirm the panel is readable and not clipped.
5. Navigate to the next page while the panel is still open.
6. Confirm the old panel disappears immediately.
7. Return to the previous page and confirm its panel stays closed.
8. Reopen and close the panel normally.

On Game Library, also verify:

1. Open **How this works**.
2. Collapse and expand the sidebar; confirm help remains open.
3. Press Escape; confirm help closes and focus returns to **How this works**.
4. Reopen help and use its close button; confirm focus again returns to the
   trigger.

Record any inaccurate copy, clipping, stale content, or failure to close as a
Blocker 3 failure. Do not commit or classify the blocker CLOSED until every
manual check passes.
