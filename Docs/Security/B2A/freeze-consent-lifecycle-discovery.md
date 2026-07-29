# SOLITH — BATCH B2A: FREEZE CONSENT AND RENDERER LIFECYCLE DISCOVERY

Date: 2026-07-27
Status: Read-only discovery complete. No production code modified.

---

## 1. Current Authorization Path (freeze-start)

### IPC Entry Point
- **File**: `electron/live-memory-ipc.ts:742`
- **Handler**: `ipcMain.handle('live-memory-freeze-start', ...)`
- **Sender validation**: `requireTrustedSender(event)` → `validateIpcSender(event)` (trusted-sender-registry.ts)
- **Feature gate**: `isFeatureEnabled()` — fails closed if disabled between propose and confirm

### Payload Validation
- **Schema**: `LiveMemoryFreezeConfirmSchema` (Zod)
- **Required fields**: `proposalId`, `consentToken`

### Process Identity Re-verification
- `bundle.session.verifyAttachedProcessIdentity()` — confirms PID, executable path, start time, volume serial, file index, exe SHA256 still match attachment

### Proposal Lookup
- `bundle.session.getPendingFreezeProposal(parsed.proposalId)` — returns staged `FreezeProposal` or undefined (already consumed)

### Consent Binding Construction (lines 764-781)
```typescript
const consentBinding = {
  operation: 'live_memory_freeze_start',
  sessionKey: String(event.sender.id),
  proposalId: proposal.proposalId,
  attachedPid: identity.pid,
  attachedExecutableName: identity.executableName,
  executablePath: identity.executablePath,
  processStartTime: identity.startTime,
  volumeSerialNumber: identity.volumeSerialNumber,
  fileIndex: identity.fileIndex,
  attachedExeSha256: identity.exeSha256,
  address: proposal.target.address.toString(),
  dataType: proposal.target.dataType,
  freezeValue: proposal.value,
  freezeIntervalMs: proposal.intervalMs,
  freezeMaxDurationMs: MAX_FREEZE_DURATION_MS,
  windowId: event.sender.id,
};
```

### Consent Consumption & Freeze Start
- `bundle.manager.freezeStart(parsed.proposalId, { consentToken: parsed.consentToken, consentBinding })`
- **MemoryManager.freezeStart** (`src/core/live-memory/memory-manager.ts:377`):
  1. `consumeWriteConsent(options.consentToken, options.consentBinding)` — validates binding match, expiry, single-use; consumes atomically
  2. On failure: audit `abort` with `consent_denied:<reason>`, return error
  3. On success: `this.session.startFreezeConfirmed(proposalId)`
  4. Audit `write` with `freeze_start_confirmed` or `freeze_start_failed`

### Session Freeze Start
- **LiveMemorySession.startFreezeConfirmed** (`src/core/live-memory/live-memory-session.ts:944`):
  1. Gets proposal, deletes it (single-use — proposal consumed whether start succeeds or fails)
  2. Calls `startFreeze(proposal.target, proposal.value, proposal.intervalMs)`
- **LiveMemorySession.startFreeze** (line 960):
  1. Registers in cross-session concurrency registry (`registerActiveFreeze`)
  2. Increments `freezeGeneration` (invalidates in-flight ticks)
  3. Creates freeze object with `active: true`, `timer: null`, `tickCount: 0`
  4. Starts async `tick()` loop:
     - Re-checks write consent (single-player waiver) each tick
     - Re-verifies process identity each tick
     - Re-checks feature flag each tick
     - Writes memory value
     - Checks max duration (`tickCount * intervalMs >= maxFreezeDurationMs`)
     - Schedules next tick via injectable `FreezeScheduler`

---

## 2. Current Lifecycle Path (freeze-stop / orphan prevention)

### Explicit Stop (User-Initiated)
- **IPC**: `live-memory-freeze-stop` (`electron/live-memory-ipc.ts:793`)
- **Session**: `session.stopFreeze()` → `stopFreezeInternal('user_stopped')`
- **Internal** (`stopFreezeInternal`, line 1075):
  1. Increments `freezeGeneration` (cancels in-flight tick scheduling)
  2. Cancels `freeze.timer` via `freezeScheduler.cancel()`
  3. Unregisters from concurrency registry (`unregisterActiveFreeze`)
  4. Sets `freeze.active = false`, `freeze.stopReason = reason`

