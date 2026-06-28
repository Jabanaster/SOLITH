# ResourceForge V1.0.0 RC1 Manual Smoke Test Checklist

RC1 commit: `e11d95e869bfaede6311d396eeab0c0a0d7b2da5`
RC1 tag: `v1.0.0-rc.1`

Artifact paths:
- Installer: `dist\ResourceForge Setup 1.0.0.exe`
- Unpacked executable: `dist\win-unpacked\ResourceForge.exe`
- Electron main bundle: `dist-electron\main.js`

---

## Automated Packaged Smoke — Gate 18

Run: `npm run test:packaged-smoke` (playwright.e2e.config.ts)
Result: **22/22 PASS** — 2026-06-27

The test launches `dist\win-unpacked\ResourceForge.exe` via Playwright with an isolated
`ELECTRON_USER_DATA_PATH` temp dir. The single-instance lock uses that temp dir, so the
test runs cleanly even when a production instance is already open.

Runtime report (last run):
- exe_path: dist\win-unpacked\ResourceForge.exe
- app_get_app_path: dist\win-unpacked\resources\app.asar
- ipc_channels verified: getGames, getSettings, addGame, addUserSelectedLocation, parseSave, getAllProfiles, getRecipes, checkGameRunning, getCompatibilityProfile
- exit_code: 0
- renderer_errors: 0
- main_errors: 0
- cleanup_success: true

Current diagnostic run in this turn:
- packaged exe PID: 26652
- alive_after_2_seconds: true
- alive_after_10_seconds: true
- orphan_check: pass

Points verified:
- [x] 01 packaged exe exists at dist/win-unpacked/ResourceForge.exe
- [x] 02 app launches and first window appears
- [x] 03 window title contains ResourceForge
- [x] 04 window reaches domcontentloaded state
- [x] 05 React root mounts (#root > * present)
- [x] 06 contextIsolation active: require not in renderer
- [x] 07 window.electronAPI exposed by contextBridge
- [x] 08 window.electronAPI.getGames is a function
- [x] 09 window.electronAPI.applyProposal is a function (full preload API)
- [x] 10 IPC getGames() returns an array (database initialized)
- [x] 11 IPC getSettings() returns object with known keys (theme, backupMode)
- [x] 12 IPC addGame() creates a game record successfully
- [x] 13 IPC parseSave() parses JSON fixture (player.gold = 150)
- [x] 14 zero uncaught renderer errors during startup and interaction
- [x] 15 app exits cleanly (close() resolves without timeout)
- [x] 16 Trainer/Workshop mode toggle renders in packaged app
- [x] 17 Trainer mode can be toggled in packaged app
- [x] 18 new Trainer IPC methods exposed in packaged preload
- [x] 19 compatibility IPC succeeds (empty DB → BLOCKED_PENDING_USER_DATA)
- [x] 20 getRecipes IPC succeeds in packaged app
- [x] 21 checkGameRunning actually invoked — returns { running: boolean, evidence: string }
- [x] 22 getCompatibilityProfile actually invoked — returns null for fresh DB

---

## Root Cause: Prior "Quick Exit" Was Not a Crash

An earlier manual launch of the exe failed with:
  `[ResourceForge] Another instance is already running. Focusing it and exiting.`

This is intentional single-instance behavior (`app.requestSingleInstanceLock()` in main.ts:57).
The production instance was already running in `%APPDATA%\ResourceForge`. The manual launch
detected the lock in that same directory and exited with code 0 — correct behavior, not a bug.

The automated test bypasses this by setting `ELECTRON_USER_DATA_PATH` to a per-run temp dir.
The lock is created in the temp dir, separate from the production lock. No conflict.

Packaged smoke: **CONFIRMED PASS** via deterministic Playwright automation.

---

## Manual Checklist (human steps — still required for RC1 acceptance)

Packaged host validation: PASS (automated)
Orphan check: PASS (automated)

Notes:
- Do not use real game saves for this smoke test.
- No final `v1.0.0` release has been created yet.
- The items below require a human to manually observe the running UI.

[ ] Launch `dist\win-unpacked\ResourceForge.exe` (close any existing instance first)
[ ] Confirm app window opens and stays open
[ ] Confirm title/sidebar renders visually
[ ] Confirm trainer page loads
[ ] Confirm accepted Stardew controls are visible
    [ ] Money
    [ ] Stamina
    [ ] Farming XP
    [ ] Max Stamina
[ ] Confirm each accepted control requires approval before write
[ ] Confirm no live-memory editing option is exposed
[ ] Confirm no online/multiplayer/anti-cheat feature is exposed
[ ] Confirm no real save is modified during smoke test
[ ] Close app normally
[ ] Run orphan check again after close
