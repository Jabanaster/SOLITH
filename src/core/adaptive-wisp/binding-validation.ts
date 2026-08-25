import { bindingDiagnostic, type WispBindingDiagnostic } from './binding-errors.js';
import type { WispRuntimeBinding, WispRuntimeContext } from './runtime-types.js';

/**
 * Adaptive Wisp binding validation (Increment 3, Sections 18-20, 31, 60).
 *
 * A binding is never trusted indefinitely after creation — runtime state
 * (detach, reattach, trainer/table switch) changes constantly, so every use
 * site must re-check with the CURRENT context via generation comparison,
 * the ultimate stale-binding defense (Section 31/60), not just event-driven
 * cleanup. Pure — no I/O, no mutation of the binding.
 */
export interface WispBindingValidationResult {
  valid: boolean;
  diagnostics: WispBindingDiagnostic[];
}

export function validateWispBinding(binding: WispRuntimeBinding, currentContext: WispRuntimeContext | null): WispBindingValidationResult {
  if (currentContext === null) {
    return { valid: false, diagnostics: [bindingDiagnostic('WISP_BINDING_SESSION_MISSING', 'no current runtime session', { actionId: binding.actionId, entryId: binding.entryId, gameId: binding.gameId })] };
  }

  if (binding.gameId !== currentContext.gameId) {
    return {
      valid: false,
      diagnostics: [bindingDiagnostic('WISP_BINDING_GAME_MISMATCH', `binding gameId "${binding.gameId}" does not match current gameId "${currentContext.gameId}"`, { actionId: binding.actionId, entryId: binding.entryId, gameId: binding.gameId })],
    };
  }

  if (binding.trainerId !== undefined && binding.trainerId !== currentContext.trainerId) {
    return { valid: false, diagnostics: [bindingDiagnostic('WISP_BINDING_TRAINER_MISMATCH', 'binding trainerId does not match the active trainer context', { actionId: binding.actionId, entryId: binding.entryId, gameId: binding.gameId })] };
  }

  if (binding.tableId !== undefined && binding.tableId !== currentContext.tableId) {
    return { valid: false, diagnostics: [bindingDiagnostic('WISP_BINDING_TABLE_MISMATCH', 'binding tableId does not match the active table context', { actionId: binding.actionId, entryId: binding.entryId, gameId: binding.gameId })] };
  }

  if (binding.sessionId !== currentContext.sessionId || binding.sessionGeneration !== currentContext.sessionGeneration) {
    return {
      valid: false,
      diagnostics: [
        bindingDiagnostic('WISP_BINDING_SESSION_STALE', `binding session generation ${binding.sessionGeneration} does not match current generation ${currentContext.sessionGeneration}`, {
          actionId: binding.actionId,
          entryId: binding.entryId,
          gameId: binding.gameId,
        }),
      ],
    };
  }

  return { valid: true, diagnostics: [] };
}
