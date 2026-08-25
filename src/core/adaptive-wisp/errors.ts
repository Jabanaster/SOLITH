/**
 * Adaptive Wisp structured validation error codes (Increment 1, Section 25).
 *
 * Every rejection path in validation.ts and registry.ts produces one of
 * these codes rather than an opaque generic error — callers (future
 * resolver/UI layers) branch on the code, not on message text.
 */
export type WispProfileValidationErrorCode =
  | 'WISP_PROFILE_SCHEMA_INVALID'
  | 'WISP_PROFILE_VERSION_UNSUPPORTED'
  | 'WISP_PROFILE_TOO_LARGE'
  | 'WISP_PROFILE_TOO_MANY_ACTIONS'
  | 'WISP_PROFILE_TOO_MANY_ACTIONS_IN_GROUP'
  | 'WISP_PROFILE_DUPLICATE_ACTION_ID'
  | 'WISP_PROFILE_DUPLICATE_GROUP_ID'
  | 'WISP_PROFILE_UNKNOWN_ACTION_REFERENCE'
  | 'WISP_PROFILE_UNKNOWN_GROUP_REFERENCE'
  | 'WISP_PROFILE_INVALID_SLOT'
  | 'WISP_PROFILE_EXECUTABLE_METADATA_REJECTED'
  | 'WISP_PROFILE_ALREADY_REGISTERED';

export interface WispProfileValidationIssue {
  code: WispProfileValidationErrorCode;
  message: string;
  /** Dotted/bracketed path into the input, e.g. "actions[2].slot" — best-effort, not guaranteed exhaustive. */
  path?: string;
}

export function issue(code: WispProfileValidationErrorCode, message: string, path?: string): WispProfileValidationIssue {
  return path ? { code, message, path } : { code, message };
}
