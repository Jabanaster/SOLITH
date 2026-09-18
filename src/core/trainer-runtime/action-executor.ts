import type { WriteConsentBinding } from '../consent/write-consent.js';
import type {
  FreezeProposal,
  FreezeStatus,
  LiveMemoryAddress,
  LiveWriteProposal,
  LiveWriteManifest,
} from '../live-memory/types.js';
import type { WriteCallOptions } from '../live-memory/memory-manager.js';
import type { TrainerRuntimeCapabilities } from './capabilities.js';
import { classifyLiveMemoryErrorString, runtimeError } from './errors.js';
import type { RuntimeFeatureState } from './feature-runtime.js';
import { fail, ok, type RuntimeResult } from './types.js';

/**
 * How a caller supplies proof of user consent for a write. `'approved'` is
 * the legacy/library/test path (MemoryManager.confirmWrite's `userApproved`
 * bypass); a real interactive caller (the Electron IPC layer, out of this
 * module's scope) supplies a `'token'` obtained from its own native-dialog
 * consent flow. Freeze has NO legacy bypass in the real system
 * (MemoryManager.freezeStart always requires a token) — see
 * `startFreezeAction` below, which only accepts the token form.
 */
export type WriteApproval = { kind: 'approved' } | { kind: 'token'; consentToken: string; consentBinding: WriteConsentBinding };

function writeCallOptions(
  approval: WriteApproval,
  base: { featureId?: string; reason?: string; writeIntent: 'stage' | 'commit' },
): WriteCallOptions {
  if (approval.kind === 'token') {
    return { ...base, consentToken: approval.consentToken, consentBinding: approval.consentBinding };
  }
  return { ...base, userApproved: true };
}

/**
 * Resolves a feature's target address through the capability boundary.
 * `scan_first`/`scan_unknown` features are never resolved here — they
 * require the Discovery Lab scan workflow first, exactly like
 * feature-resolver.ts's own real behavior; this reports that fact as a typed
 * failure instead of attempting (and failing) a resolve call.
 */
export async function resolveFeatureAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
): Promise<RuntimeResult<LiveMemoryAddress>> {
  if (feature.definition.type === 'scan_first' || feature.definition.type === 'scan_unknown') {
    const error = runtimeError(
      'TARGET_RESOLUTION_FAILED',
      `Feature "${feature.definition.id}" (${feature.definition.type}) requires discovery scanning before it can be resolved.`,
    );
    feature.resolution = { state: 'failed', error };
    return fail(error);
  }

  feature.resolution = { state: 'resolving' };
  try {
    const address = await capabilities.resolveFeature(feature.definition);
    feature.resolution = { state: 'resolved', address };
    return ok(address);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = runtimeError('TARGET_RESOLUTION_FAILED', message);
    feature.resolution = { state: 'failed', error };
    return fail(error);
  }
}

/** Dispatches a `toggle` / `write_once` feature: resolve (if needed) -> propose -> confirm. */
export async function dispatchWriteAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
  requestedValue: number,
  approval: WriteApproval,
  reason?: string,
): Promise<RuntimeResult<LiveWriteManifest>> {
  if (feature.resolution.state !== 'resolved' || !feature.resolution.address) {
    const error = runtimeError(
      'TARGET_RESOLUTION_FAILED',
      `Feature "${feature.definition.id}" has no resolved target address; resolve it before dispatching an action.`,
    );
    feature.activation = { state: 'failed', error };
    return fail(error);
  }
  const address = feature.resolution.address;
  feature.activation = { state: 'activating' };

  let proposalId: string;
  try {
    const proposal = capabilities.proposeWrite(address, requestedValue, {
      featureId: feature.definition.id,
      reason,
      writeIntent: 'stage',
    });
    proposalId = proposal.proposalId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = runtimeError(classifyLiveMemoryErrorString(message), message);
    feature.activation = { state: 'failed', error };
    return fail(error);
  }

  feature.activation = { state: 'activating', proposalId };
  const confirm = await capabilities.confirmWrite(
    proposalId,
    writeCallOptions(approval, { featureId: feature.definition.id, reason, writeIntent: 'commit' }),
  );
  if (!confirm.success || !confirm.manifest) {
    const error = runtimeError(classifyLiveMemoryErrorString(confirm.error), confirm.error ?? 'Write confirmation failed.');
    feature.activation = { state: 'failed', proposalId, error };
    return fail(error);
  }

  feature.activation = { state: 'active', proposalId };
  return ok(confirm.manifest);
}

/**
 * P4-10: propose-only half of a write, split out of `dispatchWriteAction` so
 * a real consent token can be issued (and later verified) against the exact
 * proposalId this call creates — the same propose -> issue-consent -> confirm
 * shape `electron/live-memory-ipc.ts` already uses for raw-address writes.
 * `dispatchWriteAction` above is unchanged and still used for the
 * already-approved / composite-transaction / legacy-library paths.
 */
