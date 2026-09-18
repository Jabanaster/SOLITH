import type { WriteConsentBinding } from '../consent/write-consent.js';
import type { WriteApproval } from './action-executor.js';
import type { TrainerRuntimeCapabilities } from './capabilities.js';
import { runtimeError, type RuntimeError } from './errors.js';
import type { TrainerRuntime } from './runtime.js';
import { assertTransitionTransaction, type TransactionLifecycleState } from './transaction-state.js';
import { fail, ok, type RuntimeResult } from './types.js';

/**
 * A `write` action dispatches through the exact same
 * `TrainerRuntime.activateWriteFeature` path a single-action caller would
 * use (toggle/write_once only — mirrors P4-5's own action-type restriction).
 */
export interface WriteTransactionAction {
  kind: 'write';
  featureId: string;
  requestedValue: number;
  approval: WriteApproval;
  reason?: string;
}

/**
 * A `freeze` action dispatches through `TrainerRuntime.activateFreezeFeature`.
 * Token-only, same as the single-action path — no transaction-wide consent
 * bypass exists.
 */
export interface FreezeTransactionAction {
  kind: 'freeze';
  featureId: string;
  value: number;
  approval: { consentToken: string; consentBinding: WriteConsentBinding };
  intervalMs?: number;
}

export type TransactionAction = WriteTransactionAction | FreezeTransactionAction;

/**
 * BEST_EFFORT is explicitly deferred per mission §7 — no current product
 * requirement for it, so it is not implemented (not even as a stub). ATOMIC
 * is the only supported mode.
 */
export type TransactionMode = 'ATOMIC';

export interface CompositeTransactionPlan {
  /** Caller-supplied unique id. Re-using an id already tracked by this runtime is rejected. */
  id: string;
  actions: TransactionAction[];
  mode: TransactionMode;
}

export type TransactionActionOutcome = 'pending' | 'committed' | 'failed' | 'rolled_back' | 'rollback_failed' | 'skipped';

export interface TransactionActionRecord {
  readonly index: number;
  readonly action: TransactionAction;
  startedAt?: string;
  completedAt?: string;
  result: TransactionActionOutcome;
  error?: RuntimeError;
  rollbackError?: RuntimeError;
}

export interface CompositeTransactionResult {
  readonly id: string;
  state: TransactionLifecycleState;
  actionRecords: TransactionActionRecord[];
  /** Set for FAILED / ROLLED_BACK / PARTIAL_ROLLBACK_FAILURE / CANCELLED. */
  failure?: RuntimeError;
}

interface TransactionInternalRecord extends CompositeTransactionResult {
  readonly plan: CompositeTransactionPlan;
  cancelRequested: boolean;
}

function markRemainingSkipped(record: TransactionInternalRecord, fromIndex: number): void {
  for (let i = fromIndex; i < record.actionRecords.length; i++) {
    if (record.actionRecords[i].result === 'pending') {
      record.actionRecords[i].result = 'skipped';
    }
  }
}

function toResult(record: TransactionInternalRecord): CompositeTransactionResult {
  return { id: record.id, state: record.state, actionRecords: record.actionRecords, failure: record.failure };
}

/**
 * Orchestrates atomic multi-action trainer transactions (P4-7) strictly
 * above the P4-5 canonical capability boundary:
 *
 *   Composite Transaction -> TrainerRuntime (per-feature methods) ->
 *   action-executor -> TrainerRuntimeCapabilities -> LiveMemorySession/MemoryManager
 *
 * Owns NO memory scanning/writing/freezing/rollback logic of its own — every
 * mutation is dispatched through `runtime.activateWriteFeature` /
 * `activateFreezeFeature` / `rollbackFeature` / `deactivateFreezeFeature`,
 * the exact same methods a single-action caller uses. This class adds only:
 * ordering, pre-flight validation, a rollback stack, a transaction lifecycle,
 * and feature-scoped concurrency locking.
 *
 * `capabilities` must be the SAME instance the `runtime` was constructed
 * with — this class calls two of its non-mutating query methods directly
 * (`verifyIdentity`, `getFreezeStatus`) for pre-flight and mid-transaction
 * checks that would otherwise force a premature runtime-wide DEGRADE.
 */
export class CompositeTransactionRuntime {
  private readonly transactions = new Map<string, TransactionInternalRecord>();
  private readonly lockedFeatureIds = new Set<string>();

  constructor(
    private readonly runtime: TrainerRuntime,
    private readonly capabilities: TrainerRuntimeCapabilities,
  ) {}

