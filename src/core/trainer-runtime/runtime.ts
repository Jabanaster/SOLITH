import { migrateTrainerDefinition } from '../definitions/migrations/index.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import type { LiveMemoryAddress, LiveProcessTarget } from '../live-memory/types.js';
import {
  confirmFreezeAction,
  confirmWriteAction,
  dispatchWriteAction,
  proposeFreezeAction,
  proposeWriteAction,
  resolveFeatureAction,
  rollbackAction,
  startFreezeAction,
  stopFreezeAction,
  type WriteApproval,
} from './action-executor.js';
import type { FreezeProposal, LiveWriteProposal } from '../live-memory/types.js';
import type { TrainerRuntimeCapabilities } from './capabilities.js';
import { checkPreBindCompatibility, type CompatibilityDecision, type PreBindCompatibilityInput } from './compatibility.js';
import type { WriteConsentBinding } from '../consent/write-consent.js';
import { classifyLiveMemoryErrorString, runtimeError, type RuntimeError } from './errors.js';
import { createRuntimeFeatureState, invalidateAllFeatures, type RuntimeFeatureState } from './feature-runtime.js';
import type { SessionOwnership } from './ownership.js';
import { assertTransition, canTransition, type RuntimeLifecycleState } from './state.js';
import { fail, ok, type RuntimeResult } from './types.js';

/**
 * Semantic validation, separate from schema validation (which
 * migrateTrainerDefinition/schema.v1.ts already own). Catches configurations
 * that are individually schema-valid but cannot be executed:
 *   - a memory feature with neither an AOB signature nor a baseOffset can
 *     never resolve (mirrors feature-resolver.ts's own resolution
 *     requirement, checked here up front instead of only failing later);
 *   - duplicate feature/save-field IDs, which the schema does not forbid but
 *     which make per-feature runtime state ambiguous;
 *   - a save field with no mapping strategy at all is meaningless.
 * Returns an empty array when the definition is semantically valid.
 */
export function validateDefinitionSemantics(definition: SolithDefinitionV1): string[] {
  const issues: string[] = [];
  const seenFeatureIds = new Set<string>();

  for (const feature of definition.memoryFeatures ?? []) {
    if (seenFeatureIds.has(feature.id)) {
      issues.push(`Duplicate memoryFeatures id "${feature.id}".`);
    }
    seenFeatureIds.add(feature.id);

    if (feature.type !== 'scan_first' && feature.type !== 'scan_unknown') {
      if (!feature.resolution.signature && !feature.resolution.baseOffset) {
        issues.push(
          `Feature "${feature.id}" (${feature.type}) has neither an AOB signature nor a baseOffset — it can never resolve.`,
        );
      }
    }
  }

  const seenFieldIds = new Set<string>();
  for (const field of definition.saveEditor?.saveFields ?? []) {
    if (seenFieldIds.has(field.id)) {
      issues.push(`Duplicate saveEditor.saveFields id "${field.id}".`);
    }
    seenFieldIds.add(field.id);

    if (!field.mapping.searchKey && !field.mapping.hexOffset && !field.mapping.query) {
      issues.push(`Save field "${field.id}" declares no mapping strategy (searchKey/hexOffset/query).`);
    }
  }

  return issues;
}

/** Maps a non-compatible CompatibilityDecision onto the specific typed failure reason it represents. */
function compatibilityFailureReason(decision: CompatibilityDecision): Parameters<typeof runtimeError>[0] {
  if (decision.status === 'ambiguous') return 'IDENTITY_AMBIGUOUS';
  if (decision.status === 'unsupported') return 'INCOMPATIBLE_GAME';
  const auth = decision.processAuthorization;
  const isRoleRejection = auth && !auth.allowed && auth.blockedKind !== 'invalid_pid' && auth.blockedKind !== 'no_executable_name';
  return isRoleRejection ? 'EXECUTABLE_ROLE_REJECTED' : 'INCOMPATIBLE_EXECUTABLE';
}

/**
 * P4-13 (mission §6): `scan_first`/`scan_unknown` features have no static
 * resolution strategy (no AOB signature, no baseOffset — see
 * resolveFeatureAction, which fails them closed on purpose) but ARE
 * legitimately writable/freezable once a real Phase 2 discovery/scan result
 * has been handed to the runtime via `seedDiscoveredFeatureAddress()` below,
 * which is the only thing that can ever move such a feature's
 * `resolution.state` to 'resolved'. Until seeded, the existing
 * `if (feature.resolution.state !== 'resolved') resolveFeatureAction(...)`
 * guard in every action method below still runs and still fails closed
 * (TARGET_RESOLUTION_FAILED) — so widening these gates does not weaken
 * `requiresDiscovery` or fabricate a target; it only stops rejecting a
 * discovery-backed feature before resolution is even attempted.
 */
