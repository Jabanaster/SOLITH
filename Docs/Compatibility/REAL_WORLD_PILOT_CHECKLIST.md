# Real-World Pilot Checklist

**Version:** 1.0  
**Use when:** About to begin a real-world save compatibility test session.

---

## Pre-Session Checklist

### Game and Save Requirements

- [ ] Game is **single-player** and **offline-capable**
- [ ] No multiplayer, online leaderboard, or anti-cheat component
- [ ] Game is **fully closed** (not running, not in background)
- [ ] Cloud sync paused or disabled (Steam Cloud, GOG Galaxy, etc.)
- [ ] Save file is **locally stored** (not only in cloud)
- [ ] Save file format is JSON, INI, XML, CSV, or plain text

### User Confirmations

- [ ] You own the game
- [ ] You have the right to make a personal backup copy
- [ ] The save and workspace will NOT be committed to Git
- [ ] You understand that edits apply only to the workspace copy

### Technical Pre-Check

- [ ] `npm run build:electron` passes (18/18 output verifier)
- [ ] `npm run test:electron-smoke` passes (Gate 10, 6/6)
- [ ] `npm run test:electron-e2e` passes (Gate 13, 4/4)
- [ ] `npm run test:trainer-e2e` passes (5/5)

---

## Format Accept / Reject Criteria

| Condition | Decision |
|-----------|---------|
| Extension: `.json`, `.ini`, `.cfg`, `.conf`, `.xml`, `.csv`, `.txt` | ACCEPTED |
| Extension: `.bin`, `.dat`, `.sav`, or unknown | REJECTED |
| File is encrypted or compressed (non-readable as text) | REJECTED |
| File is signed or packed executable | REJECTED |
| File is a cloud-only save (no local copy) | REJECTED |
| File contains no readable fields after parse | REJECTED |

---

## Intake Execution

1. Collect required information (see `Docs/Guides/REAL_WORLD_PILOT_INTAKE.md`)
2. Run intake pipeline via `intakePilotSave()`
3. Verify `manifest.json` was created in `.local-pilot-workspaces/`
4. Confirm `formatStatus` in manifest is `"ACCEPTED"`
5. Confirm `save.sourceHashSha256 === workspace.workspaceHashSha256`

---

## Testing Checklist (per save file)

### Discovery

- [ ] Workshop scan finds save file at the workspace path
- [ ] Parser reads the format correctly (no parse errors)
- [ ] At least one field is identified as editable

### Recipe Creation

- [ ] Create at least one recipe targeting a safe numeric or boolean field
- [ ] Recipe risk is `Safe` or `Low Risk` (not `Blocked`)
- [ ] Recipe confidence ≥ 70%

### Apply Flow

- [ ] Backup is created with correct source hash
- [ ] Proposal is created with proposed value
- [ ] Apply succeeds (`success: true`)
- [ ] Workspace file hash matches expected output hash
- [ ] Source file hash is unchanged after apply

### Restore Flow

- [ ] Restore succeeds (`success: true`)
- [ ] Workspace file reverts to pre-apply hash
- [ ] Hash after restore matches backup hash

### Game Validation (offline, local only)

- [ ] Open the game (in offline mode)
- [ ] Load the edited workspace save (or copy workspace save to game directory for testing)
- [ ] Confirm the edited field reflects the applied value
- [ ] Close the game
- [ ] Restore the workspace save to original
- [ ] Confirm the original field value is correct

---

## Outcome Recording

Record all results in `Docs/Compatibility/PILOT_RESULTS.md`:

| Field | Values |
|-------|--------|
| Game title + version | — |
| Save format | json / ini / xml / csv / text |
| Cloud sync risk | none / low / high |
| Format status | ACCEPTED / REJECTED |
| Apply result | SUCCESS / FAILED |
| Restore result | SUCCESS / FAILED |
| Game validation | PASS / FAIL / SKIPPED |
| Evidence tier | Tier 1 (real save) |
| Source hash | SHA-256 |
| Notes | any edge cases, warnings, anomalies |

---

## Do NOT label any game VERIFIED until all of the following are confirmed:

1. Backup hash == source hash (pre-apply)
2. Apply succeeded
3. Post-apply hash matches expected output
4. Restore succeeded
5. Post-restore hash == backup hash (reverted)
6. Source file hash unchanged throughout
7. Game validation passed (or explicitly documented as SKIPPED with reason)

Evidence tier must be **Tier 1 (real-world save)** — sandbox fixtures do not qualify.

---

## Post-Session

- [ ] Game is restored to original save (if workspace save was copied for validation)
- [ ] Cloud sync re-enabled (if it was paused)
- [ ] Pilot results recorded in `Docs/Compatibility/PILOT_RESULTS.md`
- [ ] `Docs/CONTEXT_HANDOFF.md` updated with outcome
- [ ] `.local-pilot-workspaces/` confirmed NOT staged for commit