  getTransactionState(id: string): CompositeTransactionResult | undefined {
    const record = this.transactions.get(id);
    return record ? toResult(record) : undefined;
  }

  /**
   * Validates and reserves a transaction. Structural checks (action types,
   * unknown/duplicate feature ids), runtime state, process identity, feature
   * locks, and — because the real session supports only one concurrent
   * freeze — freeze-slot availability are all checked here so a `freeze`
   * capability conflict is caught before Action 1 ever mutates anything
   * (mission §11). Feature targets are also resolved here (non-mutating;
   * mission §12) so a resolution failure is a zero-mutation pre-flight
   * failure, not a mid-transaction one.
   */
  async prepareTransaction(plan: CompositeTransactionPlan): Promise<RuntimeResult<CompositeTransactionResult>> {
    if (this.transactions.has(plan.id)) {
      return fail(runtimeError('TRANSACTION_VALIDATION_FAILED', `Transaction id "${plan.id}" is already in use.`));
    }

    const record: TransactionInternalRecord = {
      id: plan.id,
      plan,
      state: 'CREATED',
      actionRecords: plan.actions.map((action, index) => ({ index, action, result: 'pending' as const })),
      cancelRequested: false,
    };
    this.transactions.set(plan.id, record);
    record.state = 'VALIDATING';

    if (plan.actions.length === 0) {
      return this.failPreflight(record, runtimeError('TRANSACTION_VALIDATION_FAILED', 'A composite transaction must contain at least one action.'));
    }
    if (plan.mode !== 'ATOMIC') {
      return this.failPreflight(
        record,
        runtimeError('TRANSACTION_VALIDATION_FAILED', `Unsupported transaction mode "${plan.mode as string}"; only ATOMIC is implemented.`),
      );
    }
    const duplicate = this.findDuplicateFeatureId(plan);
    if (duplicate) {
      return this.failPreflight(
        record,
        runtimeError('TRANSACTION_VALIDATION_FAILED', `Feature "${duplicate}" targeted by more than one action in the same transaction.`),
      );
    }

    // Runtime state (and therefore feature bookkeeping, populated only by
    // bind()) must be valid BEFORE per-action feature lookups below —
    // otherwise "unknown feature" would mask the real "runtime not bound yet"
    // cause.
    const runtimeState = this.runtime.getState();
    if (runtimeState !== 'READY' && runtimeState !== 'ACTIVE') {
      return this.failPreflight(
        record,
        runtimeError('INVALID_STATE_TRANSITION', `Runtime must be READY or ACTIVE to prepare a transaction, but is ${runtimeState}.`),
      );
    }

    const identityError = this.capabilities.verifyIdentity();
    if (identityError !== null) {
      return this.failPreflight(record, runtimeError('PROCESS_LOST', identityError));
    }

    const structural = this.validateFeatureActions(plan);
    if (structural) return this.failPreflight(record, structural);

    const featureIds = plan.actions.map((a) => a.featureId);
    const conflicting = featureIds.find((id) => this.lockedFeatureIds.has(id));
    if (conflicting) {
      return this.failPreflight(
        record,
        runtimeError('TRANSACTION_CONFLICT', `Feature "${conflicting}" is locked by another in-flight transaction.`),
      );
    }

    const freezeActions = plan.actions.filter((a): a is FreezeTransactionAction => a.kind === 'freeze');
    if (freezeActions.length > 1) {
      return this.failPreflight(
        record,
        runtimeError('CAPABILITY_UNAVAILABLE', 'The live-memory session supports only one concurrent freeze; this transaction requests more than one.'),
      );
    }
    if (freezeActions.length === 1 && this.capabilities.getFreezeStatus().active) {
      return this.failPreflight(
        record,
        runtimeError('CAPABILITY_UNAVAILABLE', 'A freeze is already active on this session; cannot start another.'),
      );
    }

    for (const action of plan.actions) {
      const resolved = await this.runtime.resolveFeature(action.featureId);
      if (resolved.success === false) {
        return this.failPreflight(record, resolved.error);
      }
    }

    record.state = 'READY';
    for (const id of featureIds) this.lockedFeatureIds.add(id);
    return ok(toResult(record));
  }

  private findDuplicateFeatureId(plan: CompositeTransactionPlan): string | null {
    const seen = new Set<string>();
    for (const action of plan.actions) {
      if (seen.has(action.featureId)) return action.featureId;
      seen.add(action.featureId);
    }
    return null;
  }

