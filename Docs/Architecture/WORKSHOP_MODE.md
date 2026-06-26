# Workshop Mode — Architecture

## Overview

Workshop Mode is the advanced interface surfacing discovery, diagnostics, and raw editing tools. It shares the same Electron shell and IPC layer as Trainer Mode but exposes the full recipe/save/discovery pipeline.

## Mode Toggle

Defined in `src/app/App.tsx`:

```ts
type AppMode = 'trainer' | 'workshop';
```

- Persisted to `localStorage` under key `'app-mode'`
- Loaded on startup; defaults to `'trainer'`
- `switchMode()` updates both React state and localStorage
- Header shows "Workshop Mode" / "Trainer Mode" toggle button
- Sidebar layout changes entirely between modes

## Workshop Pages

| Route key | Component | Purpose |
|-----------|-----------|---------|
| `save-editor` | `SaveEditor` | Browse and edit parsed save tree |
| `discovery` | `DiscoveryLab` | Run diff-based discovery between two saves |
| `recipes` | `Recipes` | View/manage recipe database |
| `backups` | `Backups` | Browse backup history and restore |
| `journal` | `Journal` | Audit trail of all operations |
| `locations` | `SaveLocations` | Manage approved save file locations |
| `compatibility` | `CompatibilityDashboard` | Profile stats and issue taxonomy |

## Compatibility Dashboard (`src/app/pages/CompatibilityDashboard.tsx`)

Loads all profiles via `electronAPI.getAllProfiles()` and displays:
- **Stat cards** — counts per status level (VERIFIED, SUPPORTED, READ_ONLY, EXPERIMENTAL, UNSUPPORTED, BLOCKED)
- **Evidence tier panel** — explains the four-tier evidence hierarchy with BLOCKED_PENDING_USER_DATA note
- **Profile table** — all profiles with status badges
- **Issue taxonomy grid** — 20 issue codes (RF-001 through RF-020)

The dashboard does not commit commercial game data. When no real-world pilot data exists, the BLOCKED_PENDING_USER_DATA note explains what is needed.

## Sidebar Structure

Trainer Mode sidebar:
- Category filters (21 predefined game categories)
- Quick actions: Backups, Journal

Workshop Mode sidebar:
- 7 navigation items for the pages above

Both modes share the top-level mode toggle row.

## IPC Surface Added for Pilot

Three new IPC channels registered in `electron/main.ts`:

| Channel | Schema | Returns |
|---------|--------|---------|
| `check-game-running` | `CheckGameRunningSchema` (gameId: UUID or demo literal) | `{ running: boolean, evidence: string }` |
| `get-compatibility-profile` | `GetCompatibilityProfileSchema` | first matching profile or null |
| `get-all-profiles` | (no input) | all profiles as array |

Corresponding `contextBridge` exposures in `electron/preload.ts` and typed in `src/types/global.d.ts`.
