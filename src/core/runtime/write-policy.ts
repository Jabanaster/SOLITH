export type WriteFeatureType =
  | 'value_write'
  | 'value_freeze'
  | 'code_patch'
  | 'nop_patch'
  | 'pointer_backed_write'
  | 'aob_resolved_write';

export interface WriteFeatureDeclaration {
  id: string;
  type: WriteFeatureType;
  addressExpression: string;
  dataType?: string;
  byteLength?: number;
  originalValueCaptured: boolean;
  restoreAvailable: boolean;
  executableHashMatched: boolean;
  ambiguousAobMatches: boolean;
  explicitProcessSelected: boolean;
  /**
   * Trust Shift: single-player / private-play waiver accepted.
   * Legacy name `offlineGuardPassed` remains accepted as an alias in validateWriteFeatureDeclaration.
   */
  singlePlayerWaiverAccepted?: boolean;
  /** @deprecated Prefer singlePlayerWaiverAccepted */
  offlineGuardPassed?: boolean;
  userApprovalCaptured: boolean;
  certifiedOrGated: boolean;
  auditLogWritten: boolean;
  userExplicitlyActivated: boolean;
  enabledByDefault: false;
  backgroundAutoActivation: false;
  antiCheatBypass: false;
  protectedMultiplayerProcess: false;
}

export interface WritePolicyValidation {
  allowed: boolean;
  blockers: string[];
}

export function validateWriteFeatureDeclaration(feature: WriteFeatureDeclaration): WritePolicyValidation {
  const blockers: string[] = [];
  if (!feature.explicitProcessSelected) blockers.push('Game process was not explicitly selected.');
  const waiverOk =
    feature.singlePlayerWaiverAccepted === true || feature.offlineGuardPassed === true;
  if (!waiverOk) blockers.push('Single-player / private-play waiver was not accepted.');
  if (!feature.userApprovalCaptured) blockers.push('User approval was not captured.');
  if (!feature.certifiedOrGated) blockers.push('Feature is not certified or gated for write-capable use.');
  if (!feature.auditLogWritten) blockers.push('Audit log entry was not written.');
  if (!feature.userExplicitlyActivated) blockers.push('User did not explicitly activate the write-capable feature.');
  if (!feature.originalValueCaptured) blockers.push('Original value was not captured.');
  if (!feature.restoreAvailable) blockers.push('Restore path is not available.');
  if (!feature.executableHashMatched) blockers.push('Executable hash/version did not match.');
  if (feature.ambiguousAobMatches) blockers.push('Ambiguous AOB matches block activation.');
  if (feature.enabledByDefault !== false) blockers.push('Write-capable features must be disabled by default.');
  if (feature.backgroundAutoActivation !== false) blockers.push('Background auto-activation is not allowed.');
  if (feature.antiCheatBypass !== false) blockers.push('Anti-cheat bypass is not allowed.');
  if (feature.protectedMultiplayerProcess !== false) blockers.push('Protected multiplayer process support is not allowed.');
  if (!feature.addressExpression) blockers.push('Feature must declare the exact address or resolver expression it changes.');
  if (!feature.byteLength && !feature.dataType) blockers.push('Feature must declare byte length or data type.');
  return { allowed: blockers.length === 0, blockers };
}
