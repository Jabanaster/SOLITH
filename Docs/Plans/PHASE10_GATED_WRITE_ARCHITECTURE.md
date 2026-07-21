# Phase 10 — Gated Write Architecture

**Status:** Policy scaffold implemented; research write mode **default OFF**.  
**Boundary:** `WriteProcessMemory` only after fail-closed gates. No injection expansion.

## Threat model (summary)

| Threat | Mitigation |
|--------|------------|
| Silent / automatic writes | Propose → confirm → rollback; gate requires `userApproved` |
| Online / multiplayer targeting | Existing online-session guard + gate `isOffline` |
| Research probes without checkpoint | `research_probe` requires snapshot backup + `researchWriteModeEnabled` |
| Injection / code exec | Structurally absent from schema; `INJECT_FORBIDDEN` reserved |
| Operator mistakes | `readOnlyMode` hard kill; audit on allow/deny |

### Residual risk (honest)

Online guard is still a **connection-count ceiling** (KI-017). A multiplayer (or other unsafe) connection that **replaces** telemetry without increasing ESTABLISHED count can still pass. Endpoint identity is not validated.

## Gate matrix

`src/core/live-memory/write-policy.ts` — `WritePolicyGate.evaluate(context)`

| Check | Trainer | Research probe |
|-------|---------|----------------|
| `readOnlyMode` | Deny | Deny |
| `isOffline` | Required | Required |
| `userApproved` | Required | Required |
| `researchWriteModeEnabled` | N/A | Required (default false) |
| `hasBackupSnapshot` | N/A | Required |

## Integration

`MemoryManager` calls the gate before `proposeWrite`, `confirmWrite`, and `safeWrite`.  
Override via `setWritePolicyContext(...)`; null restores `defaultTrainerWritePolicyContext()`.

Trainer product path keeps working with defaults (`writeClass: 'trainer'`, offline+approved assumed by caller that already passed session guards).

## Relation to Avowed SOP Phase D

Safe probe writes only when:

1. Candidate isolated (Phase 9 tools)
2. Operator enables research write mode
3. Session snapshot checkpoint saved
4. Explicit confirm

## Tests

```powershell
cd "G:\ACTIVE_PROJECTS\SOLITH"
npx tsx --test tests/live-memory/write-policy-gate.test.ts
```

## Non-goals

- New one-click cheat write UI
- Expanding Milestone M in-process pilot
- Claiming stronger online protection than count-ceiling