function isWritableFeatureType(type: RuntimeFeatureState['definition']['type']): boolean {
  return type === 'toggle' || type === 'write_once' || type === 'scan_first' || type === 'scan_unknown';
}

function isFreezableFeatureType(type: RuntimeFeatureState['definition']['type']): boolean {
  return type === 'freeze' || type === 'scan_first' || type === 'scan_unknown';
}

export interface BindTarget extends PreBindCompatibilityInput {
  executablePath?: string | null;
  startTime?: string;
  volumeSerialNumber?: string;
  fileIndex?: string;
  exeSha256?: string;
}

/**
 * Canonical trainer runtime: composes the P4-2 migration pipeline and the
 * real live-memory capability boundary through an explicit lifecycle. Owns
 * NO memory scanning/writing/freezing logic of its own — every operation
 * that touches a process delegates to `TrainerRuntimeCapabilities`.
 */
export class TrainerRuntime {
  private state: RuntimeLifecycleState = 'UNLOADED';
  private definition: SolithDefinitionV1 | null = null;
  private compatibility: CompatibilityDecision | null = null;
  private readonly features = new Map<string, RuntimeFeatureState>();
  private lastFailure: RuntimeError | null = null;
  /** Set explicitly by bind()/bindExisting() — never implicit. See ownership.ts. */
  private ownership: SessionOwnership | null = null;

  constructor(private readonly capabilities: TrainerRuntimeCapabilities) {}

  getState(): RuntimeLifecycleState {
    return this.state;
  }

  getDefinition(): SolithDefinitionV1 | null {
    return this.definition;
  }

  getCompatibilityDecision(): CompatibilityDecision | null {
    return this.compatibility;
  }

  getFeatureState(featureId: string): RuntimeFeatureState | undefined {
    return this.features.get(featureId);
  }

  /** Renderer-safe: which feature ids are currently ACTIVE (write-committed or freeze-running). */
  getActiveFeatureIds(): string[] {
    return [...this.features.entries()].filter(([, f]) => f.activation.state === 'active').map(([id]) => id);
  }

  /** Renderer-safe process identity summary — no raw handles. Null when not bound. */
  getAttachedIdentitySummary(): { pid: number; executableName: string } | null {
    const identity = this.capabilities.getAttachedIdentity();
    return identity ? { pid: identity.pid, executableName: identity.executableName } : null;
  }

  getLastFailure(): RuntimeError | null {
    return this.lastFailure;
  }

  /** Null before any bind attempt. See ownership.ts for OWNED/BORROWED semantics. */
  getOwnership(): SessionOwnership | null {
    return this.ownership;
  }

  private transitionTo(next: RuntimeLifecycleState): void {
    assertTransition(this.state, next);
    this.state = next;
  }

  private failClosed(reason: Parameters<typeof runtimeError>[0], message: string, detail?: unknown): RuntimeResult<never> {
    const error = runtimeError(reason, message, detail);
    this.lastFailure = error;
    if (canTransition(this.state, 'FAILED')) {
      this.state = 'FAILED';
    }
    return fail(error);
  }

  private requireState(...allowed: RuntimeLifecycleState[]): RuntimeResult<void> | null {
    if (allowed.includes(this.state)) return null;
    return this.failClosed(
      'INVALID_STATE_TRANSITION',
      `Operation requires state in [${allowed.join(', ')}], but runtime is ${this.state}.`,
    );
  }

  /** UNLOADED -> LOADED. Always goes through the P4-2 migration pipeline — never a raw schema.v1 parse. */
  load(rawInput: unknown): RuntimeResult<SolithDefinitionV1> {
    const guard = this.requireState('UNLOADED');
    if (guard) return guard as RuntimeResult<SolithDefinitionV1>;

    const migration = migrateTrainerDefinition(rawInput);
    if (migration.success === false) {
      const reason = migration.reason === 'UNKNOWN_FUTURE_VERSION' ? 'INVALID_SCHEMA' : migration.reason === 'SCHEMA_VALIDATION_FAILED' ? 'INVALID_SCHEMA' : 'MIGRATION_FAILED';
      return this.failClosed(reason, migration.errors.join('; ') || 'Trainer definition migration failed.', migration);
    }

    this.definition = migration.definition;
    this.transitionTo('LOADED');
    return ok(migration.definition);
  }