### Renderer Destruction Cleanup
- **Wiring**: `wireSessionCleanupOnDestroy(webContents, () => disposeSession(senderId))` in `bindSessionBundle` (line 1437)
- **Session cleanup** (`src/core/live-memory/session-cleanup.ts:24`):
  - Uses `WeakSet` to wire exactly one `'destroyed'` listener per WebContents
  - Calls `disposeSession(senderId)` → `session.detach()`
- **Session.detach** (`live-memory-session.ts:1093`):
  1. `stopFreezeInternal('detached')`
  2. `unregisterAllFreezesForOwner(this.ownerId)` — removes ALL freezes for this session owner
  3. Closes process handle, clears all proposal/confirmed maps

### Renderer Navigation/Reload Cleanup (Batch B1.1)
- **Wiring**: `wireSessionCleanupOnNavigate(webContents, () => disposeSession(senderId))` (line 1441)
- **Listener**: `'did-navigate'` event on WebContents (fires on full-page navigation/reload, NOT hash-based SPA navigation)
- **Same disposeSession path** as destruction

### App Shutdown Cleanup
- **Function**: `disposeAllLiveMemorySessions()` (`live-memory-ipc.ts:1482`)
- **Called from**: `app.on('will-quit')` in `electron/main.ts`
- **Iterates all sessions**, calls `disposeSession` for each

### Cross-Session Concurrency Registry
- **File**: `src/core/live-memory/freeze-concurrency-registry.ts`
- **Tracks**: `activeFreezes` Map keyed by `${owner}|${pid}|${address}|${dataType}`
- **Limits**: `MAX_FREEZES_PER_PROCESS = 8`, `MAX_FREEZES_GLOBAL = 32`
- **Owner**: opaque string (sender.id / session ownerId)
- **Cleanup**: `unregisterActiveFreeze` on stop/error, `unregisterAllFreezesForOwner` on detach

### Six-Hour Maximum Duration
- **Constant**: `MAX_FREEZE_DURATION_MS = 6 * 60 * 60 * 1000` (6 hours)
- **Enforced in tick loop**: `elapsedMs = tickCount * intervalMs; if (elapsedMs >= maxFreezeDurationMs) stopFreezeInternal('max_duration_exceeded')`
- **Independent of wall clock** — deterministic via injectable `FreezeScheduler` (testable)

---

## 3. Bypass / Orphan Scenarios Identified

| Scenario | Current Behavior | Gap / Risk |
|----------|------------------|------------|
| **Renderer crash (process exit)** | `'destroyed'` fires → `disposeSession` → `detach()` → freeze stopped | Covered |
| **Renderer reload (F5 / location.reload)** | `'did-navigate'` fires → `disposeSession` → `detach()` → freeze stopped | Covered (Batch B1.1) |
| **Renderer navigation (window.location = ...)** | `'did-navigate'` fires → same as reload | Covered |
| **Main window close + overlay window stays** | Each window has own `senderId` / session; `unregisterAllFreezesForOwner` only clears that owner's freezes | Other window's freezes persist (by design — separate session) |
| **IPC caller bypasses consent (no token)** | `freezeStart` requires `consentToken` + `consentBinding`; `consumeWriteConsent` fails closed if missing/invalid | No bypass — token mandatory |
| **Boolean `userApproved: true` bypass** | `freezeStart` signature does NOT accept `userApproved`; only `consentToken` + `consentBinding` | No legacy bypass |
| **Replay of consumed token** | `consumeWriteConsent` checks `entry.consumed` before binding match; returns `Consent token already consumed` | Atomic consume + delete prevents replay |
| **Token binding mismatch (PID/address/value/interval changed)** | `hashConsentBinding` includes all fields; mismatch → `Consent token binding mismatch` | Bound to exact operation parameters |
| **Token expiry** | `WRITE_CONSENT_TTL_MS = 5 min`; `consumeWriteConsent` checks `expiresAtMs <= nowMs`; deletes expired entry | Short TTL, fails closed |
| **Stale proposal replay** | `startFreezeConfirmed` deletes proposal on lookup; second call returns `Unknown or already-consumed freeze proposal` | Single-use proposal |
| **New renderer inheriting old freeze** | Each renderer gets new `senderId` → new session → new `ownerId`; `unregisterAllFreezesForOwner` only clears old owner's freezes | New renderer cannot inherit — separate owner |
| **Duplicate cleanup (destroy + navigate)** | `WeakSet` guards in `wireSessionCleanupOnDestroy/OnNavigate` prevent double-wiring; `disposeSession` is idempotent (checks `sessions.has`) | Idempotent |
| **Cleanup failure surfaced** | `disposeSession` wraps in try/catch? No — but `session.detach()` is synchronous and non-throwing; process handle close may throw but is caught by caller? | Need to verify audit on cleanup failure |
| **Unrelated process/session affected** | Concurrency registry keyed by `owner|pid|address|dataType`; `unregisterAllFreezesForOwner` only removes entries with matching owner | Isolated by owner + PID |

