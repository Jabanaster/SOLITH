import type { CanonicalGameId, CanonicalTrainerEntryId, WispActionId, WispProfileId } from './types.js';

/**
 * Adaptive Wisp runtime-binding diagnostic codes (Increment 3, Section 33).
 *
 * Mirrors errors.ts's pattern for the domain layer: every rejection path in
 * profile-binder.ts and binding-validation.ts produces one of these codes
 * rather than an opaque generic error.
 */
export type WispBindingDiagnosticCode =
  | 'WISP_BINDING_GAME_MISMATCH'
  | 'WISP_BINDING_TRAINER_MISMATCH'
  | 'WISP_BINDING_TABLE_MISMATCH'
  | 'WISP_BINDING_ENTRY_NOT_FOUND'
  | 'WISP_BINDING_ENTRY_DISABLED'
  | 'WISP_BINDING_SESSION_STALE'
  | 'WISP_BINDING_SESSION_MISSING'
  | 'WISP_BINDING_PROFILE_INVALID'
  | 'WISP_BINDING_ENTRY_INCOMPATIBLE'
  | 'WISP_BINDING_RUNTIME_CONTEXT_INVALID';

export interface WispBindingDiagnostic {
  code: WispBindingDiagnosticCode;
  message: string;
  actionId?: WispActionId;
  entryId?: CanonicalTrainerEntryId;
  gameId?: CanonicalGameId;
  profileId?: WispProfileId;
}

export function bindingDiagnostic(code: WispBindingDiagnosticCode, message: string, extra?: Omit<WispBindingDiagnostic, 'code' | 'message'>): WispBindingDiagnostic {
  return extra ? { code, message, ...extra } : { code, message };
}
