# Production Freeze Authorization Protocol (Gate 2.3, Final)

## Step 1 — Propose (`live-memory-freeze-propose`, unchanged this cycle)

Renderer sends `{address, dataType, value, intervalMs?}` via
`electronAPI.liveMemoryFreezePropose(...)`. Main process
(`electron/live-memory-ipc.ts`):
- `requireTrustedSender` — sender must be a registered, main-frame, allowed-URL Solith window.
- `requireBundle` — sender must own an attached session.
- Feature flag (`v2LiveModeEnabled`) re-checked.
- `LiveMemoryFreezeProposeSchema.parse` validates address/dataType/value/interval.
- `LiveMemorySession.proposeFreeze` creates a server-generated `proposalId` bound to the session (owner is implicit via `sessions.get(event.sender.id)`).
- Returns only `{proposalId, target, value, intervalMs}` (address serialized as decimal string).

## Step 2 — Request consent (`live-memory-freeze-issue-consent`, unchanged this cycle)

Renderer sends `{proposalId}` via `electronAPI.liveMemoryFreezeRequestConsent(...)`.
Main process:
- `requireTrustedSender`, `requireBundle` re-checked.
- Feature flag re-checked.
- `verifyAttachedProcessIdentity` re-validates identity has not drifted.
- `getPendingFreezeProposal(proposalId)` — unknown/expired/wrong-owner proposal rejected (proposals are session-scoped via the `sessions` map keyed by `event.sender.id`, so a proposal from a different sender is simply not found).
- Shows the real `requestPrivilegedWriteConsent` dialog (auto-approved only via the pre-existing `SOLITH_PRIVILEGED_CONSENT=auto-approve` test/headless seam — unchanged, not a new bypass).
- On approval, issues a real, operation-bound, single-use, short-lived consent token via the existing write-consent store, bound to `{operation: 'live_memory_freeze_start', sessionKey, proposalId, address, dataType, freezeValue, freezeIntervalMs, freezeMaxDurationMs, windowId}`.
- Returns only `{consent: {tokenId, expiresAt, bindingHash}}` to the owning renderer.

## Step 3 — Confirmed start (`live-memory-freeze-start`, unchanged this cycle)

Renderer sends `{proposalId, consentToken}` via
`electronAPI.liveMemoryFreezeStart(...)` — **this is the payload shape that
was broken; preload/renderer now send this correctly.**
Main process:
- `requireTrustedSender`, `requireBundle`, feature flag, identity re-verified.
- `getPendingFreezeProposal(proposalId)` — must still exist and be unconsumed.
- `MemoryManager.freezeStart(proposalId, {consentToken, consentBinding})` — internally consumes the write-consent token (single-use) and validates the binding matches the proposal exactly before invoking the real freeze scheduler.
- Returns a sanitized `{success, error?}`.

## Step 4 — Lifecycle cleanup (unchanged this cycle)

Unchanged from the existing `cleanup-coordinator.ts` design (see
Docs/Security/Evidence/BatchB1_1_Closeout/Lifecycle/cleanup-design.md):
render-process-gone/will-quit/feature-disable/navigation all revoke pending
proposals, consent tokens, and running freeze schedulers for the affected
owner. Verified for real, through the repaired renderer-facing flow, in
packaged-production-flow-lifecycle-matrix.csv.

## What changed this cycle vs. what did not

Only the **preload** (`electron/preload.ts`) and **renderer**
(`src/app/pages/LiveMemoryTrainerPage.tsx`,
`src/app/hooks/useGameCheatSession.ts`) layers changed. The IPC handlers,
`LiveMemorySession`, `MemoryManager`, consent store, and cleanup coordinator
were already correct and were not modified.