export async function proposeWriteAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
  requestedValue: number,
  reason?: string,
): Promise<RuntimeResult<LiveWriteProposal>> {
  if (feature.resolution.state !== 'resolved' || !feature.resolution.address) {
    const error = runtimeError(
      'TARGET_RESOLUTION_FAILED',
      `Feature "${feature.definition.id}" has no resolved target address; resolve it before proposing a write.`,
    );
    feature.activation = { state: 'failed', error };
    return fail(error);
  }
  const address = feature.resolution.address;
  feature.activation = { state: 'activating' };

  try {
    const proposal = capabilities.proposeWrite(address, requestedValue, {
      featureId: feature.definition.id,
      reason,
      writeIntent: 'stage',
    });
    feature.activation = { state: 'activating', proposalId: proposal.proposalId };
    return ok(proposal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = runtimeError(classifyLiveMemoryErrorString(message), message);
    feature.activation = { state: 'failed', error };
    return fail(error);
  }
}

/**
 * P4-10: confirm-only half of a write. `proposalId` must be the one
 * `proposeWriteAction` returned for this same feature — enforced by the
 * caller (`TrainerRuntime.confirmWriteFeature`) checking it against
 * `feature.activation.proposalId` before this is reached.
 */
export async function confirmWriteAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
  proposalId: string,
  approval: WriteApproval,
  reason?: string,
): Promise<RuntimeResult<LiveWriteManifest>> {
  const confirm = await capabilities.confirmWrite(
    proposalId,
    writeCallOptions(approval, { featureId: feature.definition.id, reason, writeIntent: 'commit' }),
  );
  if (!confirm.success || !confirm.manifest) {
    const error = runtimeError(classifyLiveMemoryErrorString(confirm.error), confirm.error ?? 'Write confirmation failed.');
    feature.activation = { state: 'failed', proposalId, error };
    return fail(error);
  }

  feature.activation = { state: 'active', proposalId };
  return ok(confirm.manifest);
}

/** Dispatches a `freeze` feature: resolve (if needed) -> propose freeze -> start (token-gated, no legacy bypass). */
export async function startFreezeAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
  value: number,
  approval: { consentToken: string; consentBinding: WriteConsentBinding },
  intervalMs?: number,
): Promise<RuntimeResult<void>> {
  if (feature.resolution.state !== 'resolved' || !feature.resolution.address) {
    const error = runtimeError(
      'TARGET_RESOLUTION_FAILED',
      `Feature "${feature.definition.id}" has no resolved target address; resolve it before starting a freeze.`,
    );
    feature.activation = { state: 'failed', error };
    return fail(error);
  }
  const address = feature.resolution.address;
  feature.activation = { state: 'activating' };

  let proposalId: string;
  try {
    const proposal = capabilities.proposeFreeze(address, value, intervalMs);
    proposalId = proposal.proposalId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = runtimeError(classifyLiveMemoryErrorString(message), message);
    feature.activation = { state: 'failed', error };
    return fail(error);
  }

  const start = await capabilities.freezeStart(proposalId, {
    consentToken: approval.consentToken,
    consentBinding: approval.consentBinding,
    featureId: feature.definition.id,
  });
  if (!start.success) {
    const error = runtimeError(classifyLiveMemoryErrorString(start.error), start.error ?? 'Freeze start failed.');
    feature.activation = { state: 'failed', error };
    return fail(error);
  }

  feature.activation = { state: 'active', freezeActive: true };
  return ok(undefined);
}

/**
 * P4-10: propose-only half of a freeze, split out of `startFreezeAction` for
 * the same real-consent-token reason as `proposeWriteAction`.
 * `startFreezeAction` above is unchanged.
 */
export async function proposeFreezeAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
  value: number,
  intervalMs?: number,
): Promise<RuntimeResult<FreezeProposal>> {
  if (feature.resolution.state !== 'resolved' || !feature.resolution.address) {
    const error = runtimeError(
      'TARGET_RESOLUTION_FAILED',
      `Feature "${feature.definition.id}" has no resolved target address; resolve it before proposing a freeze.`,
    );
    feature.activation = { state: 'failed', error };
    return fail(error);
  }
  const address = feature.resolution.address;
  feature.activation = { state: 'activating' };

  try {
    const proposal = capabilities.proposeFreeze(address, value, intervalMs);
    feature.activation = { state: 'activating', proposalId: proposal.proposalId };
    return ok(proposal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = runtimeError(classifyLiveMemoryErrorString(message), message);
    feature.activation = { state: 'failed', error };
    return fail(error);
  }
}

/**
 * P4-10: confirm-only half of a freeze. `proposalId` must be the one
 * `proposeFreezeAction` returned for this same feature.
 */
export async function confirmFreezeAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
  proposalId: string,
  approval: { consentToken: string; consentBinding: WriteConsentBinding },
): Promise<RuntimeResult<void>> {
  const start = await capabilities.freezeStart(proposalId, {
    consentToken: approval.consentToken,
    consentBinding: approval.consentBinding,
    featureId: feature.definition.id,
  });
  if (!start.success) {
    const error = runtimeError(classifyLiveMemoryErrorString(start.error), start.error ?? 'Freeze start failed.');
    feature.activation = { state: 'failed', proposalId, error };
    return fail(error);
  }

  feature.activation = { state: 'active', freezeActive: true };
  return ok(undefined);
}

/** Stops whatever freeze is currently active on the session (safe to call even if none is). */
export function stopFreezeAction(capabilities: TrainerRuntimeCapabilities, feature: RuntimeFeatureState): FreezeStatus {
  const status = capabilities.stopFreeze();
  feature.activation = { state: 'inactive' };
  return status;
}

export async function rollbackAction(
  capabilities: TrainerRuntimeCapabilities,
  feature: RuntimeFeatureState,
  proposalId: string,
): Promise<RuntimeResult<LiveWriteManifest>> {
  const result = await capabilities.rollback(proposalId, feature.definition.id);
  if (!result.success || !result.manifest) {
    const error = runtimeError(classifyLiveMemoryErrorString(result.error), result.error ?? 'Rollback failed.');
    return fail(error);
  }
  feature.activation = { state: 'inactive' };
  return ok(result.manifest);
}
