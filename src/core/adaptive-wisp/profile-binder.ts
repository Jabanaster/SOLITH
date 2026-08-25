import type { CanonicalGameId, CanonicalTrainerEntryId, WispActionDefinition, WispActionId, WispControlType, WispGameProfile } from './types.js';
import { bindingDiagnostic, type WispBindingDiagnostic } from './binding-errors.js';
import type { WispTrainerEntryLookup } from './entry-lookup.js';
import type { BoundWispAction, BoundWispGroup, BoundWispProfile, WispActionAvailability, WispProfileBindingResult, WispRuntimeBinding, WispRuntimeContext } from './runtime-types.js';

/**
 * Adaptive Wisp runtime binding (Increment 3, Sections 6, 22-24, 51-54).
 *
 * Pure — no I/O, no registry access, no live process. Takes an already
 * resolved profile (see profile-resolver.ts) plus the current runtime
 * context and an injected entry-lookup, and produces an immutable
 * `BoundWispProfile`. Never executes anything — see errors.ts's sibling
 * comment in Section 25 of the spec: execution is Increment 4's job.
 */

export function bindResolvedProfile(resolvedProfile: WispGameProfile, runtimeContext: WispRuntimeContext | null, entryLookup: WispTrainerEntryLookup): WispProfileBindingResult {
  if (runtimeContext === null) {
    return {
      ok: false,
      diagnostics: [bindingDiagnostic('WISP_BINDING_SESSION_MISSING', 'no current runtime session — fail closed', { profileId: resolvedProfile.profileId, gameId: resolvedProfile.gameId })],
    };
  }

  // Profile-level trust-boundary checks (Section 23) — a mismatch here rejects the
  // whole profile rather than degrading individual actions, because gameId/
  // trainerId/tableId are profile-scoped constraints, not per-action ones.
  if (resolvedProfile.gameId !== runtimeContext.gameId) {
    return {
      ok: false,
      diagnostics: [
        bindingDiagnostic('WISP_BINDING_GAME_MISMATCH', `profile gameId "${resolvedProfile.gameId}" does not match runtime gameId "${runtimeContext.gameId}"`, {
          profileId: resolvedProfile.profileId,
          gameId: resolvedProfile.gameId,
        }),
      ],
    };
  }
  if (resolvedProfile.trainerId !== undefined && resolvedProfile.trainerId !== runtimeContext.trainerId) {
    return {
      ok: false,
      diagnostics: [bindingDiagnostic('WISP_BINDING_TRAINER_MISMATCH', 'profile trainerId does not match the active trainer context', { profileId: resolvedProfile.profileId, gameId: resolvedProfile.gameId })],
    };
  }
  if (resolvedProfile.tableId !== undefined && resolvedProfile.tableId !== runtimeContext.tableId) {
    return {
      ok: false,
      diagnostics: [bindingDiagnostic('WISP_BINDING_TABLE_MISMATCH', 'profile tableId does not match the active table context', { profileId: resolvedProfile.profileId, gameId: resolvedProfile.gameId })],
    };
  }

  const diagnostics: WispBindingDiagnostic[] = [];
  const actions: BoundWispAction[] = resolvedProfile.actions.map((action) => {
    const bound = bindSingleAction(action, resolvedProfile.gameId, runtimeContext, entryLookup);
    if (bound.diagnostics) diagnostics.push(...bound.diagnostics);
    return bound;
  });

  const groups: BoundWispGroup[] = resolvedProfile.groups.map((group) => ({
    id: group.id,
    label: group.label,
    shortLabel: group.shortLabel,
    order: group.order,
    actionIds: [...group.actionIds],
  }));

  return {
    ok: true,
    profile: {
      profileId: resolvedProfile.profileId,
      gameId: resolvedProfile.gameId,
      source: resolvedProfile.source,
      sessionId: runtimeContext.sessionId,
      sessionGeneration: runtimeContext.sessionGeneration,
      groups,
      actions,
      diagnostics,
    },
  };
}

/** Re-validates and rebinds one action against a (possibly newer) runtime context — Section 57, used by Increment 4 immediately before execution. */
export function revalidateBoundAction(action: BoundWispAction, gameId: CanonicalGameId, runtimeContext: WispRuntimeContext | null, entryLookup: WispTrainerEntryLookup): BoundWispAction {
  const actionDef: Pick<WispActionDefinition, 'id' | 'entryId' | 'label' | 'shortLabel' | 'controlType' | 'slot' | 'enabled'> = {
    id: action.actionId,
    entryId: action.entryId,
    label: action.label,
    shortLabel: action.shortLabel,
    controlType: action.controlType,
    slot: action.slot,
  };
  return bindSingleAction(actionDef, gameId, runtimeContext, entryLookup);
}

function bindSingleAction(
  action: Pick<WispActionDefinition, 'id' | 'entryId' | 'label' | 'shortLabel' | 'controlType' | 'slot' | 'enabled'>,
  gameId: CanonicalGameId,
  runtimeContext: WispRuntimeContext | null,
  entryLookup: WispTrainerEntryLookup,
): BoundWispAction {
  const base = {
    actionId: action.id as WispActionId,
    entryId: action.entryId,
    label: action.label,
    shortLabel: action.shortLabel,
    controlType: action.controlType as WispControlType,
    slot: action.slot,
  };

  if (runtimeContext === null) {
    return { ...base, availability: 'detached', diagnostics: [bindingDiagnostic('WISP_BINDING_SESSION_MISSING', 'no current runtime session', { actionId: base.actionId, entryId: base.entryId })] };
  }

  if (action.enabled === false) {
    return { ...base, availability: 'disabled', diagnostics: [bindingDiagnostic('WISP_BINDING_ENTRY_DISABLED', 'action is disabled/hidden in the resolved profile', { actionId: base.actionId, entryId: base.entryId })] };
  }

  const entry = entryLookup.resolveEntry(gameId, action.entryId as CanonicalTrainerEntryId);
  if (entry === null) {
    return { ...base, availability: 'missing-entry', diagnostics: [bindingDiagnostic('WISP_BINDING_ENTRY_NOT_FOUND', `no trainer entry found for entryId "${action.entryId}" in game "${gameId}"`, { actionId: base.actionId, entryId: base.entryId, gameId })] };
  }
  if (entry.enabled === false) {
    return { ...base, availability: 'disabled', entryDescriptor: entry, diagnostics: [bindingDiagnostic('WISP_BINDING_ENTRY_DISABLED', `trainer entry "${action.entryId}" is disabled`, { actionId: base.actionId, entryId: base.entryId, gameId })] };
  }

  const binding: WispRuntimeBinding = {
    actionId: base.actionId,
    entryId: base.entryId,
    gameId,
    trainerId: runtimeContext.trainerId,
    tableId: runtimeContext.tableId,
    sessionId: runtimeContext.sessionId,
    sessionGeneration: runtimeContext.sessionGeneration,
    availability: 'available' as WispActionAvailability,
    boundAt: new Date().toISOString(),
  };

  return { ...base, availability: 'available', entryDescriptor: entry, binding };
}
