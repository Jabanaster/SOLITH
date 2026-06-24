# Compatibility Pilot Results

## Status: BLOCKED_PENDING_USER_DATA

No real-world game save files have been submitted for pilot testing.

## Required to Unblock

The user must provide:
1. The name and platform of a single-player game with a readable save format
2. A save file (or consent to copy one from their install)
3. Confirmation the game is closed during testing

## What Will Be Recorded Here

When a real-world pilot runs, this file will contain:

```
game:              <game name>
store:             <Steam / GOG / Epic / Other>
save_format:       <JSON / INI / XML / etc.>
adapter:           <adapter id used>
field_tested:      <e.g., player.gold>
evidence_tier:     Tier 1 — actual-save-tested
source_hash:       <sha256 of original save>
workspace_before:  <sha256 of workspace before apply>
workspace_applied: <sha256 after applying change>
workspace_restored:<sha256 after restore>
expected_output:   <pre-computed sha256 of target output>
all_invariants:    PASS / FAIL
issues_discovered: RF-xxx, RF-xxx
profile_level:     VERIFIED / SUPPORTED / READ_ONLY / EXPERIMENTAL / UNSUPPORTED / BLOCKED
date:              <ISO date>
```

## Fixture-Tested Baseline (Tier 2)

The following has been confirmed with the synthetic fixture in the real Electron runtime:

| Item | Hash |
|------|------|
| Source (immutable) | `269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55` |
| Workspace before | `269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55` |
| After apply (gold→9999) | `811a630f9bdcda767edce9aa26532116d212a0ebb0d2affa93663fd36f7f1f63` |
| After restore | `269cb1a4e497525453ca71f6b840bfa855ae716d4068c6abafd41754fcc82e55` |

This is NOT Tier 1 evidence. It does not prove the system works with any real game save.
