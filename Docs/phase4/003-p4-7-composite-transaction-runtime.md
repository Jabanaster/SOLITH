# P4-7 — Composite / Multi-Action Transaction Runtime

**Roadmap track:** external roadmap Phase 4 (trainer-model convergence), stage P4-7. Builds directly on [002-p4-5-canonical-trainer-runtime-core.md](002-p4-5-canonical-trainer-runtime-core.md).

## Scope

Adds first-class support for atomic composite trainer operations — multiple
canonical runtime actions (write/freeze) that must all succeed or none take
effect — strictly above the P4-5 capability boundary. No new memory
scanning/writing/freezing/rollback implementation; every mutation dispatches
through `TrainerRuntime`'s existing per-feature methods
(`activateWriteFeature`/`activateFreezeFeature`/`rollbackFeature`/
`deactivateFreezeFeature`), the exact same methods a single-action caller
uses.

## Architecture

```
Trainer Feature
  -> Composite Transaction (CompositeTransactionRuntime, new)
  -> TrainerRuntime (P4-5, unmodified — per-feature methods)
  -> action-executor (P4-5, unmodified)
  -> TrainerRuntimeCapabilities (P4-5, unmodified)
  -> LiveMemorySession / MemoryManager (real, unmodified)
```

`CompositeTransactionRuntime` (`transaction.ts`) is constructed with a
`TrainerRuntime` and the *same* `TrainerRuntimeCapabilities` instance the
runtime was built with. It calls two of that interface's non-mutating query
methods directly (`verifyIdentity`, `getFreezeStatus`) for pre-flight and
mid-transaction checks that would otherwise force a premature
runtime-wide `DEGRADED` transition — everything else routes through
`TrainerRuntime`.

## Transaction model

`CompositeTransactionPlan { id, actions: TransactionAction[], mode: 'ATOMIC' }`.
`TransactionAction` is a closed union of `WriteTransactionAction` (dispatches
`activateWriteFeature`) and `FreezeTransactionAction` (dispatches
`activateFreezeFeature`) — each carries its own approval/consent, no
transaction-wide bypass. `BEST_EFFORT` mode is explicitly deferred (no
current product requirement) — `mode` is a single-literal type and
`prepareTransaction` rejects anything else defensively.

Composite transactions are **not** a new schema concept: a plan references
existing `MemoryFeatureV1` entries already loaded on the bound
`TrainerRuntime` by id. `schema.v1.ts` is untouched; no schema v2 was
introduced (mission §25/§33/§34).

## Transaction lifecycle

