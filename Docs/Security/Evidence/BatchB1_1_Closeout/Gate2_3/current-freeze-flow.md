# Current Freeze Flow — As Found (Pre-Gate-2.3)

## Trace

Renderer component (`src/app/pages/LiveMemoryTrainerPage.tsx`, `handleStartFreeze` /
`onFreeze`; `src/app/hooks/useGameCheatSession.ts`, `startFreeze`)
  -> preload (`electron/preload.ts`, `liveMemoryFreezeStart`)
  -> IPC channel `'live-memory-freeze-start'`
  -> handler validation (`electron/live-memory-ipc.ts`)
  -> LiveMemorySession.proposeFreeze / MemoryManager.freezeStart

## What was actually broken

The main-process side (propose/issue-consent/confirm) was **already fully
implemented** in `electron/live-memory-ipc.ts` before Gate 2.3 began — the
`'live-memory-freeze-propose'`, `'live-memory-freeze-issue-consent'`, and
`'live-memory-freeze-start'` IPC handlers already existed, already enforced
`requireTrustedSender`, `requireBundle`, feature-flag re-check, identity
re-verification, and a real `requestPrivilegedWriteConsent` dialog, and the
`'live-memory-freeze-start'` handler already required
`LiveMemoryFreezeConfirmSchema` (`{proposalId, consentToken}`, `.strict()`).

The break was entirely in the **preload/renderer layer**:

- `electron/preload.ts`'s `liveMemoryFreezeStart` exposed the legacy
  pre-Batch-B1.1 signature `{address, dataType, value, intervalMs}` and
  invoked the same `'live-memory-freeze-start'` channel directly — every call
  failed Zod's `.strict()` parse and returned `freeze_start_failed`.
- No `liveMemoryFreezePropose` / `liveMemoryFreezeRequestConsent` preload
  methods were exposed at all, so the renderer had no way to reach the
  already-built propose/issue-consent handlers.
- 3 renderer call sites (`LiveMemoryTrainerPage.tsx` x2, `useGameCheatSession.ts`
  x1) all called the broken legacy `liveMemoryFreezeStart` signature.

Net effect: **no real end-user freeze could ever be started** through the
shipped app, even though the main-process authorization pipeline was already
correct and complete. Gate 2.2 Resume worked around this with a test-only
`__testStartFreezeForOwner` hook that called the same underlying session/
manager functions directly from `globalThis`, which proved lifecycle behavior
*after* a freeze existed but did not exercise the real renderer/preload/IPC
path at all.

## Findings against the Phase 2 checklist

- Where the legacy payload is constructed: `electron/preload.ts:186-187` (removed this cycle).
- Which preload signature exposed it: `liveMemoryFreezeStart` (fixed this cycle).
- What the current IPC handler requires: `LiveMemoryFreezeConfirmSchema` — `{proposalId, consentToken}` (unchanged; already correct).
- Whether propose/issue-consent handlers were already exposed through preload: **no** (added this cycle).
- Whether any renderer call site used them: **no** (all 3 call sites used the broken legacy shape; fixed this cycle).
- Whether the consent dialog was reachable from this workflow: **no** (unreachable — there was no path to `'live-memory-freeze-issue-consent'` from preload).
- Whether response schemas aligned: **no** (renderer payload shape mismatched the handler's Zod schema).
- Whether cancellation/expiration were represented: yes, already, at the main-process layer (consent tokens are short-lived, single-use, revocable) — unaffected by this gap.
- Whether owner/window identity was preserved end to end: yes at the main-process layer (`event.sender.id`, `requireTrustedSender`) — unaffected; the gap was purely that the renderer could never reach that layer with a valid payload.
