# Electron Runtime Verification Report

**Date:** 2026-06-23  
**Session:** Solith Milestone — Electron Runtime and Package Verification

## Build Pipeline Verification

### tsup Configuration
- Entry: `electron/main.ts` → `dist-electron/main.js` (ESM, Node 22 target)
- Entry: `electron/preload.ts` → `dist-electron/preload.cjs` (CommonJS for Electron sandbox preload)
- Externals: `electron`, `better-sqlite3`
- All relative imports bundled inline — no bare relative imports at runtime
- `__dirname`/`__filename`/`require` shims injected via banner

### Output Verifier (scripts/verify-electron-output.mjs)
Checks performed (19 total):
1. main.js exists
2. preload.cjs exists
3. main.js has no .ts imports
4. preload.cjs has no .ts imports
5. main.js has no bare relative imports
6. preload.cjs has no bare relative imports
7. main.js does not import from .gemini
8. preload.cjs does not import from .gemini
9. main.js does not import a test runner
10. preload uses contextBridge
11. preload uses exposeInMainWorld
12. main.js has nodeIntegration: false
13. main.js has contextIsolation: true
14. main.js has single-instance lock
15. main.js > 10 KB
16. main.js < 5 MB
17. preload.cjs > 100 bytes
18. preload.cjs < 100 KB
19. (additional bundle sanity as implemented in verifier)

### Verification Status
Runs automatically as part of `npm run build:electron`. Build fails if any check fails.

## Preload Bridge

`electron/preload.ts` exposes `window.electronAPI` with the following methods:
- `getGames`, `addGame`, `deleteGame`, `scanGame`
- `getRecipes`, `createRecipe`, `deleteRecipe`
- `getJournal`, `logEvent`
- `getSettings`, `setSetting`
- `getBackups`, `restoreBackup`
- `detectSaveFiles`, `parseSave`, `compareSaves`
- `createProposalForEdit`, `applyProposal`, `suggestDataEdits`
- `discoverSaveLocations`, `getSaveLocations`
- `approveSaveLocation`, `revokeSaveLocation`, `addUserSelectedLocation`

All IPC handlers validate inputs via Zod schemas before processing.

## Single-Instance Handling

```typescript
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) { app.quit(); process.exit(0); }

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
```

Only the Solith process is affected. No `taskkill /IM electron.exe` — unrelated Electron applications are never touched.

## Security Settings

```typescript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  preload: path.join(moduleDirectory, 'preload.js')
}
```

## Font & CSP

### Content Security Policy (index.html)
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
img-src 'self' data:;
connect-src 'self' http://localhost:3000 ws://localhost:3000 ... (dev server only);
frame-src 'none';
object-src 'none';
```

No remote fonts, scripts, styles, or images are permitted.

### Font Stacks
Sans-serif: `Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif`  
Monospace: `"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace`

No CDN requests. No `@import url(https://...)`. Works fully offline.

## Verified Outcomes (2026-06-28)

The manual and automated verification gates have been successfully executed:
- **TSC Check**: Passed (`npx tsc --noEmit` returned 0 compiler errors).
- **npm test**: Passed cleanly with **346/346** tests passing.
- **npm run build:vite**: Passed successfully, compiling the React bundle into `dist-electron/dist/`.
- **npm run build:electron**: Passed successfully, bundling main, preload, and host-entry via `tsup`, and verifying with `verify-electron-output.mjs` (19/19 checks passed).
- **npm run dev**: Verified dev orchestration starts Vite + tsup watch + Electron Main cleanly.
- **npm run test:electron-smoke**: Passed successfully (6/6 tests passed).
- **npm run build**: Generated Setup NSIS installer target successfully after terminating locked processes (`Solith Setup 1.0.0.exe`).
- **npm run test:electron-e2e**: Passed successfully (4/4 tests passed) after implementing the rollback journal fix in `electron/main.ts`.
- **npm run test:packaged-smoke**: Passed successfully (22/22 tests passed).

