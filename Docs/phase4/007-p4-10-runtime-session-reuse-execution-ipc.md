# P4-10 — Runtime Session Reuse + Execution IPC Cutover

## 1. Scope

Closes the two remaining P4-9 gates:

1. canonical `TrainerRuntime` consumed by execution IPC
2. canonical `CompositeTransactionRuntime` consumed by IPC

Both were blocked on the same root cause, stated verbatim in P4-9's own doc comment
(`src/core/trainer-application/service.ts`, pre-P4-10): *"Wiring live single-action
write/freeze/rollback execution through TrainerRuntime requires reusing the SAME
already-attached LiveMemorySession a game session is bound to... rather than calling
TrainerRuntime.bind(), which performs its own attach()."*

## 2. Baseline

Branch `feature/solith-phase4-trainer-model`, worktree
`G:\ACTIVE_PROJECTS\solith-phase4-trainer-model`. Start SHA == `origin/master` ==
`82b7772b7f6d04434664d6ada924adfd4ff352aa` (the P4-4 merge). `git fetch` +
`git log HEAD..origin/master` + `git diff --name-status HEAD...origin/master` all
empty throughout — zero drift, no Phase 2/Phase 4 collision at any point.

## 3. Lifecycle audit (before)

- `live-memory-attach` (`electron/live-memory-ipc.ts`) is the single real attach
  path: sender trust → feature flag → schema → `LiveMemorySession.attach()`, which
  itself runs target authorization (`assessTargetProcessAuthorization`), consent
  (`evaluateWriteConsent`), executable fingerprint
  (`verifyDefinitionFingerprint`/`fingerprintBlocksAttach`), protected-target
  (`assessProtectedTarget`, needs an open handle — bind-time only), and a live OS
  identity re-verification against the claimed target.
- The resulting session lives in `electron/live-memory-ipc.ts`'s module-level
  `sessions: Map<number, SessionBundle>`, keyed by **webContents sender id** — one
  bundle per renderer window, already "one authoritative session per execution
  context" by construction.
- `TrainerRuntime.bind()` (`src/core/trainer-runtime/runtime.ts`) built its own
  `LiveProcessTarget` and called `capabilities.attach(...)` — i.e. `session.attach()`
  again. Since `LiveMemorySession.attach()` fails closed with `already_attached`
  when `isAttached()` is already true, calling `bind()` against an already-attached
  session never silently double-opened a handle — it just **failed outright**,
  which is the P4-9 blocker in concrete terms.
- `LiveMemoryCapabilities` (`capabilities.ts`) already took `(session, manager)` via
  constructor — it never created them. This is the seam P4-10 uses: nothing about
  the capability boundary itself needed to change to support reuse.
- `TrainerRuntime.dispose()` always called `capabilities.detach()` unconditionally
  — no ownership concept existed, so *any* runtime disposal destroyed the
  underlying session, which is exactly wrong for a borrowed one.
- `trainerApplicationService` (P4-9) had zero runtime-execution methods — pure
  definition CRUD, with the blocker documented in its own comment (quoted above).
- No canonical trainer-execution IPC channels existed at all. Trainer-host
  (file-based save-field writes) and `live-memory-*` (raw-address process-memory
  writes) were the only two execution backends; neither is trainerId/featureId-
  keyed.
- `CompositeTransactionRuntime` (P4-7) was already fully complete
  (`prepareTransaction`/`executeTransaction`/`cancelTransaction`/
  `getTransactionState`) but unreachable from any IPC surface — nothing to fix
  there beyond wiring, confirmed by re-reading `transaction.ts` in full.

## 4. Session ownership model

**Option A — runtime binds an existing authoritative session** (mission §4),
chosen because it required no new registry (the per-sender `sessions` Map already
*is* the single-session-per-context authority) and no change to
`LiveMemoryCapabilities`'s existing constructor contract.

`SessionOwnership = 'OWNED' | 'BORROWED'` (new: `src/core/trainer-runtime/ownership.ts`).
Set explicitly, never implicit:

- `TrainerRuntime.bind()` → sets `OWNED` (unchanged behavior otherwise — attaches
  its own session, e.g. for any future caller with no existing session to borrow).
- `TrainerRuntime.bindExisting()` (new) → sets `BORROWED`.
- `dispose()`: `OWNED` → `capabilities.detach()` (destroys the session, as before).
  `BORROWED` → `capabilities.stopFreeze()` only (stops a freeze *this* runtime
  instance started, so nothing is orphaned) and never touches the session's
  attach state.

## 5. `bindExisting()` — the reuse mechanism

```
COMPATIBILITY_CHECKED -> BOUND -> READY   (no attach() call)
```

