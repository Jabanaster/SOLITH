import {
  getCanonicalTrainerDefinition,
  listCanonicalTrainerDefinitions,
  persistTrainerDefinition,
  removeCanonicalTrainerDefinition,
  type CanonicalTrainerRecord,
  type SaveTrainerDefinitionInput,
  type StorageResult,
  type TrainerDefinitionListResult,
} from '../trainer-storage/index.js';
import type { WriteApproval } from '../trainer-runtime/action-executor.js';
import type { PreBindCompatibilityInput } from '../trainer-runtime/compatibility.js';
import type { WriteConsentBinding } from '../consent/write-consent.js';
import type { CompositeTransactionPlan, CompositeTransactionResult, CompositeTransactionRuntime } from '../trainer-runtime/transaction.js';
import type { BindTarget, TrainerRuntime } from '../trainer-runtime/runtime.js';
import { buildRuntimeStateDTO, type RuntimeStateDTO } from './runtime-state-dto.js';
import { fail, type RuntimeResult } from '../trainer-runtime/types.js';
import type { CompatibilityDecision } from '../trainer-runtime/compatibility.js';

/**
 * Narrow application-service boundary between trainer-facing IPC and the
 * canonical Phase 4 stack. IPC handlers should call through here instead of
 * instantiating or orchestrating persistence/runtime internals themselves
 * (mission §7/§9) — definition reads/writes forward to src/core/trainer-storage
 * (P4-8), the single place migration-on-read, source-priority conflict
 * resolution, and transactional write/verify actually live; runtime-execution
 * methods below forward to a caller-supplied `TrainerRuntime`/
 * `CompositeTransactionRuntime` instance instead of owning one, matching
 * this module's existing stateless-orchestration shape — instance lifecycle
 * (which runtime belongs to which live session) stays where the P4-9
 * precedent already puts per-session state: the IPC layer
 * (electron/trainer-execution-ipc.ts), the same pattern
 * electron/live-memory-ipc.ts uses for its own per-sender session bundle.
 *
 * P4-10 closes the P4-9 runtime gate documented in
 * Docs/phase4/005-p4-9-canonical-ui-ipc-convergence.md, "Runtime IPC":
 * `TrainerRuntime.bind()` always performed its own attach(); the fix is
 * `TrainerRuntime.bindExisting()` (src/core/trainer-runtime/runtime.ts),
 * which reuses an already-attached session instead of re-attaching. See
 * Docs/phase4/007-p4-10-runtime-session-reuse-execution-ipc.md.
 */