---

## 4. Bounded Design (What Exists vs. What B2A Must Add)

### Already Implemented (Batch B1 / B1.1)
- ✅ Server-authoritative consent tokens (`write-consent.ts`)
- ✅ Single-use, expiring, operation-bound tokens
- ✅ Atomic consume with double-use prevention
- ✅ Binding includes: operation, sessionKey, proposalId, PID, executable identity, address, dataType, freezeValue, freezeIntervalMs, freezeMaxDurationMs, windowId
- ✅ Proposal single-use (consumed on `startFreezeConfirmed`)
- ✅ Renderer destruction cleanup (`wireSessionCleanupOnDestroy`)
- ✅ Renderer navigation/reload cleanup (`wireSessionCleanupOnNavigate` — Batch B1.1)
- ✅ Cross-session concurrency limits (`freeze-concurrency-registry.ts` — Batch B1.1)
- ✅ Six-hour max duration enforced in tick loop
- ✅ App shutdown cleanup (`disposeAllLiveMemorySessions`)
- ✅ Audit logging for consent denial, freeze start, freeze stop
- ✅ Process identity re-verification at confirm and each tick
- ✅ Feature flag re-check at confirm and each tick
- ✅ Write consent (single-player waiver) re-check each tick

### B2A Scope (Per Mission Brief)
**Per-operation consent hardening** (already largely present — verify no gaps):
- [ ] Proposal/preview returns exact operation details (already in `proposeFreeze` response)
- [ ] Approval issued only after explicit user confirmation (native dialog in `privileged-consent-dialog.ts` → `issueWriteConsent`)
- [ ] Token single-use and expiring (✅)
- [ ] Replay rejected (✅)
- [ ] PID mismatch rejected (✅ via binding hash)
- [ ] Duration mismatch rejected (✅ via binding hash)
- [ ] Unrelated operation rejected (✅ via binding hash `operation` field)
- [ ] Sensitive fields recomputed server-side (binding hash computed server-side in `consumeWriteConsent`)
- [ ] Missing/invalid/expired/reused tokens fail closed (✅)
- [ ] Proposal, approval, execution, rejection, expiry, replay attempts audited (✅ audit entries exist)

**Renderer lifecycle safety** (already largely present — verify no gaps):
- [ ] Renderer destruction stops owned freezes (✅ `wireSessionCleanupOnDestroy` → `detach()`)
- [ ] Renderer crash stops owned freezes (✅ same as destruction)
- [ ] Reload/navigation stops freeze unless explicit authenticated reattachment (✅ `wireSessionCleanupOnNavigate` → `detach()`; no reattachment protocol exists)
- [ ] New renderer cannot silently inherit old freeze (✅ separate `ownerId` per WebContents)
- [ ] Duplicate cleanup idempotent (✅ `WeakSet` guards + `disposeSession` idempotency)
- [ ] Cleanup failure surfaced and audited (⚠️ verify audit on `detach` failure)
- [ ] Six-hour maximum independently enforced (✅ tick-count based)
- [ ] App shutdown stops all owned freezes (✅ `disposeAllLiveMemorySessions`)
- [ ] Unrelated processes/sessions never affected (✅ owner + PID isolation)

---

## 5. Expected Changed Files (B2A Implementation)

Based on discovery, the following files are likely to require changes for B2A hardening:

