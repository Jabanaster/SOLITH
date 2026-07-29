# Batch B1 — Finding Revalidation

> **CORRECTION NOTICE (2026-07-27):** This document's file:line citations,
> exploit-precondition analysis, and description of the code changes made
> remain accurate and are NOT rewritten here. However, its **verdict
> language** ("FIXED" for freeze-start's bound/cleanup work, and its framing
> of `userSelectedProcess: true` as an "honest confirmation flag") overstated
> what was actually closed. See
> `Docs/Security/Evidence/BatchB1/finding-revalidation-v2.md` for the
> corrected disposition — in particular, freeze-start's per-operation
> consent gap (documented below as "deferred") is now treated as a genuine
> blocking gap, not a nice-to-have deferral, and the registry-verification
> trust model is now described as a self-attestation rather than an
> "honest" proof of user action. The overall verdict is
> **BATCH B1 CONDITIONAL PASS**, not PASS.

Scope: `live-memory-rollback`, `live-memory-freeze-start`, `registry-run-readonly-verification` only.
Date: 2026-07-26

For each handler this document records: registration site, preload method, renderer callers, input schema, manual validation, sender validation, authorization, consent requirements, privileged effect, existing tests, confirmed missing control, realistic exploit preconditions, impact, and the fix applied.

---

## Target 1 — `live-memory-rollback`

- **Registration**: `electron/live-memory-ipc.ts:441` (`ipcMain.handle('live-memory-rollback', ...)`)
- **Preload method**: `liveMemoryRollback` (`electron/preload.ts:101`)
- **Renderer callers**: none found in `src/app` (confirmed by Batch A `ipc-renderer-callers.csv` and re-checked this session). The contract change below is therefore zero-risk to any live UI flow.
- **Input schema (before)**: `LiveMemoryRollbackSchema` accepted a full `{ manifest: { proposalId, target: { address, dataType }, valueBefore, valueAfter, appliedAt } }` object supplied entirely by the caller.
- **Manual validation (before)**: none beyond the schema shape — `target.address`/`dataType`/`valueBefore` were never cross-checked against anything the session actually did.
- **Sender validation**: `requireBundle(event)` throws `sender_invalid` if `event.sender.isDestroyed()`, and requires an attached session bound to `event.sender.id`.
- **Authorization (before)**: attached-session ownership only (`requireBundle`). No check that the specific write being "rolled back" ever happened.
- **Consent requirements (before)**: none — unlike `live-memory-confirm-write`, rollback required no `consentToken`.
- **Privileged effect**: writes directly to the attached process's memory (`driver.writeMemory`) at `manifest.target.address` with `manifest.valueBefore`.
- **Existing tests (before)**: `tests/live-memory/live-memory-session.test.ts` had one happy-path test (`rollback restores the value...`) that only ever exercised the legitimate propose→confirm→rollback sequence — no negative/adversarial cases existed.

### Confirmed missing control

**CONFIRMED.** `MemoryManager.rollback()` → `LiveMemorySession.rollback(manifest)` executed `driver.writeMemory(handle, manifest.target.address, manifest.target.dataType, manifest.valueBefore)` using a manifest object taken **verbatim from the IPC payload**. There was no server-side record of what this session had actually written, so any value accepted by the schema (a syntactically valid hex address, a valid `LiveValueType`, a finite number) was written to the attached process, regardless of whether a matching write had ever been confirmed. Process identity re-verification (`verifyAttachedProcessIdentity()`) was already present and correctly blocked PID-reuse/process-restart/different-executable scenarios — that part of the original design was sound.

### Realistic exploit preconditions

- A renderer already has an active `live-memory` session (feature flag `v2LiveModeEnabled` on, `userConfirmedOffline: true` waiver already given, attach already succeeded) — i.e. this required the same preconditions as any other live-memory write, so it did **not** grant a new capability to attach; it granted an **unconsented write** once already attached, bypassing the propose/issue-consent/confirm-write gate that every other write path enforces.
- Concretely: a compromised/malicious renderer-side script (supply-chain compromise of a bundled dependency, or any future XSS-class bug) with an already-attached session could call `live-memory-rollback` directly with a forged `manifest` to write an arbitrary value to an arbitrary address in the target process, without ever triggering the native OS consent dialog that `live-memory-confirm-write` requires.

### Impact

High — full arbitrary-address/arbitrary-value write into the attached process's memory, completely bypassing the write-consent architecture, reachable by anything able to call IPC with an active session (not just the legitimate user via the intended UI, which never called this channel).