Preconditions, all fail-closed:

1. `capabilities.isAttached()` must already be true (`CAPABILITY_UNAVAILABLE`
   otherwise).
2. `capabilities.verifyIdentity()` must return `null` — a **fresh** re-read of the
   live process (PID/exe/start-time consistency), not cached data
   (`PROCESS_LOST` otherwise).
3. `capabilities.getAttachedIdentity()` (new capability method, mirrors
   `LiveMemorySession.getAttachedIdentity()`) must match the caller's claimed
   `{pid, executableName}` (`AUTHORIZATION_FAILED` otherwise) — a defense-in-depth
   coherence check, not the primary gate (see §6).

Gate provenance (mission §8 "must not skip these"):

| Gate | How it's preserved on a borrowed bind |
|---|---|
| Target authorization | Re-run by `checkCompatibility()` — same `PreBindCompatibilityInput` → `checkPreBindCompatibility()` → `assessTargetProcessAuthorization` code path `bind()` uses, fed from the borrowed session's own identity instead of a fresh picker selection. Required precondition state (`COMPATIBILITY_CHECKED`) for `bindExisting()` too — no way to skip it. |
| Executable fingerprint | Same `checkCompatibility()` call also runs `verifyDefinitionFingerprint`/`fingerprintBlocksAttach` — identical code path, no duplication. |
| Protected-target (module scan) | **Preserved by construction, not re-executed.** This check is inherently bind-time-only (documented in `compatibility.ts` itself — it needs an open handle's module list, which only exists at real `attach()` time). A borrowed session already passed it once, at its own original `attach()`. `verifyIdentity()` proves the live process is still the exact `(pid, exe, path, startTime)` tuple that passed it then — the same "RESOLVED-BY-CONSTRUCTION" reasoning pattern P4-4 used for hotkey identity, applied here and disclosed the same way. |
| Consent | Untouched — write/freeze confirmation still requires a real, session-issued consent token (§8 below); nothing about borrowing grants standing permission. |
| Stale PID | `verifyIdentity()` fails closed on PID/exe/start-time mismatch; the identity cross-check adds a second, independent layer. |

## 6. Execution IPC

New module `electron/trainer-execution-ipc.ts`, registered from `electron/main.ts`
alongside `registerLiveMemoryIpc()`. Reuses the existing per-sender session via a
new, minimal export from `live-memory-ipc.ts`:

```ts
export function requireAuthorizedSessionForExecution(event): { session, manager }
```

— a thin wrapper around the existing `requireBundle()`, adding **no new gate and no
new registry**.

Per-session execution state (`TrainerRuntime` + `CompositeTransactionRuntime`) is
cached in a `WeakMap<LiveMemorySession, ExecutionEntry>`, keyed by **session object
identity**, not sender id. A fresh `live-memory-attach` always constructs a brand
new `LiveMemorySession` instance (confirmed in `live-memory-ipc.ts`'s
`bindSessionBundle`) — so a disposed-and-reattached session naturally misses the
cache. No stale runtime can survive a reattach (mission §22), and no explicit
disposal-listener wiring was needed to guarantee it.

Channels (all keyed by trainerId/featureId/transactionId, never a raw address —
mission §17):

`trainer-bind-runtime`, `trainer-unbind-runtime`, `trainer-get-runtime-state`,
`trainer-propose-write-feature`, `trainer-issue-write-consent`,
`trainer-confirm-write-feature`, `trainer-propose-freeze-feature`,
`trainer-issue-freeze-consent`, `trainer-confirm-freeze-feature`,
`trainer-deactivate-feature`, `trainer-rollback-feature`,
`trainer-execute-composite`, `trainer-cancel-composite`,
`trainer-get-transaction-state`.

`trainer-bind-runtime` sources `{pid, executableName}` from the **already-attached
session's own identity** (`session.getAttachedIdentity()`), not blindly from the
renderer payload — the payload's `pid`/`executableName` are cross-checked against
it and rejected on mismatch, catching a desynced renderer early rather than
silently binding to "whatever is actually attached."

## 7. Consent — why write/freeze are propose/confirm pairs now

`TrainerRuntime.activateWriteFeature()`/`activateFreezeFeature()` (P4-5) resolve +
propose + confirm **atomically in one call**, generating their own internal
proposalId. The real consent-token model
(`src/core/consent/write-consent.ts`) requires a token be issued against a known
proposalId/address/value **before** confirm — exactly the shape
`electron/live-memory-ipc.ts` already uses for raw-address writes
(propose → issue-consent → confirm). There is no seam in the monolithic methods to
inject a pre-issued token, and using the `{kind:'approved'}` legacy bypass for real
IPC writes would have weakened consent (forbidden by mission §16).

Fix: split the write and freeze dispatch into propose/confirm halves in
`src/core/trainer-runtime/action-executor.ts` (`proposeWriteAction`/
`confirmWriteAction`, `proposeFreezeAction`/`confirmFreezeAction`) and
`TrainerRuntime` (`proposeWriteFeature`/`confirmWriteFeature`,
`proposeFreezeFeature`/`confirmFreezeFeature`) — **additive**, the original
monolithic `activateWriteFeature`/`activateFreezeFeature` are unchanged and still
used by composite-transaction dispatch and the existing P4-5/P4-7 test suites.

`electron/trainer-execution-ipc.ts`'s issue-consent handlers reuse
`session.getPendingWriteProposal()`/`getPendingFreezeProposal()` — the exact same
session-level lookup `live-memory-issue-write-consent`/`live-memory-freeze-issue-consent`
already use — and the exact same `requestPrivilegedWriteConsent`/
`formatMemoryWriteConsentLines`/`formatFreezeConsentLines` dialog machinery, with
two new operation literals added to the (previously closed) `ConsentOperation`
union: `trainer_confirm_write_feature`, `trainer_confirm_freeze_feature`. No
existing operation's hash changed.

Composite-transaction actions (`trainer-execute-composite`) each carry their own
already-obtained `proposalId`+`consentToken`, cross-checked against the feature's
actual pending proposal before the token is trusted — no transaction-wide consent
bypass exists.

## 8. Process-loss coherence (new fix)

Before P4-10, only `CompositeTransactionRuntime`'s `finalize()` degraded the
runtime on a `PROCESS_LOST` failure (`degradeRuntime()`). A **single-action**
write/freeze/rollback failing with `PROCESS_LOST` (e.g. `confirmWrite`'s own
identity re-verification failing) returned the error but left the runtime
reporting READY/ACTIVE — a real, previously-existing coherence gap, not
introduced by this mission but closed by it, matching mission §12's explicit
prohibition on `Live session = detached / TrainerRuntime = ACTIVE`.

Fix: `TrainerRuntime.degradeOnProcessLoss()` (new, private) is called from
`activateWriteFeature`/`activateFreezeFeature`/`rollbackFeature`/
`confirmWriteFeature`/`confirmFreezeFeature` on any `PROCESS_LOST`-reasoned
failure — applying the *already-existing* `handleProcessLoss()` exception
mechanism (which stops freeze + invalidates all feature resolution/activation
state + transitions to `DEGRADED`) to code paths that previously never invoked
it. `handleProcessLoss()` gained an optional `errorOverride` parameter so the
original, specific error is preserved as `lastFailure` rather than replaced with
handleProcessLoss's generic default message.

## 9. Reattach

`recheckCompatibilityAfterLoss()` (pre-existing, P4-5) already transitions
`DEGRADED -> VALIDATED -> COMPATIBILITY_CHECKED` via a fresh `checkCompatibility()`
call. `bindExisting()` from `COMPATIBILITY_CHECKED` after a recheck works exactly
like the first bind — no stale address reuse (features were already invalidated by
`handleProcessLoss`'s `invalidateAllFeatures`, marking resolved addresses `stale`).
`trainer-bind-runtime`'s handler drives this path automatically when it finds a
cached, same-trainer, `DEGRADED` entry.

## 10. Freeze / rollback ownership

Both remain exactly where P4-2/P4-8 always put them:
`LiveMemorySession.freeze`/`freezeScheduler` (one scheduler per session instance,
already guarded — `startFreeze` refuses a second concurrent freeze) and
`LiveMemorySession.confirmedWrites` (the one rollback ledger). A borrowed
`TrainerRuntime` never creates a second scheduler or ledger — it only ever calls
into the same shared `session`/`manager` pair. Proven directly in
`tests/p4-10-runtime-session-reuse.test.ts` (tests 26/27): a freeze started
through one runtime is immediately visible via a second runtime's own
capabilities object wrapping the same session, and a rollback through the
borrowing runtime undoes a write on the same driver-level memory the owning
runtime wrote to.

## 11. Trainer-host / save-field re-audit (mission §24)

Re-audited (not reused from P4-4's own finding, re-verified fresh):
`TrainerControlPanel.tsx`'s write-call-sites all guard on `control.saveField`
presence before dispatching to trainer-host IPC; `saveField` is only ever
populated by `saveFieldToTrainerControl()`, which always sets
`backend: 'save_field'`. A `memory_write`/`memory_observation` control has no
`saveField` and structurally cannot reach trainer-host through this call site.
`solithDefinitionToTrainerControls()` still reads only
`definition.saveEditor?.saveFields`, never `memoryFeatures` — confirmed by a new
regression test using a definition that deliberately declares both a memory
feature and a save field under the same id. **No unsafe dispatch exists** —
trainer-host's file-edit mechanics were left untouched (mission explicitly
permits this: "Execution backend may remain trainer-host. Do not rewrite
file-edit mechanics").

## 12. Recipe follow-up (mission §25)

Re-audited: the runtime/IPC cutover in this mission is specifically about
**process-memory** execution (`TrainerRuntime`/`CompositeTransactionRuntime`).
Recipe/save-edit execution (`create-proposal-for-edit`/`apply-proposal` →
`src/core/saves/editor.ts`) is a structurally different backend (file-based save
editing, not live process memory) with no relationship to session reuse — P4-10's
session-borrowing mechanism has nothing to offer it. The P4-4-built
`Recipe -> SaveFieldFeatureV1` adapter remains unwired to the UI, exactly as
before. This is **not** a gap P4-10 was positioned to close and is explicitly
disclosed rather than forced: a dedicated save-edit convergence stage (distinct
from process-memory runtime reuse) is still required to retire the second write
stack, consistent with the mission's own "do not force a risky rewrite merely to
claim closure" instruction.

## 13. Isolation — Phase 2 research surfaces

`electron/live-memory-ipc.ts` gained exactly one new export
(`requireAuthorizedSessionForExecution`, a 5-line wrapper around the pre-existing
`requireBundle`) and zero removed/modified handlers. Every scanner/watchlist/
memory-map/typed-view/pointer-map channel is untouched — verified both by the diff
itself (only additive) and by regression-lock tests (mission tests 29-32) that
assert those channel names are still registered in the source.

## 14. Tests

`tests/p4-10-runtime-session-reuse.test.ts` — 29 tests across 9 describe blocks,
covering mission tests 1-34 (see the file's own header comment for the mapping —
"Execution IPC"/"Transactions" categories are proven at the
`TrainerApplicationService`/`TrainerRuntime`/`CompositeTransactionRuntime` layer
the IPC handlers call directly, since node:test cannot drive Electron's `ipcMain`
without a running app, the same boundary P4-9's own IPC-convergence test uses).
Includes the required §27 real-composition test: one real `LiveMemorySession` +
`MemoryManager` + `FakeMemoryDriver`, one real attach (owner), one `bindExisting`
(borrower, proven via an `openProcess` call counter staying at 1), a real write
landing through the driver, a real rollback undoing it, and proof that disposing
the borrowed runtime leaves the session attached.

`tests/fixtures/fake-trainer-runtime-capabilities.ts` gained
`getAttachedIdentity()` (implementing the widened `TrainerRuntimeCapabilities`
interface) and `simulateAlreadyAttached()` (a test seam for "this session was
attached by someone else"), both additive — no existing test in
`trainer-runtime.test.ts`/`trainer-runtime-integration.test.ts`/
`trainer-transaction*.test.ts` calls either, and all of those suites were re-run
and confirmed unaffected.

## 15. Regression evidence

| Suite | Result |
|---|---|
| `test:p4-10-runtime-session-reuse` (new) | 29/29, 0 fail |
| `test:trainer-runtime` | 32/32 |
| `test:trainer-transaction` | 36/36 |
| `test:trainer-application` | 5/5 |
| `test:trainer-storage` | 34/34 |
| `test:p4-4-legacy-adapters` | 13/13 |
| `test:live-memory` (consent/session/write-policy group) | 557/557 (87 pre-existing skips) |
| Full `npm test` (`scripts/run-node-tests.mjs test`) | 2220/2220 (87 skipped), 0 fail |
| `npx tsc --noEmit` | clean |
| `npx tsc -p tsconfig.electron.json --noEmit` | clean |
| `npx tsup --config tsup.config.ts` | builds `main.js`/`preload.cjs`/`host-entry.js`/`headless-verification-worker.js` cleanly |
| `node scripts/verify-electron-output.mjs` | 33/33 checks pass |

## 16. Scope discipline

Touched: `src/core/trainer-runtime/*`, `src/core/trainer-application/*`,
`src/core/consent/write-consent.ts` (additive `ConsentOperation` union widening
only), `electron/{main,preload,live-memory-ipc,ipc-validation}.ts` (additive),
new `electron/trainer-execution-ipc.ts`, `tests/`, `package.json`, docs. Zero
scanner/memory-map/inference/watchlist internals touched. Zero Phase 5 CT/Phase 6
Creator/Wisp work. Zero destructive deletion.
