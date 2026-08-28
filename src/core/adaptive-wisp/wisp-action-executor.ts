import { validateWispBinding } from './binding-validation.js';
import { executionDiagnostic } from './execution-errors.js';
import type { WispActionExecutionRequest, WispActionExecutionResult, WispSafeDisplayValue } from './execution-types.js';
import { validateWispExecutionRequestShape } from './execution-types.js';
import type { WispTrainerEntryLookup } from './entry-lookup.js';
import type { WispGameIdentityBridge } from './game-identity-bridge.js';
import type { WispCanonicalWriteOutcome, WispTrainerExecutionAdapter, WispTrainerEntryState } from './trainer-execution-adapter.js';
import type { WispActionDefinition } from './types.js';
import type { WispRuntimeBinding, WispRuntimeContext } from './runtime-types.js';

/**
 * Adaptive Wisp action execution adapter (Increment 4, Sections 5-6, 26).
 *
 * Flow (Section 5): revalidate binding → re-resolve entry → verify
 * game/trainer/table identity (via binding validation) → verify
 * compatibility/availability → validate the requested control operation →
 * route into the injected canonical trainer execution adapter → normalize
 * the result. No direct memory calls anywhere in this module.
 *
 * "Binding valid when Wisp loaded" never implies "binding valid now"
 * (Section 6) — every call revalidates against the CURRENT context, not a
 * cached one, and re-resolves the entry fresh rather than trusting a
 * retained descriptor (Section 7).
 */
export interface WispActionExecutorDeps {
  entryLookup: WispTrainerEntryLookup;
  identityBridge: WispGameIdentityBridge;
  trainerAdapter: WispTrainerExecutionAdapter;
}

export async function executeWispAction(
  request: WispActionExecutionRequest,
  actionDefinition: WispActionDefinition,
  binding: WispRuntimeBinding,
  currentContext: WispRuntimeContext | null,
  deps: WispActionExecutorDeps,
): Promise<WispActionExecutionResult> {
  const shape = validateWispExecutionRequestShape(request);
  if (shape.ok === false) {
    return reject(request.actionId, executionDiagnostic('WISP_EXECUTION_REQUEST_SHAPE_REJECTED', `execution request contains a forbidden field "${shape.rejectedKey}"`, { actionId: request.actionId }));
  }

  const bindingCheck = validateWispBinding(binding, currentContext);
  if (bindingCheck.valid === false) {
    return {
      ok: false,
      actionId: request.actionId,
      status: 'stale',
      diagnostic: executionDiagnostic('WISP_EXECUTION_SESSION_CHANGED', bindingCheck.diagnostics[0]?.message ?? 'runtime binding is no longer valid', {
        actionId: request.actionId,
        entryId: binding.entryId,
        gameId: binding.gameId,
        profileId: request.profileId,
      }),
    };
  }

  if (deps.identityBridge.resolveCheatSystemGameId(binding.gameId) === null) {
    return unavailable(request.actionId, executionDiagnostic('WISP_EXECUTION_IDENTITY_MAPPING_MISSING', `no cheat-system GameId mapping exists for canonical game "${binding.gameId}"`, { actionId: request.actionId, gameId: binding.gameId }));
  }

  const entry = deps.entryLookup.resolveEntry(binding.gameId, binding.entryId);
  if (entry === null) {
    return unavailable(request.actionId, executionDiagnostic('WISP_EXECUTION_ENTRY_MISSING', `no trainer entry found for entryId "${binding.entryId}"`, { actionId: request.actionId, entryId: binding.entryId, gameId: binding.gameId }));
  }
  if (entry.enabled === false) {
    return unavailable(request.actionId, executionDiagnostic('WISP_EXECUTION_ENTRY_DISABLED', `trainer entry "${binding.entryId}" is disabled`, { actionId: request.actionId, entryId: binding.entryId, gameId: binding.gameId }));
  }

  const state = deps.trainerAdapter.getCurrentState(binding.gameId, binding.entryId);
  if (state === null) {
    return unavailable(request.actionId, executionDiagnostic('WISP_EXECUTION_ENTRY_MISSING', 'canonical trainer adapter could not resolve current state for this entry', { actionId: request.actionId, entryId: binding.entryId, gameId: binding.gameId }));
  }

  if (!state.supportsControls.includes(request.control)) {
    return unavailable(request.actionId, executionDiagnostic('WISP_EXECUTION_CONTROL_UNSUPPORTED', `entry does not support control type "${request.control}"`, { actionId: request.actionId, entryId: binding.entryId, gameId: binding.gameId, controlType: request.control }));
  }

  if (request.control === 'freeze') return handleFreeze(request, actionDefinition, binding, state, deps);
  return handleWrite(request, actionDefinition, binding, state, deps);
}