### Fix applied

- `LiveMemorySession` now keeps a `confirmedWrites: Map<proposalId, LiveWriteManifest>`, populated **only** inside `confirmWrite()` right after a write is actually performed (bounded to 50 entries, FIFO eviction).
- `LiveMemorySession.rollback()` now takes **only** a `proposalId`. It looks up the manifest from `confirmedWrites` — never from the caller — and returns `Unknown or already rolled back write.` if it isn't present. On success the entry is deleted (single-use; a rollback cannot be replayed). All existing checks (write-consent guard, `verifyAttachedProcessIdentity()`) are unchanged and still run before the write.
- `MemoryManager.rollback(proposalId, featureId?)` and the `live-memory-rollback` IPC handler were updated to match; the manifest returned to the caller is still serialized (address as string) via the existing `serializeWriteResult` helper.
- `LiveMemoryRollbackSchema` (electron/ipc-validation.ts) now accepts only `{ proposalId: string }` (`.strict()`), so a full-manifest payload is rejected by validation before it ever reaches the handler.
- `confirmedWrites` is cleared on `detach()`, so a re-attached session cannot roll back a previous session's write.

**Verdict: FIXED.**

---

## Target 2 — `live-memory-freeze-start`

- **Registration**: `electron/live-memory-ipc.ts:639` (originally; line numbers shift slightly after edits — see `electron/live-memory-ipc.ts` `ipcMain.handle('live-memory-freeze-start', ...)`)
- **Preload method**: `liveMemoryFreezeStart` (`electron/preload.ts`)
- **Renderer callers**: used from the live trainer UI (Watch/Freeze controls) — confirmed reachable, unlike rollback.
- **Input schema**: `LiveMemoryFreezeStartSchema` — `address` (bounded hex/decimal string), `dataType` (enum), `value: z.number().finite()`, `intervalMs: z.number().int().min(50).max(5000).optional()`. This was already reasonably tight.
- **Manual validation (before)**: none beyond the schema at the session level — `LiveMemorySession.startFreeze()` did not itself validate `value`/`intervalMs`, relying entirely on the IPC schema.
- **Sender validation**: `requireSession(event)` → `requireBundle(event)`, same as rollback.
- **Authorization**: attached-session ownership only. No per-operation consent token (unlike `live-memory-confirm-write`).
- **Consent requirements**: session-level only — `userConfirmedOffline` waiver at attach time, plus a per-tick `evaluateWriteConsent` (online-guard) re-check. No fresh, operation-bound consent token is required to *start* a freeze.
- **Privileged effect**: repeatedly writes a fixed value to a fixed address in the attached process on an interval, indefinitely, until stopped.
- **Existing tests (before)**: solid coverage of the happy path, concurrency guard (one freeze per session), consent/identity stop conditions mid-freeze, and detach cleanup — see `tests/live-memory/live-memory-session.test.ts` "LiveMemorySession freeze" suite. Missing: interval/value bound enforcement at the session level, any duration cap, and renderer-window-close cleanup.

### Confirmed missing controls

1. **CONFIRMED — no session-level bound enforcement.** `startFreeze(address, value, intervalMs)` trusted its caller entirely; a direct/library caller (not just IPC) could pass `intervalMs = 1` or `value = NaN`. The IPC schema caught this for real IPC traffic, but the brief explicitly requires "Do not rely solely on renderer validation" — the session itself now enforces the same bounds.
2. **CONFIRMED — no maximum freeze duration.** A freeze ran forever once started; nothing capped total run time. Low likelihood of exploitation (this is the intended UX for "Infinite Health" style toggles), but a legitimate defense-in-depth gap against a forgotten/orphaned freeze.
3. **CONFIRMED — no cleanup on renderer window close.** `disposeSession()` (which calls `session.detach()`, which stops any active freeze) was only ever invoked from explicit `live-memory-detach`/re-attach code paths. If the owning `BrowserWindow`/`WebContents` was destroyed without the renderer calling `live-memory-detach` first (e.g. the window is closed while the app itself keeps running, which happens on macOS where `window-all-closed` does not quit the app, or if a future multi-window layout closes a secondary window that owned a session), the freeze timer would keep firing in the main process indefinitely with no way for the user to stop it. Matches the required test case "Freeze persistence after renderer close" exactly.
4. **NOT CONFIRMED as a live gap — per-operation consent token for freeze.** Freeze-start does not require a fresh `consentToken` the way `live-memory-confirm-write` does. This is a real architectural inconsistency (already flagged as Batch A Finding C) but is **deferred**, not fixed, in this batch: closing it properly would require adding a propose/issue-consent step for freeze (new IPC surface), which falls outside "harden only: live-memory-rollback, live-memory-freeze-start, registry-run-readonly-verification" and "do not change unrelated IPC contracts" — extending the *existing* freeze-start contract with bounds/cleanup is in scope; adding a brand-new consent-issuance channel is not. Recommended as a distinct Batch B2 item.