`CREATED -> VALIDATING -> READY -> EXECUTING -> (COMMITTED | ROLLING_BACK) ->
(ROLLED_BACK | PARTIAL_ROLLBACK_FAILURE | CANCELLED)`, plus `FAILED` for a
pre-flight rejection. All of `COMMITTED`/`ROLLED_BACK`/
`PARTIAL_ROLLBACK_FAILURE`/`FAILED`/`CANCELLED` are terminal (`transaction-state.ts`,
mirrors P4-5's `state.ts` explicit-transitions-table pattern). Separate from
`RuntimeLifecycleState` — a transaction is a short-lived record layered above
an already-`BOUND` runtime, not a replacement for its lifecycle.

## Pre-flight (`prepareTransaction`)

Checked in order, each a zero-mutation fail:
1. structural shape (non-empty, `mode === 'ATOMIC'`, no feature targeted twice in one plan)
2. runtime state (`READY`/`ACTIVE`) — checked before feature lookups, since the feature map is only populated by `bind()`
3. process identity (`capabilities.verifyIdentity()`)
4. per-action feature existence + action-kind/feature-type match (`UNSUPPORTED_ACTION` for a mismatch)
5. feature-scoped lock conflicts (`TRANSACTION_CONFLICT`)
6. freeze-slot availability — the real session supports only one concurrent freeze, so a plan requesting more than one freeze action, or one when `capabilities.getFreezeStatus().active` is already true, fails as `CAPABILITY_UNAVAILABLE` **before** any action runs (mission §11's own worked example)
7. target resolution for every action via `runtime.resolveFeature()` (non-mutating; reduces mid-transaction failure per mission §12)

On success, every targeted feature id is locked and the transaction moves to `READY`.

## Execution

Actions run strictly in declared order. Before each action (including the
first), the loop checks `cancelRequested` and re-verifies process identity —
this is what turns "process lost after Action 1" into "no Action 2 dispatched"
rather than a race. Each action dispatches through the same
`TrainerRuntime.activateWriteFeature`/`activateFreezeFeature` a single-action
caller uses; since pre-flight already resolved the target, these calls skip
re-resolution (identical caching behavior to a direct single-action call —
no new staleness model introduced).

## Rollback stack

Only actions that actually commit are pushed onto an in-order list; on the
first failure (or a cancellation observed between actions), that list is
unwound in **reverse** order. Write rollback is a thin pass-through to
`TrainerRuntime.rollbackFeature` (itself `MemoryManager.rollback`, which
restores a manifest looked up server-side — never a caller-supplied value).
Toggle rollback therefore restores the actual prior value via that manifest,
not a blind re-toggle (mission §18).

## Freeze compensation

`TrainerRuntime.deactivateFreezeFeature` is called, then verified: the real
`TrainerRuntimeCapabilities.stopFreeze()` has no failure return, so
compensation success is **confirmed**, not assumed, via the same
`getFreezeStatus()` query pre-flight already uses. If the freeze is still
reported active after the stop call, compensation is reported as a typed
`FREEZE_FAILED` rollback failure rather than silently trusted (mission §17).

## Partial rollback failure

If any compensation call in the reverse-order sweep fails, the transaction
terminates as `PARTIAL_ROLLBACK_FAILURE` — never reported as a clean
rollback. The result exposes, per action: committed/failed/rolled_back/
rollback_failed/skipped, plus the rollback error alongside the original
triggering failure (`RuntimeError.detail`) — both preserved, nothing hidden
(mission §19).

## Process loss mid-transaction

Identity is checked before every action. On loss: no further forward action
dispatches; already-committed actions are rolled back through the same
runtime methods (attempted while the runtime is still `READY`/`ACTIVE`, so
the attempt is not blocked by a premature `DEGRADED` transition); only after
the rollback sweep finishes does the transaction call
`runtime.handleProcessLoss()` to formally degrade the runtime. If a rollback
itself then fails under the same lost-identity condition, that surfaces
honestly as `PARTIAL_ROLLBACK_FAILURE` — never fabricated as success (mission
§20/§21).

## Cancellation

`cancelTransaction()` before execution starts finalizes immediately
(`READY -> CANCELLED`, zero mutations). Once `EXECUTING`, it only sets a flag;
the in-flight `executeTransaction()` call observes it at the next safe
boundary (between actions — an in-flight write/freeze call is never
interrupted) and performs rollback-then-`CANCELLED`. If that rollback itself
fails, the transaction honestly reports `PARTIAL_ROLLBACK_FAILURE` instead
(cancellation is not a excuse to hide a real rollback failure).

## Concurrency

Feature-scoped locking (narrowest safe scope per mission §23): a transaction
locks every feature id it targets from successful pre-flight through its
terminal state. A second transaction touching any locked feature is rejected
pre-flight as `TRANSACTION_CONFLICT`; a transaction touching only unrelated
features proceeds unaffected. No runtime-wide lock, no generalized lock
manager.

## Nested transactions

Structurally impossible by construction (`TransactionAction` only has
`write`/`freeze` leaf kinds — a transaction can never appear as an action).
`executeTransaction()` additionally guards against accidental re-entrant
calls on an already-`EXECUTING`/`ROLLING_BACK` transaction, returning
`NESTED_TRANSACTION_UNSUPPORTED`.

## Error taxonomy extension

Five new, additive `RuntimeFailureReason` values (`errors.ts`) — every
per-action failure still surfaces its precise existing P4-5 reason
(`WRITE_FAILED`, `FREEZE_FAILED`, `PROCESS_LOST`, etc.) inside the
transaction's `actionRecords`; these five are transaction-level outcomes with
no existing equivalent:

- `TRANSACTION_VALIDATION_FAILED`
- `PARTIAL_ROLLBACK_FAILURE`
- `TRANSACTION_CONFLICT`
- `TRANSACTION_CANCELLED`
- `NESTED_TRANSACTION_UNSUPPORTED`

## Observability

No second audit subsystem. Every real write/rollback/freeze call already
flows through `MemoryManager`'s existing `MemoryAuditLog.append()` calls
(featureId-tagged), unchanged. `CompositeTransactionResult.actionRecords` is
orchestration-level bookkeeping (typed, in-memory, queryable via
`getTransactionState()`) — not a parallel record of raw memory operations.

## Injection isolation

`transaction.ts` contains zero references to `src/core/in-process-script/`
and no direct native-memory/driver calls — verified by both design review and
an automated source-text-scan test (mirrors the equivalent P4-5 test).

## Tests

| Command | Tests | Result |
|---|---|---|
| `npx tsc --noEmit` | — | PASS |
| `npx tsc -p tsconfig.electron.json --noEmit` | — | PASS |
| `npm run test:trainer-transaction` (new) | 36 | 36/36 pass |
| `npm run test:trainer-runtime` | 32 | 32/32 pass |
| `npm run test:definitions` | 124 | 124/124 pass |
| `npm run test:trainer-catalog` | 204 | 204/204 pass |
| `npm run test:trainer-schema` | 36 | 36/36 pass |
| `npm run test:v2-lifecycle` | 56 | 56/56 pass |
| `npm run test:cheat-toggle` | 27 | 27/27 pass |
| `npm run test:lifecycle-wiring` | 22 | 22/22 pass |
| `npm run test:command-runner` | 14 | 14/14 pass |
| `npm run test:in-process` | 9 | 9/9 pass |
| `npm run test:game-profile` | 49 | 49/49 pass |
| `npm run test:v1` | 210 | 210/210 pass |
| `npm run verify:schema-v1-boundaries` | — | PASS |
| `npm run test:trainer-host` | — | **NOT RUN** — requires native `build:electron`; untouched by this mission's scope |

`tests/trainer-transaction.test.ts` (34 unit tests, `FakeTrainerRuntimeCapabilities`)
covers the full required matrix: basic ordering/outcomes, pre-flight
(unsupported action, freeze-slot conflict, invalid runtime state, unknown
feature), reverse-order rollback, freeze compensation (including a forced
"stop reported success but freeze still active" case), rollback failure
(`PARTIAL_ROLLBACK_FAILURE` with both outcomes preserved), process loss
(before/mid-transaction, honest rollback-attempt-then-report), cancellation
(before/between actions), feature-scoped concurrency (conflict + unrelated),
single-action backward compatibility, security (no native calls, no
injection path, consent not weakened), and schema (no v2 introduced).
`tests/trainer-transaction-integration.test.ts` (2 tests) drives the real
`LiveMemorySession`/`MemoryManager`/`FakeMemoryDriver` stack: one proves a
real two-write atomic commit lands through the actual driver; the other
forces a real second-action write failure and proves the first action is
rolled back through the real `MemoryManager.rollback()` — not a fake
shortcut.

## Scope contamination check

- Phase 2 implementation modified: NO
- Phase 3 implementation modified: NO
- P4-4 legacy retirement: NOT started
- Phase 5/6 work: NO
- Destructive cleanup: NO
- Files touched: `src/core/trainer-runtime/transaction.ts`, `transaction-state.ts` (new); `errors.ts`, `index.ts` (additive exports only); `package.json` (test script wiring); `tests/trainer-transaction.test.ts`, `tests/trainer-transaction-integration.test.ts` (new); this document.