async function handleFreeze(
  request: Extract<WispActionExecutionRequest, { control: 'freeze' }>,
  actionDefinition: WispActionDefinition,
  binding: WispRuntimeBinding,
  state: WispTrainerEntryState,
  deps: WispActionExecutorDeps,
): Promise<WispActionExecutionResult> {
  if (!request.enable) {
    const outcome = deps.trainerAdapter.stopFreeze(binding.gameId, binding.entryId);
    return fromWriteOutcome(request.actionId, binding, outcome, 'WISP_EXECUTION_FREEZE_FAILED');
  }

  // Increment 4C: if the caller already holds a consent token bound to a
  // specific prior proposal, confirm that exact proposal — never re-propose
  // and confirm a different one under the same token (the real canonical
  // consent binding hashes in the exact proposalId, so a mismatch always
  // fails closed; re-proposing here would just waste the round-trip).
  if (request.consentToken !== undefined && request.proposalId !== undefined) {
    const outcome = await deps.trainerAdapter.confirmFreeze(request.proposalId, request.consentToken);
    return fromWriteOutcome(request.actionId, binding, outcome, 'WISP_EXECUTION_FREEZE_FAILED');
  }

  let value: WispSafeDisplayValue | undefined = state.currentValue;
  if (request.presetId !== undefined) {
    const presetValue = actionDefinition.presets?.find((p) => p.id === request.presetId)?.value;
    if (presetValue === undefined) return rejectInvalidPreset(request.actionId, binding, request.presetId);
    value = presetValue;
  }
  if (value === undefined || !validateValueForDataType(value, state.dataType)) {
    return rejectInvalidValue(request.actionId, binding);
  }

  const proposal = deps.trainerAdapter.proposeFreeze(binding.gameId, binding.entryId, value, request.intervalMs);
  if (proposal === null) return unavailable(request.actionId, executionDiagnostic('WISP_EXECUTION_CONTROL_UNSUPPORTED', 'freeze could not be proposed for this entry', { actionId: request.actionId, entryId: binding.entryId, gameId: binding.gameId }));

  if (request.consentToken === undefined) return pendingConsent(request.actionId, binding, proposal.proposalId, value);

  const outcome = await deps.trainerAdapter.confirmFreeze(proposal.proposalId, request.consentToken);
  return fromWriteOutcome(request.actionId, binding, outcome, 'WISP_EXECUTION_FREEZE_FAILED');
}

async function handleWrite(request: WispActionExecutionRequest, actionDefinition: WispActionDefinition, binding: WispRuntimeBinding, state: WispTrainerEntryState, deps: WispActionExecutorDeps): Promise<WispActionExecutionResult> {
  // Increment 4C: confirm the exact prior proposal when the caller already
  // holds a token bound to one — see the matching comment in handleFreeze.
  if (request.consentToken !== undefined && request.proposalId !== undefined) {
    const outcome = await deps.trainerAdapter.confirmWrite(request.proposalId, request.consentToken);
    return fromWriteOutcome(request.actionId, binding, outcome, 'WISP_EXECUTION_TRAINER_FAILED');
  }

  const computed = computeRequestedValue(request, actionDefinition, state);
  if (computed.ok === false) return computed.result(request.actionId, binding);

  const proposal = deps.trainerAdapter.proposeWrite(binding.gameId, binding.entryId, computed.value);
  if (proposal === null) return unavailable(request.actionId, executionDiagnostic('WISP_EXECUTION_CONTROL_UNSUPPORTED', `control "${request.control}" could not be proposed for this entry`, { actionId: request.actionId, entryId: binding.entryId, gameId: binding.gameId, controlType: request.control }));

  if (request.consentToken === undefined) return pendingConsent(request.actionId, binding, proposal.proposalId, computed.value);

  const outcome = await deps.trainerAdapter.confirmWrite(proposal.proposalId, request.consentToken);
  return fromWriteOutcome(request.actionId, binding, outcome, 'WISP_EXECUTION_TRAINER_FAILED');
}

type ComputeResult = { ok: true; value: WispSafeDisplayValue } | { ok: false; result: (actionId: string, binding: WispRuntimeBinding) => WispActionExecutionResult };