### Realistic exploit preconditions

Same as rollback (attached session required). The interval/value bound bypass required a non-IPC caller (direct session API misuse, e.g. from a test or future internal caller) since the IPC schema already enforced bounds for real renderer traffic — this was defense-in-depth, not an active IPC-reachable vulnerability. The renderer-close persistence gap is reachable by an ordinary user simply closing the main window on macOS, or in any future multi-window layout — no adversarial input required.

### Impact

Medium. The interval/duration gaps are hardening rather than active vulnerabilities (the IPC schema already gated the realistic attack surface). The renderer-close persistence gap is a genuine "forgotten background write loop" risk — the freeze would keep silently modifying the target process's memory with no visible UI and no way to stop it short of killing Solith's main process.

### Fix applied

- `LiveMemorySession.startFreeze()` now validates `value` (`Number.isFinite`) and `intervalMs` (integer, 50–5000ms) itself, independent of the IPC schema.
- Added a hard 6-hour `MAX_FREEZE_DURATION_MS` ceiling (overridable only via a test-only seam, `_setMaxFreezeDurationMsForTests`, not exposed to IPC/renderer). The tick loop now stops with a new `FreezeStopReason` value, `'max_duration_exceeded'`, instead of scheduling indefinitely.
- Added `src/core/live-memory/session-cleanup.ts` (`wireSessionCleanupOnDestroy`), wired into `bindSessionBundle()` in `electron/live-memory-ipc.ts` for both attach paths. Every successful attach now registers a one-time `webContents.on('destroyed', ...)` listener that calls the same `disposeSession()` used by explicit detach — guaranteeing an active freeze (and the whole session) is torn down the moment the owning window is destroyed, regardless of whether the renderer called `live-memory-detach` first.
- Existing per-tick identity/consent re-checks, the one-freeze-per-session concurrency guard, and `detach()`-triggered cleanup were already sufficient and are unchanged.

**Verdict: FIXED** (bounds, duration cap, renderer-close cleanup). **DEFERRED** (documented, not implemented): per-operation consent token for freeze-start — recommended for a future batch, out of scope here per the explicit 3-handler restriction.

---

## Target 3 — `registry-run-readonly-verification`

- **Registration**: `electron/registry-verification-ipc.ts` (`ipcMain.handle('registry-run-readonly-verification', ...)`)
- **Preload method**: `registryRunReadOnlyVerification` (`electron/preload.ts`)
- **Renderer callers**: **`src/app/pages/RegistryExplorerPage.tsx`** — Batch A's automated renderer-mapping missed this call site (the file was mid-edit/uncommitted at the time of the Batch A audit). This session found and confirmed it via `tsc` (the added required schema field surfaced a real, compiling call site). This is a correction to Batch A evidence, not a new finding.
- **What "registry" means here (established this session)**: a compiled Cheat Engine table artifact (pointers/scripts/AOB signatures) validated by `validateLoadedRegistry()` — **not** the Windows Registry. No `HKEY_*`/`reg.exe`/WMI-registry call exists anywhere in this file or its dependency chain. This matches Batch A's `registry-operations-audit.txt` finding and is reconfirmed here by re-reading the full call chain (`headless-verification.ts` → `windows-readonly-process-module-reader.ts`).
- **Process execution model**: spawns a `node:worker_threads.Worker` (an in-process V8 isolate), **not** a `child_process`/shell command. No executable is launched, no shell is invoked, no argv/env injection surface exists. Most of the "if it launches an external command" checklist in the assignment does not apply — documented explicitly rather than skipped silently.
- **Input schema (before)**: `RunVerificationSchema` (`registry`, `pid`, `executableName`, `executablePath?`, `timeoutMs` bounded 1s–120s). No confirmation-of-selection field.
- **Manual validation**: `validateLoadedRegistry(parsed.registry)` performs deep structural validation of the registry artifact before use.
- **Sender validation (before)**: **none** — the handler's first parameter was `_event` (explicitly unused). No `event.sender.isDestroyed()` check existed anywhere in this file, unlike every other IPC handler audited in Batch A.
- **Authorization (before)**: **none** — no feature-flag gate of any kind. Every other handler that opens a process and reads its memory (`live-memory-attach`, `live-memory-read`, etc.) is gated behind `v2LiveModeEnabled`; this handler was not.
- **Consent requirements (before)**: the underlying `RuntimeProcessSummary.selectedByUser` flag (checked by `assertExplicitProcessSelection()` deep in `windows-readonly-process-module-reader.ts`) exists specifically to assert "a human explicitly picked this exact process" — but the IPC handler hardcoded `selectedByUser: true` **regardless of what the renderer actually sent**, so the check always passed and asserted nothing.
- **Privileged effect**: opens an arbitrary caller-supplied PID (`openProcess`), enumerates its loaded modules, and reads up to 1MB per module-read call (`DEFAULT_MAX_READ_BYTES`) from its memory. Confirmed **read-only**: no `writeMemory`/`writeBuffer` call is reachable anywhere in this code path (verified by reading `WindowsReadOnlyProcessModuleSession` in full — it implements no write method at all).
- **Existing tests (before)**: `tests/headless-verification.test.ts` and `tests/windows-readonly-adapter.test.ts` test the underlying core logic thoroughly (including `rejects non-explicit process selection`), but nothing tested the `electron/registry-verification-ipc.ts` IPC boundary itself — the hardcoded `selectedByUser: true` bypass was invisible to those tests because they call the core functions directly with real input.

