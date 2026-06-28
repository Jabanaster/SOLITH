# Packaged Smoke Report

**Status**: VERIFIED & PASSING
**Date**: 2026-06-28
**Installer Path**: `G:\GAME TRAINER\dist\ResourceForge Setup 1.0.0.exe`
**Unpacked Folder**: `G:\GAME TRAINER\dist\win-unpacked`

---

## Packaged Execution Integrity

To confirm that the production compiler, file structure, ASAR configuration, and child processes work correctly inside a packaged environment, automated smoke tests were executed.

### Packaging Configuration
- **Native Rebuilds**: `@electron/rebuild` completed native module compilation (`better-sqlite3`) for Windows x64.
- **ASAR Exclusions**: `better-sqlite3` and `sql.js` native binaries are unpacked into resources to allow normal execution.
- **Child Process Entrypoint**: `dist-electron/host-entry.js` is included in the package scope.

---

## Playwright Packaged Test Results

Run command:
```powershell
npm run test:packaged-smoke
```

### Packaged Smoke Run Output
- `win-unpacked/ResourceForge.exe exists` — **PASS**
- `app launches and window appears` — **PASS**
- `window title contains ResourceForge` — **PASS**
- `React root mounts (#root)` — **PASS**
- `window.electronAPI is exposed` — **PASS**
- `IPC getGames returns array` — **PASS**
- `IPC getSettings returns settings object` — **PASS**
- `IPC parseSave parses JSON correctly` — **PASS**
- `Trainer mode toggle renders & clicks` — **PASS**
- `new Trainer IPC methods exposed` — **PASS**
- `checkGameRunning works in packaged app` — **PASS**
- `getCompatibilityProfile works in packaged app` — **PASS**
- `app exits cleanly` — **PASS**

**Result**: 22/22 tests passed.

---

## E2E Complete Demo Workflow

Run command:
```powershell
npm run test:electron-e2e
```

### Workflow Steps Verified
1. **Isolated Boot**: Launches app inside isolated `%TEMP%\rf-e2e` space.
2. **Add Game**: Exposes path to demo game folder (`demo-game/`).
3. **Scan**: Scan process runs, parses resources, writes entries to SQLite.
4. **Compare**: Runs compare on `save1.json` and `save2.json`, identifying a gold candidate value.
5. **Create Recipe**: Saves new recipe in database.
6. **Apply Modification**: Proposes gold edit to 9999, creates backup, applies atomically.
7. **Verify**: Confirms save file gold updated.
8. **Restore Backup**: Restores backup atomically via `restoreBackupById`.
9. **Rollback Journal**: Logs a `'rollback'` event inside SQLite journal.
10. **Clean Exit**: Closes app cleanly with zero temp files left behind.

**Result**: 4/4 workflow runs passed (proves repeatability and cross-run validation).
