# B2A Freeze Consent and Renderer-Lifecycle Discovery

## Current authorization path

Freeze IPC is exposed as `live-memory-freeze-start`, `live-memory-freeze-stop`, and
`live-memory-freeze-status` in `electron/preload.ts:181-184` and handled in
`electron/live-memory-ipc.ts:542-576`. The start payload contains only address,
data type, value, and optional interval. The main process resolves the session
from `event.sender.id`, validates attachment, and calls
`LiveMemorySession.startFreeze()`.

`src/core/live-memory/live-memory-session.ts:582-643` performs the repeated
`MemoryDriver.writeMemory()` operation. Each tick rechecks
`evaluateWriteConsent()` and attached-process executable identity. The existing
consent API (`src/core/live-memory/write-consent.ts`) is a boolean
single-player/private-play waiver; network observations are advisory and never
block after the waiver.

There is no server-authoritative freeze-start approval token, no operation-bound
single-use token, and no expiry enforcement. The existing UUID write proposals
are for the separate propose/confirm write path and are not used by FREEZE.

Phase 1 chooses opaque, server-stored approval state rather than HMAC tokens:
the main process owns the record and token lookup, so there is no secret
distribution or token payload integrity problem to solve. The token is still
single-use because the store removes it before validating the requested binding.

## Current lifecycle path

Live-memory sessions are stored in `electron/live-memory-ipc.ts:328-405` by
renderer `webContents.id`. Explicit detach, replacement attach, and failed
zero-input preparation call `session.detach()`, which stops an active freeze.

The existing generic V2 lifecycle wiring in
`src/core/v2/lifecycle-wiring.ts:115-206` handles `closed`,
`webContents.destroyed`, and app `before-quit`, but it owns only the V2 session
monitor. It is not connected to live-memory session disposal or FREEZE.

## Bypass and orphan scenarios

1. **Freeze start with no consent at all:** the current freeze start IPC accepts
   the operation payload directly. It relies on the attach-time waiver stored in
   the session and has no per-operation approval.
2. **Renderer reload orphan:** the sender-owned main-process session remains in
   the map after renderer reload; its timer can continue writing.
3. **Renderer crash orphan:** `render-process-gone` currently writes a crash log
   only; it does not dispose the live-memory session.
4. **Window close orphan:** `BrowserWindow.closed` clears `mainWindow` and stops
   the V2 monitor, but does not stop live-memory FREEZE.
5. **App quit orphan:** existing `will-quit` handlers stop unrelated services,
   but do not call live-memory `disposeSession()` or stop freezes.
6. **New renderer attaching while old freeze runs:** ownership is keyed by
   sender ID, so a new renderer can establish a separate session while the old
   sender's freeze remains active.
7. **Unbounded duration:** no `21600`, six-hour, or `MAX_FREEZE` cap currently
   exists. FREEZE runs until explicit stop, detach, guard failure, identity
   mismatch, or write failure.

## Bounded design

Phase 1 introduces:

- `freeze-consent.ts`: a main-process approval store with exact operation
  bindings, short configurable TTL, injected confirmation provider, opaque
  32-byte tokens, atomic consume-before-validation, replay detection, and
  redacted rendering.
- `freeze-session-registry.ts`: server-authoritative ownership/state tracking
  with renderer ownership, frame identity, PID, approval token, expiry,
  validated transitions, injected cleanup, idempotent stop, stop-by-renderer,
  stop-all, cleanup failure, and audit sink events.
- A six-hour core maximum (`MAX_FREEZE_DURATION_MS`) enforced server-side via
  the existing scheduler abstraction.

IPC wiring, native confirmation-dialog integration, and MemoryAuditLog wiring
are intentionally deferred to Phase 2.

## Expected changed files

- `Docs/Security/B2A/freeze-consent-lifecycle-discovery.md`
- `src/core/live-memory/freeze-consent.ts`
- `src/core/live-memory/freeze-session-registry.ts`
- `src/core/live-memory/live-memory-session.ts`
- `src/core/live-memory/types.ts`
- `src/core/live-memory/audit-log.ts`
- `src/core/live-memory/index.ts`
- `tests/live-memory/freeze-consent.test.ts`
- `tests/live-memory/freeze-session-registry.test.ts`
- `tests/live-memory/live-memory-session.test.ts`

## Explicitly out of scope

This phase does not change rollback, generalized IPC sender/origin
validation, process selection, UI design, unrelated IPC hardening, or
persistence/database migrations. It does not wire the registry into Electron
IPC yet.

No Batch A or B1 evidence directories exist in this repository. No six-hour
freeze cap existed before this phase.
