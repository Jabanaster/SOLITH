# Pilot Sandbox — Architecture

## Purpose

The Pilot Sandbox is the isolated environment used to test Trainer UX against real-world save files without committing commercial data to the repository.

## Isolation Model

Every Electron test run uses:

| Variable | Value |
|----------|-------|
| `ELECTRON_USER_DATA_PATH` | Temp directory per run ID |
| `APPDATA` | Temp directory per run ID |
| `USERPROFILE` | Temp directory per run ID |
| Database | `{ELECTRON_USER_DATA_PATH}/solith.db` — fresh per run |
| Game files | Copied to temp directory — never under `process.cwd()` |
| Source fixture | Written to separate `source/` dir — immutable reference copy |
| Workspace fixture | Written to `game/` dir — the file actually written and restored |

This model guarantees:
- No run touches production user data
- No commercial save paths committed to git
- Each run starts from a clean database state
- Path-safety validator cannot block temp-dir paths

## Sandbox Entry Point

The E2E test helpers (`runWorkflow` in `electron.e2e.test.ts`, and the Trainer E2E in `trainer.e2e.test.ts`) implement the sandbox lifecycle:

```
mkdirSync(baseTemp)
  ├── source/player_save.json   — immutable reference (hash: source_before = source_after)
  ├── game/player_save.json     — workspace (apply → verify → restore → verify)
  ├── userData/                 — isolated SQLite database
  └── appdata/                  — isolated APPDATA
```

After every run: `rmSync(baseTemp, { recursive: true, force: true })`

## Compatibility Pilot Entry Point

When the user provides real-world save files, the sandbox workflow is:

1. User provides save file path(s) for a specific game
2. Hash the source save file before any operation
3. Copy to sandbox `game/` directory — never operate on the original
4. Add game and approve location via IPC
5. Run Discovery Lab to find editable fields
6. Create recipes for testable fields
7. Run apply → verify hash → restore → verify hash
8. Record all hashes and mark the profile VERIFIED (Tier 1 evidence)
9. Commit only: the profile schema, issue report, and hash evidence
10. Never commit: the save file itself, any path that identifies the user's machine

## What Cannot Be in Git

- Commercial save files (any format)
- Absolute paths to the user's game install or save directory
- Screenshots showing save file contents with personal data
- Profile names, character names, or progression data
