# Trainer Mode — User Guide

## Overview

Trainer Mode is the simple editing interface. It shows your game's editable fields as cards with controls. Every change goes through a review step before anything is written.

## Getting Started

1. Launch ResourceForge
2. Make sure the sidebar shows "Trainer" as the active mode (click it if not)
3. Open "Game Library" and add your game's folder
4. Click your game to open the Trainer

## Reading the Cards

Each card shows:
- **Category badge** (PLAYER, INVENTORY, etc.)
- **State badge** — what the card can currently do
- **Name** — the field being edited
- **Risk chip** — Safe / Caution / Risky / Blocked
- **Current value** — what the file contains right now
- **Control** — what you can change it to

## Card States

| State | Meaning |
|-------|---------|
| Ready | You can enter a value and apply |
| Game Running | Close the game first |
| Blocked | This field cannot be safely edited |
| Broken | The save file can't be read |
| Needs Rescan | The game updated and paths may have changed |
| Applying | A write is in progress — do not close |
| Applied | Change written successfully — backup was created |
| Restored | Original value recovered from backup |
| Failed | Apply failed — your file is unchanged |

## Making a Change

1. Click a card to select it (details appear in the right panel)
2. Enter or adjust the value using the control
3. Click **Apply**
4. Review the confirmation dialog — it shows current vs. proposed, the file, and the backup notice
5. Click **Confirm Apply**
6. The card shows "Applied" when done

## Restoring a Change

1. Select the card you applied to
2. In the right panel, click **Restore Last Backup**
3. The card shows "Restored" when done

## Category Navigation

Use the sidebar categories to filter cards. "All Items" shows everything. Categories like Player, Currency, Inventory filter by what kind of field it is.

## Safety Notes

- ResourceForge never modifies a file without your confirmation
- A backup is always created before any write
- The game-running warning prevents accidental overwrites
- Blocked and broken items cannot be edited at all
- Changes to unknown, encrypted, or binary formats are never attempted
