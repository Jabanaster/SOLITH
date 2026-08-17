import { createHash } from 'node:crypto';
import type { IdentityReviewResolution, IdentityReviewStatus } from '../trainer-catalog/identity-review.js';
import type { CanonicalIdentityEvidence } from './types.js';

/**
 * Canonical-game counterpart to trainer-catalog/identity-review.ts (Phase 1.7). Reuses
 * the same status/resolution vocabulary (pending/resolved/ignored,
 * keep-existing/accept-incoming/treat-separate/ignore) rather than inventing a second
 * set of review semantics, per Step 14 of the Phase 2A authorization. A separate table
 * is used because the payload is installation evidence, not a catalog entry — the two
 * review queues are independent and never cross-reference each other's rows.
 */
export type CanonicalIdentityReviewReason =
  | 'no-identity-evidence'
  | 'title-matches-multiple-trusted-identities';

export interface CanonicalIdentityReviewItem {
  id: string;
  reason: CanonicalIdentityReviewReason;
  status: IdentityReviewStatus;
  evidence: CanonicalIdentityEvidence[];
  resolution?: IdentityReviewResolution;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

/**
 * Deterministic fingerprint for one ambiguous evidence group, so repeated migration
 * dry-runs / rescans reuse the same pending row instead of duplicating it.
 */
export function computeCanonicalIdentityReviewFingerprint(
  reason: CanonicalIdentityReviewReason,
  evidence: CanonicalIdentityEvidence[],
): string {
  const hash = createHash('sha256');
  hash.update(reason);
  for (const item of [...evidence].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    hash.update('|');
    hash.update(item.sourceId);
    hash.update('|');
    hash.update(item.installIdentity);
  }
  return hash.digest('hex').slice(0, 32);
}
