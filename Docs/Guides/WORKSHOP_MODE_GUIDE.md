# Workshop Mode — User Guide

## Overview

Workshop Mode is the advanced interface. It exposes the underlying discovery, recipe management, backup history, and compatibility tools used to build and maintain trainer items.

## Switching to Workshop Mode

Click **Workshop** in the mode toggle at the top of the sidebar. The view switches immediately and persists across restarts.

## Pages

### Save Editor
Browse the raw parsed save tree. Select a save file, see all fields, and apply targeted edits. Useful for one-off changes to fields not yet in the trainer.

### Data Editor
Same as Save Editor but focused on config/data files rather than save files.

### Discovery Lab
Compare two save states to find which fields changed. Use this to discover new trainer candidates:
1. Load a before-state save
2. Change something in the game
3. Load an after-state save
4. Review the candidate list
5. Promote candidates to recipes

### Save Locations
Manage which directories ResourceForge can read from. Locations must be approved before save files in them can be parsed or edited.

### Recipes
View and manage the recipe database. Recipes are the source of Trainer Mode cards. Delete stale recipes here.

### Backups
Browse all backups created during apply operations. Restore any previous state from this page.

### Journal
Audit trail of every operation: scans, discoveries, proposals, applies, and restores. Use this to verify what changed and when.

### Compatibility
Shows the compatibility profile status for all known games. Until real-world save data is tested, this shows BLOCKED_PENDING_USER_DATA for all games.

## Switching Back

Click **Trainer** in the mode toggle. If a game was selected, the Trainer page opens immediately. Mode and selected game are both remembered.