  /** LOADED -> VALIDATED. */
  validate(): RuntimeResult<void> {
    const guard = this.requireState('LOADED');
    if (guard) return guard;

    const issues = validateDefinitionSemantics(this.definition!);
    if (issues.length > 0) {
      return this.failClosed('SEMANTIC_INVALID', issues.join('; '), issues);
    }

    this.transitionTo('VALIDATED');
    return ok(undefined);
  }

  /**
   * VALIDATED -> COMPATIBILITY_CHECKED. Fails closed for anything other than
   * 'compatible' — an ambiguous or unverifiable identity is never treated as
   * good enough to proceed.
   */
  checkCompatibility(input: PreBindCompatibilityInput): RuntimeResult<CompatibilityDecision> {
    const guard = this.requireState('VALIDATED');
    if (guard) return guard as RuntimeResult<CompatibilityDecision>;

    const decision = checkPreBindCompatibility(this.definition!, input);
    this.compatibility = decision;
    if (decision.status !== 'compatible') {
      return this.failClosed(compatibilityFailureReason(decision), decision.reason, decision);
    }

    this.transitionTo('COMPATIBILITY_CHECKED');
    return ok(decision);
  }

  /** COMPATIBILITY_CHECKED -> BOUND. Delegates enforcement (incl. protected-target module scan) to the real attach(). */
  async bind(target: BindTarget, userConfirmedOffline: boolean): Promise<RuntimeResult<void>> {
    const guard = this.requireState('COMPATIBILITY_CHECKED');
    if (guard) return guard;

    const processTarget: LiveProcessTarget = {
      pid: target.pid,
      executableName: target.executableName,
      executablePath: target.executablePath ?? undefined,
      startTime: target.startTime,
      volumeSerialNumber: target.volumeSerialNumber,
      fileIndex: target.fileIndex,
      exeSha256: target.exeSha256,
    };

    const result = await this.capabilities.attach(processTarget, userConfirmedOffline, {
      executableHashSHA256: target.executableHashSHA256 ?? undefined,
      executableHashPrefixes: this.definition!.executableHashPrefixes,
      targetSHA256: this.definition!.targetSHA256,
      driftAcknowledged: target.driftAcknowledged,
      connectionBaseline: this.definition!.connectionBaseline,
      catalogGameId: this.definition!.id,
    });

    if (!result.success) {
      if (!result.guard.allowed) {
        return this.failClosed('CONSENT_REQUIRED', result.guard.reason, result);
      }
      return this.failClosed(classifyLiveMemoryErrorString(result.error), result.error ?? 'Attach failed.', result);
    }

    for (const feature of this.definition!.memoryFeatures ?? []) {
      this.features.set(feature.id, createRuntimeFeatureState(feature));
    }
    this.ownership = 'OWNED';
    this.transitionTo('BOUND');
    this.transitionTo('READY');
    return ok(undefined);
  }

  /**
   * COMPATIBILITY_CHECKED -> BOUND, reusing an already-attached session
   * instead of performing a second `attach()` (the P4-10 fix for the P4-9
   * blocker: `bind()` used to be the only entry point, and it always
   * attached itself).
   *
   * Preconditions the caller is responsible for: `checkCompatibility()` has
   * already re-run target-authorization + executable-fingerprint checks
   * against `target` (identical to what `bind()` runs pre-attach — same
   * `checkPreBindCompatibility` call, just fed from the borrowed session's
   * own known identity instead of a fresh process-picker selection). The one
   * gate `bind()` gets that this method cannot re-run is the driver-level
   * protected-target module scan, which is inherently bind-time-only (see
   * compatibility.ts) — it is preserved BY CONSTRUCTION here, not skipped:
   * `verifyIdentity()` below proves the live process is still the exact
   * (pid, executableName, path, startTime) tuple that already passed
   * protected-target at the session's own original attach(), and the
   * pid/executableName cross-check against `target` refuses to bind onto a
   * session whose live identity doesn't match what was just compatibility
   * checked.
   */
  async bindExisting(target: Pick<BindTarget, 'pid' | 'executableName'>): Promise<RuntimeResult<void>> {
    const guard = this.requireState('COMPATIBILITY_CHECKED');
    if (guard) return guard;

    if (!this.capabilities.isAttached()) {
      return this.failClosed('CAPABILITY_UNAVAILABLE', 'No existing attached session available to borrow.');
    }

    const identityError = this.capabilities.verifyIdentity();
    if (identityError) {
      return this.failClosed('PROCESS_LOST', identityError);
    }

    const attached = this.capabilities.getAttachedIdentity();
    if (
      !attached ||
      attached.pid !== target.pid ||
      attached.executableName.toLowerCase() !== target.executableName.toLowerCase()
    ) {
      return this.failClosed(
        'AUTHORIZATION_FAILED',
        'Borrowed session identity does not match the compatibility-checked target; refusing to bind.',
      );
    }

    for (const feature of this.definition!.memoryFeatures ?? []) {
      this.features.set(feature.id, createRuntimeFeatureState(feature));
    }
    this.ownership = 'BORROWED';
    this.transitionTo('BOUND');
    this.transitionTo('READY');
    return ok(undefined);
  }