  private validateFeatureActions(plan: CompositeTransactionPlan): RuntimeError | null {
    for (const action of plan.actions) {
      const feature = this.runtime.getFeatureState(action.featureId);
      if (!feature) {
        return runtimeError('TRANSACTION_VALIDATION_FAILED', `Unknown feature id "${action.featureId}".`);
      }
      if (action.kind === 'write' && feature.definition.type !== 'toggle' && feature.definition.type !== 'write_once') {
        return runtimeError('UNSUPPORTED_ACTION', `Feature "${action.featureId}" is type "${feature.definition.type}", not a write action.`);
      }
      if (action.kind === 'freeze' && feature.definition.type !== 'freeze') {
        return runtimeError('UNSUPPORTED_ACTION', `Feature "${action.featureId}" is type "${feature.definition.type}", not freeze.`);
      }
    }
    return null;
  }

  private failPreflight(record: TransactionInternalRecord, error: RuntimeError): RuntimeResult<CompositeTransactionResult> {
    record.state = 'FAILED';
    record.failure = error;
    markRemainingSkipped(record, 0);
    return fail(error);
  }

  /**
   * Executes a READY transaction's actions in declared order. On the first
   * action failure, rolls back every already-committed action in reverse
   * order (mission §14/§15) and resolves to a typed failure whose `reason`
   * reflects the honest outcome (`ROLLED_BACK` semantics via the returned
   * RuntimeResult's underlying `failure`, or `PARTIAL_ROLLBACK_FAILURE` if a
   * rollback itself failed — never reported as a clean rollback when it
   * was not).
   */
  async executeTransaction(id: string): Promise<RuntimeResult<CompositeTransactionResult>> {
    const record = this.transactions.get(id);
    if (!record) return fail(runtimeError('TRANSACTION_VALIDATION_FAILED', `Unknown transaction id "${id}".`));
    if (record.state === 'EXECUTING' || record.state === 'ROLLING_BACK') {
      return fail(runtimeError('NESTED_TRANSACTION_UNSUPPORTED', `Transaction "${id}" is already executing; re-entrant execution is not supported.`));
    }
    if (record.state !== 'READY') {
      return fail(runtimeError('INVALID_STATE_TRANSITION', `Transaction "${id}" is ${record.state}, expected READY.`));
    }

    assertTransitionTransaction(record.state, 'EXECUTING');
    record.state = 'EXECUTING';
    const committed: TransactionActionRecord[] = [];

    for (let i = 0; i < record.actionRecords.length; i++) {
      if (record.cancelRequested) {
        return this.finalize(record, committed, 'cancelled', i);
      }

      const identityError = this.capabilities.verifyIdentity();
      if (identityError !== null) {
        record.failure = runtimeError('PROCESS_LOST', identityError);
        return this.finalize(record, committed, 'failure', i);
      }

      const actionRecord = record.actionRecords[i];
      actionRecord.startedAt = new Date().toISOString();
      const outcome = await this.dispatchOne(actionRecord.action);
      actionRecord.completedAt = new Date().toISOString();

      if (outcome.success === false) {
        actionRecord.result = 'failed';
        actionRecord.error = outcome.error;
        record.failure = outcome.error;
        return this.finalize(record, committed, 'failure', i + 1);
      }

      actionRecord.result = 'committed';
      committed.push(actionRecord);
    }

    record.state = 'COMMITTED';
    this.unlock(record);
    return ok(toResult(record));
  }

  /**
   * Requests cancellation. Before execution starts this finalizes
   * immediately (zero mutations). Once EXECUTING, this only sets a flag —
   * the running `executeTransaction()` call observes it at the next safe
   * boundary (between actions; mission §24 forbids interrupting an in-flight
   * write) and performs the actual rollback-then-CANCELLED transition. The
   * caller awaiting `executeTransaction()` receives the final result.
   */
  cancelTransaction(id: string): RuntimeResult<CompositeTransactionResult> {
    const record = this.transactions.get(id);
    if (!record) return fail(runtimeError('TRANSACTION_VALIDATION_FAILED', `Unknown transaction id "${id}".`));

    if (record.state === 'READY') {
      record.failure = runtimeError('TRANSACTION_CANCELLED', 'Transaction cancelled before execution; no action was dispatched.');
      record.state = 'CANCELLED';
      markRemainingSkipped(record, 0);
      this.unlock(record);
      return ok(toResult(record));
    }
    if (record.state === 'EXECUTING') {
      record.cancelRequested = true;
      return ok(toResult(record));
    }
    return fail(runtimeError('INVALID_STATE_TRANSITION', `Cannot cancel transaction "${id}" in state ${record.state}.`));
  }

