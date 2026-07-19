# Compatibility Pilot Report

## Milestone Decision

**BLOCKED — real-world compatibility pilot requires approved user data**

All non-user-data implementation and verification is complete. The only remaining blocker is Outcome C, which cannot proceed without real-world save files provided by the user.

## Outcome Summary

| Outcome | Description | Status |
|---------|-------------|--------|
| A | Polished Trainer Mode UI | COMPLETE |
| B | Workshop Mode toggle | COMPLETE |
| C | Real-world save compatibility | BLOCKED_PENDING_USER_DATA |
| D | Compatibility Framework | COMPLETE |

## Evidence Tiers Used

| Claim | Evidence Tier | Detail |
|-------|--------------|--------|
| apply/restore workflow correct | Tier 2 — Sandbox | Gate 13 E2E + Trainer E2E; fixture `{"player":{"gold":150}}` |
| hash invariants hold | Tier 2 — Sandbox | All four invariants verified in both E2E suites |
| packaged exe works | Tier 2 — Sandbox | Gate 18 (20/20); fixture copied to isolated temp dir |
| new IPC channels work | Tier 2 — Sandbox | Trainer E2E tests 26–28 |
| real game save compatibility | None (Tier 1 required) | No commercial save files tested |

This report explicitly distinguishes:
- **Fixture-tested**: synthetic `{"player":{"hp":100,"gold":150}}` — used for all Gate 13 and Trainer E2E tests
- **Sandbox-tested with copied real-world data**: NOT YET DONE
- **Actual-save-tested**: NOT YET DONE — requires user-approved save file

## Hash Evidence (Tier 2, from Gate 13 and Trainer E2E)

```
source_before          = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
source_after           = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
workspace_before       = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
verified_backup_hash   = 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
expected_output        = 811a630f9bdcda767edce9aa26532116d212a0ebb0d2affa93663fd36f7f1f63
workspace_after_apply  = 811a630f9bdcda767edce9aa26532116d212a0ebb0d2affa93663fd36f7f1f63
workspace_after_restore= 269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55
```

Invariants:
- `source_before = source_after` ✓ (source file never modified)
- `workspace_before = verified_backup = workspace_after_restore` ✓ (restore recovered original)
- `workspace_after_apply = expected_output` ✓ (apply produced correct bytes)
- `workspace_after_apply ≠ workspace_before` ✓ (apply changed the file)

## What Is Needed to Unblock Outcome C

1. User nominates a real single-player game with a JSON or plain-text save format
2. User provides or consents to copy one save file from their install
3. Solith Discovery Lab identifies candidate fields
4. Sandbox pilot runs the full apply → verify → restore → verify cycle
5. Tier 1 hash evidence recorded in `Docs/Compatibility/PILOT_RESULTS.md`
6. Profile level updated to VERIFIED for that game
7. No save file content committed to git

## What Cannot Trigger ACCEPTED

- Unit tests alone (Tier 3)
- Browser screenshots (Tier 4)
- Fixture-only evidence (Tier 2 — this document)
- Claiming commercial saves were tested without actual hash evidence

## Gate Results at This Milestone

| Gate / Suite | Command | Result |
|--------------|---------|--------|
| Electron output verifier | `npm run verify:electron-output` | 18/18 ✓ |
| Gate 10 bundled smoke | `npm run test:electron-smoke` | 6/6 ✓ |
| Gate 13 Electron E2E | `npm run test:electron-e2e` | 4/4 ✓, repeatability CONFIRMED |
| Trainer E2E | `npm run test:trainer-e2e` | 5/5 ✓ |
| Gate 18 packaged smoke | `npm run test:packaged-smoke` | 20/20 ✓ |
| Unit tests | `npm test` | 99/99 ✓ |
| TypeScript | `npx tsc --noEmit` | 0 errors ✓ |
