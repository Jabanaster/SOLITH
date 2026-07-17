import type { HubCertificationLevel } from './store.js';

export const COMMUNITY_WARNING_LABEL = 'Community (Scan Required)';

export function requiresCommunityExecutionApproval(
  certLevel: HubCertificationLevel | undefined,
): boolean {
  return certLevel === 'L0_Community';
}