function computeRequestedValue(request: WispActionExecutionRequest, actionDefinition: WispActionDefinition, state: WispTrainerEntryState): ComputeResult {
  switch (request.control) {
    case 'toggle': {
      const next = !(state.enabled ?? false);
      return { ok: true, value: next };
    }
    case 'set': {
      if (!validateValueForDataType(request.value, state.dataType)) return { ok: false, result: (actionId, binding) => rejectInvalidValue(actionId, binding) };
      return { ok: true, value: request.value };
    }
    case 'increment': {
      const preset = actionDefinition.presets?.find((p) => p.id === request.presetId);
      if (!preset || typeof preset.value !== 'number' || !Number.isFinite(preset.value)) return { ok: false, result: (actionId, binding) => rejectInvalidPreset(actionId, binding, request.presetId) };
      const base = typeof state.currentValue === 'number' ? state.currentValue : 0;
      const next = base + preset.value;
      if (!Number.isFinite(next) || !validateValueForDataType(next, state.dataType)) return { ok: false, result: (actionId, binding) => rejectInvalidValue(actionId, binding) };
      return { ok: true, value: next };
    }
    case 'multiplier': {
      const preset = actionDefinition.presets?.find((p) => p.id === request.presetId);
      if (!preset || typeof preset.value !== 'number' || !Number.isFinite(preset.value)) return { ok: false, result: (actionId, binding) => rejectInvalidPreset(actionId, binding, request.presetId) };
      const base = typeof state.currentValue === 'number' ? state.currentValue : 0;
      const next = base * preset.value;
      if (!Number.isFinite(next) || !validateValueForDataType(next, state.dataType)) return { ok: false, result: (actionId, binding) => rejectInvalidValue(actionId, binding) };
      return { ok: true, value: next };
    }
    case 'cycle': {
      const presets = actionDefinition.presets ?? [];
      if (presets.length === 0) return { ok: false, result: (actionId, binding) => rejectInvalidPreset(actionId, binding, undefined) };
      const currentIndex = presets.findIndex((p) => p.value === state.currentValue);
      const next = presets[(currentIndex === -1 ? 0 : currentIndex + 1) % presets.length];
      if (!validateValueForDataType(next.value, state.dataType)) return { ok: false, result: (actionId, binding) => rejectInvalidValue(actionId, binding) };
      return { ok: true, value: next.value };
    }
    case 'momentary': {
      if (request.presetId === undefined) return { ok: false, result: (actionId, binding) => rejectInvalidPreset(actionId, binding, undefined) };
      const preset = actionDefinition.presets?.find((p) => p.id === request.presetId);
      if (!preset) return { ok: false, result: (actionId, binding) => rejectInvalidPreset(actionId, binding, request.presetId) };
      if (!validateValueForDataType(preset.value, state.dataType)) return { ok: false, result: (actionId, binding) => rejectInvalidValue(actionId, binding) };
      return { ok: true, value: preset.value };
    }
    case 'freeze':
      throw new Error('freeze is handled by handleFreeze, not computeRequestedValue');
  }
}

/** Numeric/bool/string range and finiteness validation by canonical LiveValueType — no reusable validator exists upstream (Section 6 audit finding), so this is Increment 4's own, narrow implementation. */
export function validateValueForDataType(value: WispSafeDisplayValue, dataType: string): boolean {
  switch (dataType) {
    case 'bool':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'int32':
      return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
    case 'uint32':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
    case 'byte':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
    case 'int64':
      return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);
    case 'float':
    case 'double':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' || typeof value === 'boolean';
  }
}

function fromWriteOutcome(actionId: string, binding: WispRuntimeBinding, outcome: WispCanonicalWriteOutcome, failureCode: 'WISP_EXECUTION_TRAINER_FAILED' | 'WISP_EXECUTION_FREEZE_FAILED'): WispActionExecutionResult {
  if (outcome.ok === true) return { ok: true, actionId, status: outcome.status, currentValue: outcome.currentValue };
  const code = outcome.status === 'rejected' ? 'WISP_EXECUTION_CONSENT_REJECTED' : failureCode;
  return { ok: false, actionId, status: outcome.status, diagnostic: executionDiagnostic(code, outcome.reason, { actionId, entryId: binding.entryId, gameId: binding.gameId }) };
}

function pendingConsent(actionId: string, binding: WispRuntimeBinding, proposalId: string, requestedValue: WispSafeDisplayValue): WispActionExecutionResult {
  return {
    ok: false,
    actionId,
    status: 'pending-consent',
    proposalId,
    requestedValue,
    diagnostic: executionDiagnostic('WISP_EXECUTION_CONSENT_REQUIRED', `proposal "${proposalId}" awaits an existing-workflow consent token`, { actionId, entryId: binding.entryId, gameId: binding.gameId }),
  };
}

function rejectInvalidPreset(actionId: string, binding: WispRuntimeBinding, presetId: string | undefined): WispActionExecutionResult {
  return { ok: false, actionId, status: 'rejected', diagnostic: executionDiagnostic('WISP_EXECUTION_INVALID_PRESET', `preset "${presetId ?? '(none supplied)'}" is not valid for this action/entry`, { actionId, entryId: binding.entryId, gameId: binding.gameId }) };
}

function rejectInvalidValue(actionId: string, binding: WispRuntimeBinding): WispActionExecutionResult {
  return { ok: false, actionId, status: 'rejected', diagnostic: executionDiagnostic('WISP_EXECUTION_INVALID_VALUE', 'requested value failed type/range/finiteness validation', { actionId, entryId: binding.entryId, gameId: binding.gameId }) };
}

function unavailable(actionId: string, diagnostic: ReturnType<typeof executionDiagnostic>): WispActionExecutionResult {
  return { ok: false, actionId, status: 'unavailable', diagnostic };
}

function reject(actionId: string, diagnostic: ReturnType<typeof executionDiagnostic>): WispActionExecutionResult {
  return { ok: false, actionId, status: 'rejected', diagnostic };
}