### Consent Hardening
| File | Reason |
|------|--------|
| `src/core/consent/write-consent.ts` | Verify HMAC/JWT alternative not needed; current opaque token + server Map is sufficient. May add versioned token format if migrating. |
| `electron/live-memory-ipc.ts` | Ensure `freeze-issue-consent` handler audits proposal, approval issuance, denial, expiry. Verify `windowId` binding included. |
| `src/core/live-memory/memory-manager.ts` | Verify audit entries for all consent outcomes (proposal, approval, execution, rejection, expiry, replay). |
| `src/core/live-memory/live-memory-session.ts` | Verify `startFreezeConfirmed` audits proposal consumption. |

### Lifecycle Safety Hardening
| File | Reason |
|------|--------|
| `src/core/live-memory/live-memory-session.ts` | Add explicit audit in `stopFreezeInternal` and `detach` for cleanup success/failure. Ensure `unregisterAllFreezesForOwner` called before process handle close. |
| `src/core/live-memory/session-cleanup.ts` | Verify `wireSessionCleanupOnNavigate` covers all navigation types (main frame only — correct). |
| `electron/live-memory-ipc.ts` | Verify `disposeAllLiveMemorySessions` called on `app.on('will-quit')` and audits each disposal. |
| `src/core/live-memory/freeze-concurrency-registry.ts` | Verify `unregisterAllFreezesForOwner` audit trail. |

### Test Coverage (Required by B2A)
| File | Reason |
|------|--------|
| `tests/live-memory/memory-manager.test.ts` | Add tests for: consent denial audit, replay audit, expiry audit, binding mismatch audit. |
| `tests/live-memory/live-memory-session.test.ts` | Add tests for: renderer destroy stops freeze, renderer navigate stops freeze, new renderer cannot inherit, duplicate cleanup idempotent, cleanup failure state, max duration auto-stop, app shutdown stops all, unrelated freeze untouched, stale renderer cannot stop another's freeze, manual-stop vs destruction race. |

---

## 6. Out-of-Scope Files (Explicitly Excluded by Mission)

| File / Area | Reason |
|-------------|--------|
| `src/core/live-memory/rollback*.ts` | Rollback compare-and-swap / manifest expiration — explicitly excluded |
| `src/core/security/trusted-sender-registry.ts` | Generalized IPC sender/frame/origin validation — explicitly excluded |
| `electron/main.ts` (broad process selection) | Process-selection redesign — explicitly excluded |
| `src/app/pages/*` (UI) | New UI redesign — explicitly excluded |
| `src/core/live-memory/pointer-scan.ts`, `aob-scan.ts` | Unrelated IPC hardening — explicitly excluded |
| `src/core/trainer-catalog/*` | Persistence migrations — explicitly excluded |
| `electron/wisp-overlay.ts`, `trainer-overlay.ts` | Overlay window logic — only relevant insofar as they create separate sessions (already handled by ownerId isolation) |
| Batch B2B / B2C features | Explicitly excluded |

---

## 7. Key Constants & Configuration

| Constant | Value | Location |
|----------|-------|----------|
| `WRITE_CONSENT_TTL_MS` | 5 minutes | `src/core/consent/write-consent.ts:11` |
| `MAX_FREEZE_DURATION_MS` | 6 hours | `electron/live-memory-ipc.ts` (imported from live-memory module) |
| `MAX_FREEZES_PER_PROCESS` | 8 | `src/core/live-memory/freeze-concurrency-registry.ts:24` |
| `MAX_FREEZES_GLOBAL` | 32 | `src/core/live-memory/freeze-concurrency-registry.ts:32` |
| `MIN_FREEZE_INTERVAL_MS` | 10 ms | `src/core/live-memory/live-memory-session.ts` |
| `MAX_FREEZE_INTERVAL_MS` | 1000 ms | `src/core/live-memory/live-memory-session.ts` |

---

## 8. Freeze Session State Machine (Current)