### Confirmed missing controls

1. **CONFIRMED — no sender validation.** Trivial fix, matches the pattern used by every other handler in the codebase.
2. **CONFIRMED — no feature-flag gate.** This handler performs the same category of privileged operation (open an arbitrary PID, read its memory) that `live-memory-*` gates behind `v2LiveModeEnabled`, but was reachable unconditionally.
3. **CONFIRMED — dishonest `selectedByUser`.** The explicit-selection safety check existed in the core library specifically to prevent unattended/automated process selection, but the IPC layer defeated it by always asserting `true`.
4. **NOT a registry-mutation risk** — re-verified: "read-only" is enforced by the actual driver surface, not just the handler name. No fix needed here; this Batch A finding is **downgraded from a suspected gap to confirmed-already-safe**.

### Realistic exploit preconditions

Before this fix: **any** IPC-capable content in the renderer — with **no feature flag, no session, no prior attach, no user interaction** — could invoke this channel with an arbitrary PID and executable name guess, and (if the guess matched a running process) read up to 1MB of its module memory, completely independent of whether the user had ever engaged with any live-memory feature. This was the least-gated privileged handler found across the entire Batch A audit.

### Impact

Medium-high. Read-only, and bounded per the driver's existing 1MB cap and `assessProtectedTarget` block-list, so it could not corrupt state or execute code — but it was an unauthenticated, ungated arbitrary-process memory-read primitive, which is a real information-disclosure surface with none of the gating every comparable handler has.

### Fix applied

- Added `event.sender.isDestroyed()` sender validation, matching the codebase-wide pattern.
- Gated the handler behind `isTrainerCapabilityEnabled('v2LiveModeEnabled')` — the same flag `live-memory-*` uses. This flag defaults to `true` post-`unlockTrainerCapabilities()` (called once at app startup) unless the user has explicitly disabled it, so this introduces no functional regression for `RegistryExplorerPage.tsx`'s existing UI flow under default settings.
- `RunVerificationSchema` moved to `electron/ipc-validation.ts` as `RegistryRunVerificationSchema` (for consistency with every other schema in the codebase, and so it is independently unit-testable without importing Electron) and extended with a required `userSelectedProcess: z.literal(true)` field. The handler now passes `parsed.userSelectedProcess` through to the worker instead of a hardcoded `true`.
- Updated `RegistryExplorerPage.tsx`'s call site to send `userSelectedProcess: true` — accurate, since that page already requires the user to manually type/confirm a PID and executable name before the button that triggers this call is enabled.
- Updated `preload.ts` and `global.d.ts` type declarations to require the new field.

**Verdict: FIXED** (sender validation, feature-flag gate, honest selection flag). **CONFIRMED SAFE, NO CHANGE NEEDED**: read-only enforcement, worker-thread isolation (no shell/exec surface), output size cap, timeout + exit-code handling, error sanitization.