  /** Resolves a feature's target address on demand (lazy, same as the real session's own cache-on-first-use). */
  async resolveFeature(featureId: string): Promise<RuntimeResult<void>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) {
      return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    }
    const result = await resolveFeatureAction(this.capabilities, feature);
    if (result.success === false) return fail(result.error);
    return ok(undefined);
  }

  /**
   * Canonical discovery handoff (P4-13 mission §6): records the address a
   * legitimate Phase 2 discovery/scan workflow already confirmed, so the
   * next write/freeze dispatch treats this `scan_first`/`scan_unknown`
   * feature as resolved instead of requiring a static AOB/pointer path it
   * was never defined with. Refused for any feature that has its own real
   * resolution strategy (toggle/write_once/freeze) — those must always
   * resolve through the real capability, never accept a caller-supplied
   * override address (a fixed AOB/pointer-backed feature accepting an
   * arbitrary renderer-chosen address would let a compromised renderer
   * redirect a canonical write anywhere, which this method exists
   * specifically to avoid — see mission §18 "no silent fallback" and its
   * "do not fabricate canonical targets" sibling rule).
   */
  seedDiscoveredFeatureAddress(featureId: string, address: LiveMemoryAddress): RuntimeResult<void> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    if (feature.definition.type !== 'scan_first' && feature.definition.type !== 'scan_unknown') {
      return this.failClosed(
        'UNSUPPORTED_ACTION',
        `Feature "${featureId}" (${feature.definition.type}) resolves via its own static definition and cannot accept a discovered-address override.`,
      );
    }
    feature.resolution = { state: 'resolved', address };
    return ok(undefined);
  }

  /** READY/ACTIVE -> ACTIVE. Dispatches `toggle`/`write_once`; resolves the feature first if needed. */
  async activateWriteFeature(featureId: string, requestedValue: number, approval: WriteApproval, reason?: string): Promise<RuntimeResult<void>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    if (!isWritableFeatureType(feature.definition.type)) {
      return this.failClosed('UNSUPPORTED_ACTION', `Feature "${featureId}" is type "${feature.definition.type}", not a write action.`);
    }

    if (feature.resolution.state !== 'resolved') {
      const resolved = await resolveFeatureAction(this.capabilities, feature);
      if (resolved.success === false) return fail(resolved.error);
    }

    const result = await dispatchWriteAction(this.capabilities, feature, requestedValue, approval, reason);
    if (result.success === false) {
      this.degradeOnProcessLoss(result.error);
      return fail(result.error);
    }
    if (this.state === 'READY') this.transitionTo('ACTIVE');
    return ok(undefined);
  }

  /** READY/ACTIVE -> ACTIVE. Dispatches `freeze`; token-gated, no legacy-approval bypass (matches MemoryManager.freezeStart). */
  async activateFreezeFeature(
    featureId: string,
    value: number,
    approval: { consentToken: string; consentBinding: WriteConsentBinding },
    intervalMs?: number,
  ): Promise<RuntimeResult<void>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    if (!isFreezableFeatureType(feature.definition.type)) {
      return this.failClosed('UNSUPPORTED_ACTION', `Feature "${featureId}" is type "${feature.definition.type}", not freeze.`);
    }

    if (feature.resolution.state !== 'resolved') {
      const resolved = await resolveFeatureAction(this.capabilities, feature);
      if (resolved.success === false) return fail(resolved.error);
    }

    const result = await startFreezeAction(this.capabilities, feature, value, approval, intervalMs);
    if (result.success === false) {
      this.degradeOnProcessLoss(result.error);
      return fail(result.error);
    }
    if (this.state === 'READY') this.transitionTo('ACTIVE');
    return ok(undefined);
  }

  /**
   * READY/ACTIVE -> READY/ACTIVE (no state change on its own). Propose-only
   * half of a write (P4-10) — resolves the feature if needed, stages a real
   * proposal, and returns it so the caller (IPC layer) can request a consent
   * token bound to this exact proposalId/address/value before calling
   * `confirmWriteFeature`. Mirrors the existing Phase 2
   * propose -> issue-consent -> confirm shape instead of inventing a new one.
   */
  async proposeWriteFeature(featureId: string, requestedValue: number, reason?: string): Promise<RuntimeResult<LiveWriteProposal>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard as RuntimeResult<LiveWriteProposal>;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    if (!isWritableFeatureType(feature.definition.type)) {
      return this.failClosed('UNSUPPORTED_ACTION', `Feature "${featureId}" is type "${feature.definition.type}", not a write action.`);
    }

    if (feature.resolution.state !== 'resolved') {
      const resolved = await resolveFeatureAction(this.capabilities, feature);
      if (resolved.success === false) return fail(resolved.error);
    }

    return proposeWriteAction(this.capabilities, feature, requestedValue, reason);
  }

  /**
   * Confirm-only half of a write (P4-10). `proposalId` must match the one
   * `proposeWriteFeature` returned for this feature — refused otherwise,
   * fail-closed, so a caller can never confirm an unrelated/stale proposal
   * under a different feature's identity.
   */
  async confirmWriteFeature(featureId: string, proposalId: string, approval: WriteApproval, reason?: string): Promise<RuntimeResult<void>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    if (feature.activation.proposalId !== proposalId) {
      return this.failClosed('INVALID_STATE_TRANSITION', `Proposal "${proposalId}" does not match the pending proposal for feature "${featureId}".`);
    }

    const result = await confirmWriteAction(this.capabilities, feature, proposalId, approval, reason);
    if (result.success === false) {
      this.degradeOnProcessLoss(result.error);
      return fail(result.error);
    }
    if (this.state === 'READY') this.transitionTo('ACTIVE');
    return ok(undefined);
  }

  /** Propose-only half of a freeze (P4-10). See `proposeWriteFeature` for the consent-token rationale. */
  async proposeFreezeFeature(featureId: string, value: number, intervalMs?: number): Promise<RuntimeResult<FreezeProposal>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard as RuntimeResult<FreezeProposal>;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    if (!isFreezableFeatureType(feature.definition.type)) {
      return this.failClosed('UNSUPPORTED_ACTION', `Feature "${featureId}" is type "${feature.definition.type}", not freeze.`);
    }

    if (feature.resolution.state !== 'resolved') {
      const resolved = await resolveFeatureAction(this.capabilities, feature);
      if (resolved.success === false) return fail(resolved.error);
    }

    return proposeFreezeAction(this.capabilities, feature, value, intervalMs);
  }

  /** Confirm-only half of a freeze (P4-10). Same proposalId cross-check as `confirmWriteFeature`. */
  async confirmFreezeFeature(
    featureId: string,
    proposalId: string,
    approval: { consentToken: string; consentBinding: WriteConsentBinding },
  ): Promise<RuntimeResult<void>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);
    if (feature.activation.proposalId !== proposalId) {
      return this.failClosed('INVALID_STATE_TRANSITION', `Proposal "${proposalId}" does not match the pending proposal for feature "${featureId}".`);
    }

    const result = await confirmFreezeAction(this.capabilities, feature, proposalId, approval);
    if (result.success === false) {
      this.degradeOnProcessLoss(result.error);
      return fail(result.error);
    }
    if (this.state === 'READY') this.transitionTo('ACTIVE');
    return ok(undefined);
  }

  /** Stops an active freeze feature. ACTIVE -> READY if this was the last active feature. */
  deactivateFreezeFeature(featureId: string): RuntimeResult<void> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);

    stopFreezeAction(this.capabilities, feature);
    this.maybeReturnToReady();
    return ok(undefined);
  }

  /** Rolls back a previously-confirmed write on this feature. Available in READY or ACTIVE. */
  async rollbackFeature(featureId: string, proposalId: string): Promise<RuntimeResult<void>> {
    const guard = this.requireState('READY', 'ACTIVE');
    if (guard) return guard;
    const feature = this.features.get(featureId);
    if (!feature) return this.failClosed('SEMANTIC_INVALID', `Unknown feature id "${featureId}".`);

    const result = await rollbackAction(this.capabilities, feature, proposalId);
    if (result.success === false) {
      this.degradeOnProcessLoss(result.error);
      return fail(result.error);
    }
    this.maybeReturnToReady();
    return ok(undefined);
  }

  /**
   * P4-10 (mission §12): a single-action failure whose reason is
   * PROCESS_LOST means the same thing a composite transaction's own
   * `degradeRuntime()` already treats it as — the attached process is gone.
   * Before this, only the composite-transaction path degraded the runtime on
   * process loss; a single write/freeze/rollback could fail with
   * PROCESS_LOST and leave the runtime reporting READY/ACTIVE, contradicting
   * the live session underneath. No-op for any other failure reason —
   * per-operation failures that aren't about the process being gone do not
   * force a state transition (see state.ts's own documented philosophy).
   */
  private degradeOnProcessLoss(error: RuntimeError): void {
    if (error.reason !== 'PROCESS_LOST') return;
    if (this.state !== 'BOUND' && this.state !== 'READY' && this.state !== 'ACTIVE') return;
    this.handleProcessLoss(error.message, error);
  }

  private maybeReturnToReady(): void {
    if (this.state !== 'ACTIVE') return;
    const stillActive = [...this.features.values()].some((f) => f.activation.state === 'active');
    if (!stillActive) this.transitionTo('READY');
  }

  /**
   * Process loss / identity mismatch: READY/ACTIVE/BOUND -> DEGRADED. Stops
   * any active freeze and invalidates resolved addresses so no further
   * action can be dispatched against a stale process without an explicit
   * rebind + fresh compatibility check.
   */
  handleProcessLoss(
    reason = 'Attached process identity could not be reverified.',
    errorOverride?: RuntimeError,
  ): RuntimeResult<void> {
    const guard = this.requireState('BOUND', 'READY', 'ACTIVE');
    if (guard) return guard;
    this.capabilities.stopFreeze();
    invalidateAllFeatures(this.features);
    this.lastFailure = errorOverride ?? runtimeError('PROCESS_LOST', reason);
    this.transitionTo('DEGRADED');
    return ok(undefined);
  }

  /**
   * Checks whether the bound process is still the one this runtime attached
   * to. Callers should invoke this before dispatching an action against a
   * long-lived session; on mismatch this transitions straight to DEGRADED
   * (see handleProcessLoss) rather than leaving the caller to guess.
   */
  verifyProcessStillBound(): RuntimeResult<void> {
    const guard = this.requireState('BOUND', 'READY', 'ACTIVE');
    if (guard) return guard;
    const identityError = this.capabilities.verifyIdentity();
    if (identityError) {
      this.handleProcessLoss(identityError);
      return fail(runtimeError('PROCESS_LOST', identityError));
    }
    return ok(undefined);
  }

  /**
   * DEGRADED -> VALIDATED -> COMPATIBILITY_CHECKED: re-run compatibility
   * before any rebind attempt. The definition itself did not change (no
   * re-validation of its structure is needed), but a rebind must not skip
   * straight past a fresh compatibility decision just because one was made
   * before the process was lost.
   */
  recheckCompatibilityAfterLoss(input: PreBindCompatibilityInput): RuntimeResult<CompatibilityDecision> {
    const guard = this.requireState('DEGRADED');
    if (guard) return guard as RuntimeResult<CompatibilityDecision>;
    this.transitionTo('VALIDATED');
    return this.checkCompatibility(input);
  }

  /**
   * Full teardown from any non-terminal state. Always safe to call.
   *
   * Ownership-aware (P4-10 mission §7/§13): an OWNED runtime detaches the
   * session it attached itself. A BORROWED runtime must never destroy a
   * session it does not own — the session bundle that lent it out (P4-10's
   * per-sender session in electron/live-memory-ipc.ts) remains responsible
   * for that. A borrowed runtime does stop any freeze IT started, so
   * disposing this runtime instance never leaves an orphan freeze tied to
   * app state nothing tracks anymore, without touching the session itself.
   */
  dispose(): void {
    if (this.state === 'DISPOSED') return;
    if (canTransition(this.state, 'DISPOSED')) {
      if (this.capabilities.isAttached()) {
        if (this.ownership === 'OWNED') {
          this.capabilities.detach();
        } else {
          this.capabilities.stopFreeze();
        }
      }
      this.features.clear();
      this.state = 'DISPOSED';
    }
  }
}
