# Compatibility Pilot Results

## Status

```text
BLOCKED — first real-world save remains read-only
```

## Atomfall — real-world read-only result

| Field | Result |
|---|---|
| Game / version | Atomfall 1.23.105.0 |
| Platform | Xbox |
| Evidence tier | `REAL_WORLD_SANDBOX` |
| Format | Unknown proprietary binary, extensionless, 4,194,304 bytes |
| Profile status | `READ_ONLY` |
| Source-copy hash equality | PASS |
| Original unchanged after copy and inspection | PASS |
| Parser / serializer | None |
| Trainer target | None |
| Apply / restore | Not attempted — prohibited without format understanding |

The full source hash and personal paths are intentionally excluded from Git. Atomfall proves
the unknown-binary safety boundary, but it does not satisfy the writable real-game pilot.

## Required to Unblock

The next candidate must be a normal Windows PC game with a deterministic structured local
save such as JSON, INI, XML, CSV, plain text, or safely supported unencrypted SQLite.

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
