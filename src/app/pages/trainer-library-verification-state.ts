import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import { requiresCommunityExecutionApproval } from '../../core/trainer-catalog/community-trust.js';

/**
 * Pure verification-state logic for the Trainer Library card grid, kept in
 * its own CSS-free module (TrainerLibraryPage.tsx pulls in its .module.css
 * at import time, which makes it unimportable from the plain-Node test
 * runner used elsewhere in this repo).
 */
export function isCommunityScanEntry(entry: TrainerCatalogEntry): boolean {
  return entry.hasModPack && (
    requiresCommunityExecutionApproval(entry.certLevel) ||
    entry.verificationStatus === 'community'
  );
}

export function tierHint(entry: TrainerCatalogEntry): string {
  if (isCommunityScanEntry(entry)) {
    return 'Community definition — opens Discovery first; explicit approval is required before any live attach';
  }
  if (entry.verificationStatus === 'verified') return 'Instant — verified definition';
  if (entry.verificationStatus === 'community') return 'First session scan may be required';
  return 'Metadata only — sync or import a definition';
}
