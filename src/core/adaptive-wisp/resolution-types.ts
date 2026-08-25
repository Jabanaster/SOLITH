import type { WispGameProfile, WispProfileId, WispProfileSource, CanonicalGameId } from './types.js';

/**
 * Adaptive Wisp profile resolution types (Increment 2, Sections 18, 22-23).
 * The resolver is pure — see profile-resolver.ts — and never touches a live
 * process/session; that is Increment 3's concern.
 */
export interface WispResolutionContext {
  gameId: CanonicalGameId;
  trainerId?: string;
  tableId?: string;
  tableVersion?: string;
  /** Explicit user selection — beats normal source precedence when the target is found and applicable (Section 16/29). */
  selectedProfileId?: WispProfileId;
}

export type WispResolutionDiagnosticCode =
  | 'WISP_RESOLUTION_NO_PROFILE'
  | 'WISP_RESOLUTION_SELECTED_PROFILE_NOT_FOUND'
  | 'WISP_RESOLUTION_SELECTED_PROFILE_INAPPLICABLE'
  | 'WISP_RESOLUTION_SELECTED_PROFILE_SELECTED'
  | 'WISP_RESOLUTION_CREATOR_PROFILE_SELECTED'
  | 'WISP_RESOLUTION_USER_PROFILE_SELECTED'
  | 'WISP_RESOLUTION_COMMUNITY_PROFILE_SELECTED'
  | 'WISP_RESOLUTION_BUILTIN_PROFILE_SELECTED'
  | 'WISP_RESOLUTION_GENERATED_FALLBACK_SELECTED'
  | 'WISP_RESOLUTION_OVERRIDE_APPLIED'
  | 'WISP_RESOLUTION_OVERRIDE_INVALID'
  | 'WISP_RESOLUTION_OVERRIDE_PARTIALLY_APPLIED';

export interface WispResolutionDiagnostic {
  code: WispResolutionDiagnosticCode;
  message: string;
}

export interface WispProfileResolutionResult {
  ok: boolean;
  profile?: WispGameProfile;
  source?: WispProfileSource;
  selectedProfileId?: WispProfileId;
  userOverrideApplied: boolean;
  resolutionReason?: string;
  diagnostics: WispResolutionDiagnostic[];
}
