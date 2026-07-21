# Real-World Pilot Intake Guide

**Version:** 1.0  
**Applies to:** Solith V1 compatibility pilot  

---

## Purpose

This guide describes how to safely intake one real-world game save for compatibility testing. The intake creates an isolated workspace copy so the original save is never modified. The original file remains in place and unchanged.

---

## Pre-Requisites (All Must Be Confirmed)

Before providing a save file, confirm **all** of the following:

| Requirement | Confirm |
|-------------|---------|
| The game is a **single-player**, **offline** game | ✓ required |
| The game is **closed** — not running, not syncing | ✓ required |
| You **own** the game (purchased or free) | ✓ required |
| You have the right to make a personal backup copy | ✓ required |
| The save will **not be added to Git** | ✓ required |
| Cloud sync is paused or disabled for this save location (if applicable) | strongly recommended |

---

## Required Information

Provide the following when submitting a save for intake:

```
Game title:        [full game name]
Game version:      [e.g. 1.2.3 or "latest Steam build"]
Store / platform:  [steam | gog | epic | itch | disc | other]
Save file path:    [full absolute path to the save file]
Save extension:    [e.g. .json, .ini, .xml, .sav]
Cloud sync risk:   [none | low | high]
```

---

## Accepted File Formats

| Format | Extensions | Status |
|--------|-----------|--------|
| JSON | `.json` | **ACCEPTED** |
| INI / Config | `.ini`, `.cfg`, `.conf` | **ACCEPTED** |
| XML | `.xml` | **ACCEPTED** |
| CSV | `.csv` | **ACCEPTED** |
| Plain text | `.txt` | **ACCEPTED** |
| Binary saves | `.bin`, `.dat`, `.sav`, others | **REJECTED** — read-only, no editing |
| Unknown extension | any other | **REJECTED** — unknown format |

Rejected saves are copied and hashed for analysis purposes only. No editing operations are performed.

---

## What the Intake Does

The intake pipeline runs automatically after you provide the path and information above:

1. Verifies the source file exists
2. Rejects source paths inside the repo, workspace directories, or system paths
3. Hashes the source file (SHA-256) before any operation
4. Creates an isolated pilot workspace with a unique ID
5. Copies the save to the workspace — **original is not moved or modified**
6. Re-hashes workspace copy and verifies it matches the source hash
7. Re-hashes the source to confirm it was not modified during copy
8. Creates a backup of the workspace copy
9. Builds and validates a manifest (JSON) recording all hashes, paths, and confirmations
10. Writes the manifest to the pilot directory

---

## Output Structure

After a successful intake, the following structure is created in the pilot workspace root:

```
.local-pilot-workspaces/
└── pilot-{timestamp}-{id}/
    ├── manifest.json          ← audit record (schemaVersion, hashes, confirmations)
    ├── workspace/
    │   └── save.{ext}         ← isolated copy for editing
    └── backup/
        └── save-backup.{ext}  ← pre-edit backup (must match source hash)
```

---

## What Does NOT Happen

- The original save file is **not modified**
- The original save file is **not moved**
- No game process is started or killed
- No registry or system configuration is changed
- Nothing is written to Git
- No network requests are made

---

## After Intake

Once intake completes:

1. Verify `manifest.json` — confirm `formatStatus: "ACCEPTED"`
2. Confirm `save.sourceHashSha256 === workspace.workspaceHashSha256`
3. Use the Workshop to scan the workspace copy and create recipes
4. Use the Trainer to apply proposed edits (applies only to workspace copy)
5. Validate the game loads the edited save correctly
6. Record the outcome in `Docs/Compatibility/PILOT_RESULTS.md`

---

## Cloud Sync Warning

If the game uses cloud sync (Steam Cloud, GOG Galaxy, Xbox GamePass, etc.):

- **Pause or disable cloud sync** before testing
- Keep the game closed for the entire session
- Re-enable cloud sync only after restoring the original save
- Set `cloudSyncRisk: "high"` in the intake form if you cannot disable it

The workspace copy is isolated from cloud sync. The original save in the game's save directory is not touched by Solith.

---

## Safety Checklist Before Submitting

- [ ] Game is fully closed (check Task Manager)
- [ ] Cloud sync is paused or confirmed not active
- [ ] You know the full absolute path to the save file
- [ ] The save file is JSON, INI, XML, CSV, or plain text (not binary)
- [ ] You are not providing a save from a multiplayer or online game
