import type { CanonicalGameId, CanonicalTrainerEntryId, WispActionId, WispControlType, WispProfileId } from './types.js';

/** Adaptive Wisp execution diagnostic codes (Increment 4, Section 37). */
export type WispExecutionDiagnosticCode =
  | 'WISP_EXECUTION_BINDING_STALE'
  | 'WISP_EXECUTION_ENTRY_MISSING'
  | 'WISP_EXECUTION_ENTRY_DISABLED'
  | 'WISP_EXECUTION_ENTRY_INCOMPATIBLE'
  | 'WISP_EXECUTION_CONTROL_UNSUPPORTED'
  | 'WISP_EXECUTION_INVALID_PRESET'
  | 'WISP_EXECUTION_INVALID_VALUE'
  | 'WISP_EXECUTION_CONSENT_REQUIRED'
  | 'WISP_EXECUTION_CONSENT_REJECTED'
  | 'WISP_EXECUTION_SESSION_CHANGED'
  | 'WISP_EXECUTION_TRAINER_FAILED'
  | 'WISP_EXECUTION_FREEZE_FAILED'
  | 'WISP_EXECUTION_IDENTITY_MAPPING_MISSING'
  | 'WISP_EXECUTION_REQUEST_SHAPE_REJECTED';

export interface WispExecutionDiagnostic {
  code: WispExecutionDiagnosticCode;
  message: string;
  actionId?: WispActionId;
  entryId?: CanonicalTrainerEntryId;
  gameId?: CanonicalGameId;
  profileId?: WispProfileId;
  controlType?: WispControlType;
}

export function executionDiagnostic(code: WispExecutionDiagnosticCode, message: string, extra?: Omit<WispExecutionDiagnostic, 'code' | 'message'>): WispExecutionDiagnostic {
  return extra ? { code, message, ...extra } : { code, message };
}