export const trainerApplicationService = {
  getTrainer(catalogGameId: string): StorageResult<CanonicalTrainerRecord> {
    return getCanonicalTrainerDefinition(catalogGameId);
  },

  listTrainers(): StorageResult<TrainerDefinitionListResult> {
    return listCanonicalTrainerDefinitions();
  },

  saveTrainer(rawInput: unknown, input: SaveTrainerDefinitionInput): StorageResult<CanonicalTrainerRecord> {
    return persistTrainerDefinition(rawInput, input);
  },

  removeTrainer(catalogGameId: string): StorageResult<void> {
    return removeCanonicalTrainerDefinition(catalogGameId);
  },

  /** UNLOADED -> COMPATIBILITY_CHECKED on a fresh `runtime`: load, validate, compat-check. No bind. */
  prepareRuntime(
    runtime: TrainerRuntime,
    rawInput: unknown,
    compatInput: PreBindCompatibilityInput,
  ): RuntimeResult<CompatibilityDecision> {
    const loaded = runtime.load(rawInput);
    if (loaded.success === false) return fail(loaded.error);
    const validated = runtime.validate();
    if (validated.success === false) return fail(validated.error);
    return runtime.checkCompatibility(compatInput);
  },

  /**
   * COMPATIBILITY_CHECKED -> BOUND/READY. `mode: 'borrow'` (the P4-10
   * default execution path) reuses an already-attached session via
   * `bindExisting()` — no second attach. `mode: 'own'` performs a real
   * `bind()`/attach(), for the rarer case of no existing authorized session
   * (mission §4 Option A/B still apply; Option C — attach IPC becoming a
   * facade over the runtime — is not implemented, since Option A is safe and
   * sufficient here).
   */
  bindRuntime(
    runtime: TrainerRuntime,
    target: BindTarget,
    opts: { mode: 'borrow' | 'own'; userConfirmedOffline?: boolean },
  ): Promise<RuntimeResult<void>> {
    if (opts.mode === 'borrow') return runtime.bindExisting(target);
    return runtime.bind(target, opts.userConfirmedOffline ?? false);
  },

  activateWriteFeature(
    runtime: TrainerRuntime,
    featureId: string,
    requestedValue: number,
    approval: WriteApproval,
    reason?: string,
  ): Promise<RuntimeResult<void>> {
    return runtime.activateWriteFeature(featureId, requestedValue, approval, reason);
  },

  activateFreezeFeature(
    runtime: TrainerRuntime,
    featureId: string,
    value: number,
    approval: { consentToken: string; consentBinding: WriteConsentBinding },
    intervalMs?: number,
  ): Promise<RuntimeResult<void>> {
    return runtime.activateFreezeFeature(featureId, value, approval, intervalMs);
  },

  /**
   * Propose/confirm split (P4-10) — the real interactive-consent path a
   * renderer uses: propose to get a real proposalId/address, request a
   * consent token bound to it, then confirm. `activateWriteFeature` above
   * stays for the already-approved / composite-transaction path.
   */
  proposeWriteFeature(runtime: TrainerRuntime, featureId: string, requestedValue: number, reason?: string) {
    return runtime.proposeWriteFeature(featureId, requestedValue, reason);
  },

  confirmWriteFeature(runtime: TrainerRuntime, featureId: string, proposalId: string, approval: WriteApproval, reason?: string): Promise<RuntimeResult<void>> {
    return runtime.confirmWriteFeature(featureId, proposalId, approval, reason);
  },

  proposeFreezeFeature(runtime: TrainerRuntime, featureId: string, value: number, intervalMs?: number) {
    return runtime.proposeFreezeFeature(featureId, value, intervalMs);
  },

  confirmFreezeFeature(
    runtime: TrainerRuntime,
    featureId: string,
    proposalId: string,
    approval: { consentToken: string; consentBinding: WriteConsentBinding },
  ): Promise<RuntimeResult<void>> {
    return runtime.confirmFreezeFeature(featureId, proposalId, approval);
  },

  deactivateFeature(runtime: TrainerRuntime, featureId: string): RuntimeResult<void> {
    return runtime.deactivateFreezeFeature(featureId);
  },

  rollbackFeature(runtime: TrainerRuntime, featureId: string, proposalId: string): Promise<RuntimeResult<void>> {
    return runtime.rollbackFeature(featureId, proposalId);
  },

  /** Prepares (validates + locks + resolves) then immediately executes an ATOMIC composite plan. */
  async executeComposite(
    transactionRuntime: CompositeTransactionRuntime,
    plan: CompositeTransactionPlan,
  ): Promise<RuntimeResult<CompositeTransactionResult>> {
    const prepared = await transactionRuntime.prepareTransaction(plan);
    if (prepared.success === false) return prepared;
    return transactionRuntime.executeTransaction(plan.id);
  },

  cancelComposite(transactionRuntime: CompositeTransactionRuntime, transactionId: string): RuntimeResult<CompositeTransactionResult> {
    return transactionRuntime.cancelTransaction(transactionId);
  },

  getTransactionState(transactionRuntime: CompositeTransactionRuntime, transactionId: string): CompositeTransactionResult | undefined {
    return transactionRuntime.getTransactionState(transactionId);
  },

  /** Renderer-safe runtime state projection (mission §19). */
  getRuntimeState(runtime: TrainerRuntime): RuntimeStateDTO {
    return buildRuntimeStateDTO(runtime);
  },
};

export type TrainerApplicationService = typeof trainerApplicationService;
