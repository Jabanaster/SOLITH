# Trainer Mode — Architecture

## Overview

Trainer Mode is the primary end-user interface for Solith. It presents editable trainer items as cards in a 3-region layout (sidebar categories, main card grid, right context panel). Every edit goes through a proposal → backup → apply → validate flow with a restore path.

## Components

### TrainerPage (`src/app/pages/TrainerPage.tsx`)

Owns all Trainer Mode runtime state:

| State | Type | Purpose |
|-------|------|---------|
| `items` | `TrainerItem[]` | Loaded via `getRecipes` IPC (returns `TrainerItem[]`, not `Recipe[]`) |
| `values` | `Record<id, any>` | Proposed values per item — initialized from `item.currentValue` |
| `transientStates` | `Record<id, TrainerCardState>` | Overrides derived state for APPLYING/APPLIED/RESTORED/FAILED |
| `backupIds` | `Record<id, string>` | Backup ID returned by successful `applyProposal` |
| `lastOpMessages` | `Record<id, string>` | Human-readable last-operation summary |
| `selectedId` | `string | null` | Item feeding the ContextPanel |
| `applyPending` | `ApplyPending | null` | Data for the open ApplyDialog |
| `gameRunning` | `boolean` | Read-only process check result |

### TrainerCard (`src/app/components/TrainerCard.tsx`)

Renders a single editable item. Exports:
- `TrainerCardState` — 11-variant union
- `STATE_CONFIG` — label/color/explanation per state
- `TrainerCard` component

Control types dispatch on `item.inputType`:
- `'toggle'` → checkbox + custom CSS track
- `'slider'` → `<input type="range">` bounded by `item.min`/`item.max`
- `'dropdown'` → `<select>` from `item.options`
- default (`'number'`) → `<input type="number">`

BLOCKED and BROKEN items hide controls entirely; Apply button is disabled.

### ApplyDialog (`src/app/components/ApplyDialog.tsx`)

Modal confirmation before any write. Shows:
- Diff preview: current value → proposed value
- File name (last path segment of `item.source`)
- Target path (`item.path`)
- Risk chip
- Backup notice (always present — no opt-out)
- Expanded warning for Risky items

Blocked items return `null` — dialog never opens.

### ContextPanel (`src/app/components/ContextPanel.tsx`)

Right-hand detail panel. Shows:
- Description, current/proposed values, risk, confidence, range, target path
- GAME_RUNNING and NEEDS_RESCAN warnings
- Last operation message
- Restore button when a backup ID is available for the selected item

## State Machine — `deriveCardState()`

Priority order (highest wins):

1. **Transient lock** — if transient is one of `APPLYING | APPLIED | RESTORED | FAILED`, return it unchanged
2. **BLOCKED** — if `item.risk === 'Blocked'` OR `item.status` (lower) === `'blocked'`
3. **NEEDS_RESCAN** — if `item.status` (lower) === `'needs rescan'`
4. **BROKEN** — if `item.status` (lower) === `'broken'`
5. **GAME_RUNNING** — if the read-only process check reports the game is open
6. **READY** — default

`NEEDS_SAVE` and `STALE` are future concepts, not active `TrainerCardState` values. They were
removed from the production union because no state-machine or IPC branch emitted them.

## Apply Flow

```
User clicks Apply
  → handleApplyClick() opens ApplyDialog
User confirms
  → handleApplyConfirm()
    → set transient APPLYING
    → IPC: createProposalForEdit(gameId, filePath, path, oldValue, newValue, recipeId)
    → IPC: applyProposal(proposal)
    → On success: set APPLIED, store backupId, reload items
    → On failure: set FAILED, store error message
```

## Restore Flow

```
User clicks "Restore Last Backup" in ContextPanel
  → handleRestore(backupId)
    → set transient APPLYING
    → IPC: restoreBackup(backupId)
    → On success: set RESTORED, reload items
    → On failure: set FAILED, store error message
```

## Game-Running Detection

IPC handler `check-game-running` calls `isGameRunning(profile)` from `src/core/process/index.ts`:
- Windows: `tasklist /FO CSV /NH` output parsed for executable names
- Unix: `ps -e` output parsed for executable names
- Returns `{ running: boolean, evidence: string }`
- **Read-only. No injection. No memory access. No patching.**

## Safety Constraints (non-negotiable)

- No process injection, DLL injection, memory injection, live process patching
- No anti-cheat bypass, DRM bypass, encryption bypass, signature bypass
- No multiplayer or online-service modification
- No cloud-save manipulation without explicit local-copy isolation
- No runtime overlays, system-wide hotkeys, hidden background modification
- No automatic editing — every change requires proposal + backup + user confirmation
- Unknown, encrypted, signed, packed, compressed, or proprietary binary saves: READ-ONLY