  private async dispatchOne(action: TransactionAction): Promise<RuntimeResult<void>> {
    if (action.kind === 'write') {
      return this.runtime.activateWriteFeature(action.featureId, action.requestedValue, action.approval, action.reason);
    }
    return this.runtime.activateFreezeFeature(action.featureId, action.value, action.approval, action.intervalMs);
  }

  /**
   * Freeze compensation is verified, not assumed: the real
   * `TrainerRuntimeCapabilities.stopFreeze()` has no failure return, so
   * compensation success is confirmed via the same `getFreezeStatus()` query
   * used for pre-flight rather than trusted blindly (mission §17: "do not
   * leave a freeze worker running after failed atomic transaction").
   */
  private async compensateOne(action: TransactionAction): Promise<RuntimeResult<void>> {
    if (action.kind === 'write') {
      const feature = this.runtime.getFeatureState(action.featureId);
      const proposalId = feature?.activation.proposalId;
      if (!proposalId) {
        return fail(runtimeError('ROLLBACK_FAILED', `No rollback reference recorded for feature "${action.featureId}".`));
      }
      return this.runtime.rollbackFeature(action.featureId, proposalId);
    }

    const stop = this.runtime.deactivateFreezeFeature(action.featureId);
    if (stop.success === false) return stop;
    if (this.capabilities.getFreezeStatus().active) {
      return fail(runtimeError('FREEZE_FAILED', `Freeze compensation for feature "${action.featureId}" did not take effect (freeze still active).`));
    }
    return ok(undefined);
  }

  private async finalize(
    record: TransactionInternalRecord,
    committed: TransactionActionRecord[],
    cause: 'failure' | 'cancelled',
    nextPendingIndex: number,
  ): Promise<RuntimeResult<CompositeTransactionResult>> {
    if (committed.length === 0) {
      record.state = cause === 'cancelled' ? 'CANCELLED' : 'FAILED';
      if (cause === 'cancelled') {
        record.failure = runtimeError('TRANSACTION_CANCELLED', 'Transaction cancelled before any action committed.');
      }
      markRemainingSkipped(record, nextPendingIndex);
      this.unlock(record);
      if (record.failure!.reason === 'PROCESS_LOST') {
        await this.degradeRuntime(record.failure!.message);
      }
      return cause === 'cancelled' ? ok(toResult(record)) : fail(record.failure!);
    }

    assertTransitionTransaction(record.state, 'ROLLING_BACK');
    record.state = 'ROLLING_BACK';
    markRemainingSkipped(record, nextPendingIndex);

    let anyRollbackFailed = false;
    for (let i = committed.length - 1; i >= 0; i--) {
      const actionRecord = committed[i];
      const rollback = await this.compensateOne(actionRecord.action);
      if (rollback.success === false) {
        anyRollbackFailed = true;
        actionRecord.result = 'rollback_failed';
        actionRecord.rollbackError = rollback.error;
      } else {
        actionRecord.result = 'rolled_back';
      }
    }

    const wasProcessLoss = record.failure?.reason === 'PROCESS_LOST';
    if (wasProcessLoss) {
      await this.degradeRuntime(record.failure!.message);
    }

    if (anyRollbackFailed) {
      record.state = 'PARTIAL_ROLLBACK_FAILURE';
      this.unlock(record);
      return fail(
        runtimeError(
          'PARTIAL_ROLLBACK_FAILURE',
          'One or more rollback operations failed after a transaction failure; see actionRecords for per-action detail.',
          record.failure,
        ),
      );
    }

    record.state = cause === 'cancelled' ? 'CANCELLED' : 'ROLLED_BACK';
    this.unlock(record);
    if (cause === 'cancelled') {
      record.failure = runtimeError('TRANSACTION_CANCELLED', 'Transaction cancelled after partial execution; committed actions were rolled back.');
      return ok(toResult(record));
    }
    return fail(record.failure!);
  }

  /** Best-effort: degrades the runtime after a process-loss-triggered finalize. No-op if already non-live. */
  private async degradeRuntime(reason: string): Promise<void> {
    const state = this.runtime.getState();
    if (state === 'BOUND' || state === 'READY' || state === 'ACTIVE') {
      this.runtime.handleProcessLoss(reason);
    }
  }

  private unlock(record: TransactionInternalRecord): void {
    for (const action of record.plan.actions) this.lockedFeatureIds.delete(action.featureId);
  }
}
