# Phase 10 — Gated Write Architecture (Trust Shift update)

**Status:** Implemented + Trust Shift (2026-07-20).  
**Boundary:** `WriteProcessMemory` only after fail-closed gates. No injection expansion.

## Threat model (summary)

| Threat | Mitigation |
|--------|------------|
| Silent / automatic writes | Propose → confirm → rollback; gate requires `userApproved` |
| Operator responsibility | `singlePlayerWaiverAccepted` (replaces connection-count `isOffline` block) |
| Research probes without checkpoint | `research_probe` requires snapshot backup + `researchWriteModeEnabled` |
| Injection / code exec | Structurally absent from schema; `INJECT_FORBIDDEN` reserved |
| Operator mistakes | `readOnlyMode` hard kill; audit on allow/deny with `waiverAssumed` |

### Trust Shift (writes / freeze)

Automated **connection-count OnlineGuard no longer blocks** attach writes, confirm, rollback, or freeze ticks.  
Use `evaluateWriteConsent` — waiver required; connection evidence is **advisory** in the reason string.

Legacy `evaluateOnlineGuard` remains for diagnostics / `recheckOnlineGuard` transparency UIs and KI-017 history.

### Residual risk (honest)

Consent is **manual responsibility**, not network proof. A user can accept the waiver while a multiplayer session is active. Endpoint identity is not validated. Do not claim multiplayer safety.

## Gate matrix

`src/core/live-memory/write-policy.ts` — `WritePolicyGate.evaluate(context)`

| Check | Trainer | Research probe |
|-------|---------|----------------|
| `readOnlyMode` | Deny | Deny |
| `singlePlayerWaiverAccepted` | Required | Required |
| `userApproved` | Required | Required |
| `researchWriteModeEnabled` | N/A | Required (default false) |
| `hasBackupSnapshot` | N/A | Required |

Deprecated: `isOffline` maps onto the waiver flag for migration; `ONLINE` gate code retained but unused for new denies (`NO_CONSENT` used instead).

## Integration

`MemoryManager` calls the gate before `proposeWrite`, `confirmWrite`, and `safeWrite`.  
Successful write audits set `waiverAssumed: true`.

## Tests

```powershell
cd "G:\ACTIVE_PROJECTS\SOLITH"
npx tsx --test tests/live-memory/write-policy.test.ts tests/live-memory/write-consent.test.ts tests/live-memory/live-memory-session.test.ts
```

## Non-goals

- Multiplayer targeting / claiming online safety from waiver
- Expanding Milestone M in-process pilot
- Kernel drivers / packet capture / AA-Lua inject
