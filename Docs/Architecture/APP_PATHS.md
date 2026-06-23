# App Path Resolution

## Overview

All paths in ResourceForge are resolved through `src/shared/app-paths.ts`. This module is shared between Electron main process code and the test environment.

## Path Categories

### Development / Test paths
When Electron is not available (i.e., running under `tsx` or `node --test`), the module falls back to filesystem-relative paths anchored at the project root:

| Path | Location |
|------|----------|
| `appRoot` | Project root (`G:/GAME TRAINER`) |
| `userDataRoot` | `<project>/data/` |
| `databasePath` | `<project>/data/resourceforge.db` |
| `demoFixtureRoot` | `<project>/demo-game/` |

### Packaged / Production paths (Electron)
When running inside Electron, `app.getPath('userData')` is used for mutable data. This resolves to `%APPDATA%\ResourceForge` on Windows, which is:
- Outside the ASAR archive
- Outside the installation directory
- Not beside the executable
- Not inside the source repository

| Path | Location |
|------|----------|
| `appRoot` | `app.getAppPath()` (inside ASAR) |
| `userDataRoot` | `app.getPath('userData')` |
| `databasePath` | `<userData>/resourceforge.db` |
| `demoFixtureRoot` | `<resources>/demo-game/` via `process.resourcesPath` |

## Mutable Data

ALL mutable data is written to `userDataRoot`:
- `resourceforge.db` — SQLite database (via sql.js)
- Backups — written by `src/core/backups/`
- Logs — future use

**Never** write mutable data into:
- `dist/` or `dist-electron/` (build outputs, regenerated on each build)
- `demo-game/` (read-only fixture)
- The ASAR archive
- The installation directory

## Test Isolation

Tests that exercise the database must call `resetForTesting(tempDbPath)` in a `before()` hook. This:
1. Closes any open database connection
2. Resets the singleton state
3. Creates a fresh in-memory database at the specified temp path
4. Applies the full schema

This prevents test suites from sharing state between runs.