```
PROPOSED (pendingFreezeProposals Map)
    │
    ├─[consent issued]──→ APPROVED (consent token exists, not yet consumed)
    │
    ├─[startFreezeConfirmed called]──→ STARTING (proposal consumed, registering)
    │       │
    │       ├─[concurrency OK]──→ ACTIVE (timer running, tick loop)
    │       │       │
    │       │       ├─[user stop]──→ STOPPING → STOPPED
    │       │       ├─[guard blocked]──→ STOPPING → STOPPED (reason: guard_blocked)
    │       │       ├─[identity mismatch]──→ STOPPING → STOPPED (reason: identity_mismatch)
    │       │       ├─[feature disabled]──→ STOPPING → STOPPED (reason: feature_disabled)
    │       │       ├─[write failed]──→ STOPPING → STOPPED (reason: write_failed)
    │       │       ├─[max duration]──→ STOPPING → STOPPED (reason: max_duration_exceeded)
    │       │       ├─[renderer destroy]──→ STOPPING → STOPPED (reason: detached)
    │       │       ├─[renderer navigate]──→ STOPPING → STOPPED (reason: detached)
    │       │       └─[app shutdown]──→ STOPPING → STOPPED (reason: detached)
    │       │
    │       └─[concurrency limit]──→ FAILED (reason: freeze_concurrency_limit)
    │
    ├─[consent denied/expired/replay]──→ CANCELLED (proposal remains? No — proposal consumed only on startFreezeConfirmed)
    │
    └─[proposal TTL?]──→ EXPIRED (no explicit proposal TTL; consent has 5-min TTL)
```

**Note**: Current implementation does not have explicit `EXPIRED` or `CANCELLED` states for proposals — they remain in `pendingFreezeProposals` until consumed by `startFreezeConfirmed` or the session is destroyed. Consent tokens have 5-min TTL and are cleaned up on expiry check.

---

## 9. Audit Events (Current)

From `memory-manager.ts` and `live-memory-ipc.ts`:

| Event | Trigger | Fields |
|-------|---------|--------|
| `abort` | `freezeStart` consent denied | `op: 'abort', featureId, reason: 'consent_denied:<reason>', waiverAssumed` |
| `write` | `freezeStart` success/failure | `op: 'write', featureId, reason: 'freeze_start_confirmed' \| 'freeze_start_failed', waiverAssumed` |
| `write` | `confirmWrite` success/failure | `op: 'write', featureId, reason: 'write_confirmed' \| 'write_failed', waiverAssumed` |
| `write` | `rollback` success/failure | `op: 'write', featureId, reason: 'rollback_ok' \| 'rollback_failed', waiverAssumed` |
| (proposal) | `live-memory-freeze-propose` | Not explicitly audited in memory-manager — IPC handler may audit |
| (consent issue) | `live-memory-freeze-issue-consent` | Not explicitly audited — `privileged-consent-dialog.ts` issues consent |
| (consent consume) | `consumeWriteConsent` | Not explicitly audited — only via `freezeStart` abort/write |

**Gap**: Proposal creation, consent issuance, consent expiry, consent replay attempts should be explicitly audited per B2A requirements.

---

## 10. Verification Commands

```bash
# TypeScript compile check
cd G:\ACTIVE_PROJECTS\SOLITH && npx tsc --noEmit

# Run freeze-related tests
cd G:\ACTIVE_PROJECTS\SOLITH && npm test -- --grep "freeze"

# Run consent tests
cd G:\ACTIVE_PROJECTS\SOLITH && npm test -- --grep "consent"

# Run lifecycle tests
cd G:\ACTIVE_PROJECTS\SOLITH && npm test -- --grep "detach\|navigate\|destroy"

# Full test suite
cd G:\ACTIVE_PROJECTS\SOLITH && npm test
```

---

## 11. Summary

**Discovery complete.** The SOLITH codebase already implements the vast majority of B2A requirements:

- ✅ Per-operation consent with single-use, expiring, operation-bound tokens
- ✅ Renderer destruction/navigation cleanup (Batch B1.1)
- ✅ Cross-session concurrency limits (Batch B1.1)
- ✅ Six-hour max duration enforcement
- ✅ App shutdown cleanup
- ✅ Process identity re-verification
- ✅ Write consent re-check each tick

**Remaining B2A work** is primarily:
1. **Audit completeness** — ensure proposal, consent issuance, consent expiry, replay attempts are explicitly audited
2. **Cleanup failure auditing** — ensure `detach`/`disposeSession` failures are surfaced and audited
3. **Test coverage** — add the required consent and lifecycle tests per B2A specification
4. **Verification** — run full suite, TypeScript compile, confirm no regressions

No architectural changes required. Implementation should be surgical additions to existing audit paths and test files.