# Batch B1.1 Design Document

## Overview
This document describes the security controls implemented in Batch B1.1 to close residual high-risk gaps identified in Batch B1.

## 1. Freeze-Start Consent (Operation-Bound Propose/Confirm)

### Implementation
- **Propose Step**: `live-memory-freeze-propose` stages a freeze request without touching memory
- **Issue-Consent Step**: `live-memory-freeze-issue-consent` shows native dialog with full binding details
- **Confirm Step**: `live-memory-freeze-start` (renamed from confirm) consumes consent token and starts freeze

### Binding Fields (WriteConsentBinding)
All freeze-start consent artifacts bind to:
- `operation`: 'live_memory_freeze_start'
- `sessionKey`: WebContents id (opaque session identifier)
- `proposalId`: UUID of the staged freeze proposal
- `attachedPid`: Target process PID
- `attachedExecutableName`: Target executable name
- `executablePath`: Canonical executable path (fail-closed)
- `processStartTime`: UTC ISO process creation time (fail-closed)
- `volumeSerialNumber`: Volume serial for executable's volume
- `fileIndex`: Stable file index for executable image
- `attachedExeSha256`: SHA-256 of executable image at attach time
- `address`: Memory address as decimal string
- `dataType`: Value type (int32, uint32, float, double, int64, byte)
- `freezeValue`: Value to freeze
- `freezeIntervalMs`: Re-write interval in milliseconds
- `freezeMaxDurationMs`: Hard duration ceiling (6 hours)
- `windowId`: Requesting WebContents id (binds to exact renderer window/frame)

### Consent Artifact Properties
- Short-lived (5 min TTL)
- Single-use (consumed on confirm)
- Bound to exact operation hash (SHA-256 of binding)
- Cannot be replayed or repurposed

## 2. Rollback Integrity

### Implementation
- **Expected-Value Check**: Before rollback, re-reads current memory and requires it to equal the exact `valueAfter` from the confirmed write manifest
- **Reject on Mismatch**: If current memory differs, rollback fails closed without writing — never silently overwrites an independent change
- **TTL Expiration**: Confirmed writes expire after 30 minutes (`CONFIRMED_WRITE_TTL_MS`)
- **Process-Identity Binding**: Rollback re-verifies attached process identity (PID, executable path, start time, volume serial, file index, exe SHA-256)
- **Attachment Binding**: Rollback ledger is per-session; `detach()` clears all confirmed writes
- **Trusted-Window Binding**: IPC handler uses `requireTrustedSender()` which validates sender is a registered Solith window, main frame, on allowed URL
- **Safe Capacity**: Ledger capped at 50 entries (`MAX_CONFIRMED_WRITES`); new confirms REJECTED when full of valid entries (no silent FIFO eviction)
- **Single-Use**: Each confirmed write can only be rolled back once (entry deleted on success)

## 3. Sender Validation (Centralized IPC)

### Implementation
All three B1 handlers use `requireTrustedSender(event)`:
- `live-memory-rollback`
- `live-memory-freeze-propose` / `live-memory-freeze-issue-consent` / `live-memory-freeze-start`
- `registry-run-readonly-verification`

### Validation Checks (trusted-sender-registry.ts)
1. **Trusted webContents.id**: Sender must be in registered window map
2. **Expected BrowserWindow type**: Window type must be 'main', 'wisp-overlay', or 'trainer-overlay'
3. **Main frame only**: Rejects child frames, devtools, iframes
4. **Allowed URL**: Frame URL must match registered prefix (dev server or file://)
5. **Navigation state**: URL check implicitly validates navigation state
6. **Window lifecycle**: `isDestroyed` check + automatic unregistration on 'destroyed' event

## 4. Registry Selection Trust

### Implementation
- **Removed**: Renderer-supplied `userSelectedProcess: true` boolean
- **Added**: Main-process-maintained selection record via `process-selection-registry.ts`
- **Selection Record Fields**:
  - `selectionId`: Server-generated UUID
  - `pid`: Target process PID
  - `executableName`: Verified executable name
  - `executablePath`: Verified executable path
  - `windowId`: Creating WebContents id (enforces same-window use)
  - `createdAtMs`: Timestamp
  - `expiresAtMs`: TTL (5 minutes)
- **Flow**:
  1. Renderer requests selection via `registry-select-process` (main process independently verifies PID matches executable via OS)
  2. Main process creates selection record
  3. Verification references selection by `selectionId` only
  4. Worker call no longer receives `selectedByUser: true` (set to `false`)

## 5. Freeze Cleanup and Limits

### Cleanup Triggers (All Implemented)
| Trigger | Mechanism |
|---------|-----------|
| Process exit | Identity mismatch check in freeze tick |
| Identity change | `verifyAttachedProcessIdentity()` in freeze tick |
| Attachment replacement | `detach()` invalidates pending proposals |
| Detach | `stopFreezeInternal('detached')` + `unregisterAllFreezesForOwner()` |
| Window destruction | `wireSessionCleanupOnDestroy()` → `disposeSession()` |
| Renderer crash | Same as window destruction |
| Renderer reload | `wireSessionCleanupOnNavigate()` → `disposeSession()` |
| Unauthorized navigation | Same as reload (full-page navigation only) |
| Application shutdown | `disposeAllLiveMemorySessions()` on `app.on('will-quit')` |
| Feature flag disablement | `_injectFreezeFeatureFlagCheck()` checked each tick |
| Maximum duration | `MAX_FREEZE_DURATION_MS` (6 hours) checked each tick |

### Centralized Limits (All Implemented)
| Limit | Value | Location |
|-------|-------|----------|
| Minimum interval | 50 ms | `MIN_FREEZE_INTERVAL_MS` |
| Maximum interval | 5000 ms | `MAX_FREEZE_INTERVAL_MS` |
| Maximum duration | 6 hours | `MAX_FREEZE_DURATION_MS` |
| Per-attachment concurrency | 1 freeze per session | `LiveMemorySession` + `freeze-concurrency-registry` |
| Per-process concurrency | 8 freezes | `MAX_FREEZES_PER_PROCESS` |
| Global concurrency | 32 freezes | `MAX_FREEZES_GLOBAL` |
| Duplicate addresses | Rejected | `duplicate_address` check in registry |

## Files Modified
- `electron/registry-verification-ipc.ts` — Removed `selectedByUser: true` from worker call
- All other controls were already implemented in Batch B1 / prior work

## Testing
All 221 live-memory tests pass, including:
- Freeze propose/issue-consent/confirm flow
- Rollback expected-value mismatch rejection
- Rollback TTL expiration
- Rollback ledger capacity enforcement (reject, not evict)
- Sender validation for all three B1 handlers
- Process selection registry (create, resolve, expire, same-window enforcement)
- Freeze concurrency limits (per-process, global, duplicate address)
- Session cleanup on destroy/navigate
- Feature flag disablement stops freeze
- Maximum duration auto-stop