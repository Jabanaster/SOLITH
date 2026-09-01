import { computeIdentityKey, generateCanonicalGameId, normalizeCanonicalTitle } from './identity.js';
import type { CanonicalIdentityEvidence } from './types.js';

export type CanonicalAmbiguityReason =
  | 'no-identity-evidence'
  | 'title-matches-multiple-trusted-identities';

export interface CanonicalAmbiguousGroup {
  reason: CanonicalAmbiguityReason;
  evidence: CanonicalIdentityEvidence[];
}

export interface CanonicalGroupingResult {
  /** canonical game id -> the evidence rows safely grouped under it */
  groups: Map<string, CanonicalIdentityEvidence[]>;
  /** rows that must not be auto-grouped; route to manual review (Step 5/6/14) */
  ambiguous: CanonicalAmbiguousGroup[];
}

interface TrustedBucket {
  canonicalId: string;
  normalizedTitle: string | null;
  evidence: CanonicalIdentityEvidence[];
}

/**
 * Groups install evidence into canonical games per the Step 5 precedence and the
 * Step 6 false-duplicate / false-merge safety requirements:
 *
 * - tier 1-3 evidence (steamAppId, catalogGameId, or executable+title) is trusted and
 *   groups deterministically by its identity key.
 * - tier 4 (normalized title only, exact-string match) evidence corroborates into an
 *   existing trusted group with the same title when there is exactly one such group;
 *   if it matches more than one distinct trusted group, that is a genuine identity
 *   conflict and the row is routed to manual review rather than guessed.
 * - tier 5 (no usable evidence at all) always routes to manual review.
 */
export function resolveCanonicalGrouping(evidenceList: CanonicalIdentityEvidence[]): CanonicalGroupingResult {
  const trustedBuckets = new Map<string, TrustedBucket>();
  const untrusted: Array<{ evidence: CanonicalIdentityEvidence; normalizedTitle: string | null }> = [];
  const ambiguous: CanonicalAmbiguousGroup[] = [];

  for (const evidence of evidenceList) {
    const identityKey = computeIdentityKey(evidence);

    if (identityKey.tier === 5) {
      ambiguous.push({ reason: 'no-identity-evidence', evidence: [evidence] });
      continue;
    }

    if (identityKey.trusted) {
      const canonicalId = generateCanonicalGameId(identityKey);
      let bucket = trustedBuckets.get(identityKey.key);
      if (!bucket) {
        bucket = { canonicalId, normalizedTitle: normalizeCanonicalTitle(evidence.displayName), evidence: [] };
        trustedBuckets.set(identityKey.key, bucket);
      }
      bucket.evidence.push(evidence);
      continue;
    }

    untrusted.push({ evidence, normalizedTitle: normalizeCanonicalTitle(evidence.displayName) });
  }

  const untrustedTitleGroups = new Map<string, CanonicalIdentityEvidence[]>();

  for (const item of untrusted) {
    const matchingTrustedBuckets = [...trustedBuckets.values()].filter(
      (bucket) => bucket.normalizedTitle !== null && bucket.normalizedTitle === item.normalizedTitle,
    );
    const distinctCanonicalIds = new Set(matchingTrustedBuckets.map((bucket) => bucket.canonicalId));

    if (distinctCanonicalIds.size > 1) {
      ambiguous.push({ reason: 'title-matches-multiple-trusted-identities', evidence: [item.evidence] });
      continue;
    }

    if (distinctCanonicalIds.size === 1) {
      matchingTrustedBuckets[0].evidence.push(item.evidence);
      continue;
    }

    const titleKey = item.normalizedTitle as string; // tier 4 guarantees a non-null title
    const existing = untrustedTitleGroups.get(titleKey);
    if (existing) {
      existing.push(item.evidence);
    } else {
      untrustedTitleGroups.set(titleKey, [item.evidence]);
    }
  }

  const groups = new Map<string, CanonicalIdentityEvidence[]>();
  for (const bucket of trustedBuckets.values()) {
    groups.set(bucket.canonicalId, bucket.evidence);
  }
  for (const [titleKey, evidence] of untrustedTitleGroups) {
    const canonicalId = generateCanonicalGameId({ key: `title:${titleKey}`, tier: 4, trusted: false });
    groups.set(canonicalId, evidence);
  }

  return { groups, ambiguous };
}
