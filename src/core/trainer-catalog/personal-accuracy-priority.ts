import type { VerificationStatus } from './types.js';

/**
 * Mission 13 (Personal Library Completion pass) — "Personal Trainer Accuracy
 * Priority" policy.
 *
 * This determines ANALYSIS/VALIDATION ATTENTION ORDER ONLY. It never
 * auto-executes anything (no launch, no attach, no memory read/write, no
 * cheat toggling) — it is a pure, deterministic ranking function consumed by
 * whatever future analysis-queue UI/worker chooses what to look at next.
 *
 * Priority band (from the frozen product decision): INSTALLED games first,
 * then OWNED games, then everything else — matching the Trainer Library's
 * own frozen section hierarchy (library-sections.ts) rather than inventing a
 * second, conflicting ordering concept.
 *
 * Within a band, sub-priority evidence (highest weight first):
 *   1. Canonical identity confidence (lower tier number = more confident;
 *      identity.ts's 5-tier precedence, trusted flag as a tiebreak)
 *   2. Executable/build evidence present (a real installed-executable hash
 *      was matched — see fingerprint-verify.ts / installed-exe-hash.ts)
 *   3. versionHint present (narrows which CT/offset revision applies)
 *   4. Best source provenance (VerificationStatus: verified > community >
 *      metadata-only > unverified)
 *   5. Deduplicated cheat count (more distinct, deduped cheats == more
 *      analysis surface worth validating)
 *   6. Native-ready candidate count (cheats already scored native-portable)
 *   7. Local verification receipt present (this machine already has
 *      first-party evidence, e.g. a prior successful attach/verify run)
 *
 * All inputs must be explicit evidence the caller already has — this module
 * never infers evidence from title, genre, or popularity.
 */

export type AccuracyPriorityBand = 'installed' | 'owned' | 'other';

const IDENTITY_TIER_MAX = 5;
const VERIFICATION_STATUS_RANK: Record<VerificationStatus, number> = {
  verified: 3,
  community: 2,
  'metadata-only': 1,
  unverified: 0,
};

export interface AccuracyPriorityEvidence {
  canonicalGameId: string;
  isInstalled: boolean;
  ownedConfirmed: boolean;
  /** identity.ts tier: 1 (steamAppId) is most confident, 5 is unresolved. */
  identityTier: 1 | 2 | 3 | 4 | 5;
  identityTrusted: boolean;
  hasExecutableEvidence: boolean;
  hasVersionHint: boolean;
  bestSourceVerificationStatus: VerificationStatus;
  deduplicatedCheatCount: number;
  nativeReadyCandidateCount: number;
  hasLocalVerificationReceipt: boolean;
}

export interface AccuracyPriorityResult {
  canonicalGameId: string;
  band: AccuracyPriorityBand;
  /** Deterministic composite score. Higher sorts first. Comparable only within a single call to rankByAccuracyPriority. */
  score: number;
}

function bandFor(evidence: AccuracyPriorityEvidence): AccuracyPriorityBand {
  if (evidence.isInstalled) return 'installed';
  if (evidence.ownedConfirmed) return 'owned';
  return 'other';
}

const BAND_WEIGHT: Record<AccuracyPriorityBand, number> = {
  installed: 2,
  owned: 1,
  other: 0,
};

/**
 * Composite sub-priority score, 0-100, computed from weighted evidence
 * signals in the priority order documented above. Weights are fixed
 * constants chosen so no lower-priority signal can outrank a higher one
 * regardless of its own magnitude (each tier's max contribution is smaller
 * than the tier above it's minimum step).
 */
function subPriorityScore(evidence: AccuracyPriorityEvidence): number {
  const identityConfidence = (IDENTITY_TIER_MAX - evidence.identityTier) / (IDENTITY_TIER_MAX - 1); // 0..1, 1 = tier 1
  const identityTrustBonus = evidence.identityTrusted ? 1 : 0;
  const executableEvidence = evidence.hasExecutableEvidence ? 1 : 0;
  const versionHint = evidence.hasVersionHint ? 1 : 0;
  const provenance = VERIFICATION_STATUS_RANK[evidence.bestSourceVerificationStatus] / 3; // 0..1
  const cheatVolume = Math.min(evidence.deduplicatedCheatCount, 50) / 50; // 0..1, capped
  const nativeReady = Math.min(evidence.nativeReadyCandidateCount, 50) / 50; // 0..1, capped
  const localReceipt = evidence.hasLocalVerificationReceipt ? 1 : 0;

  return (
    identityConfidence * 40 +
    identityTrustBonus * 10 +
    executableEvidence * 20 +
    versionHint * 10 +
    provenance * 10 +
    cheatVolume * 5 +
    nativeReady * 3 +
    localReceipt * 2
  );
}

export function computeAccuracyPriority(evidence: AccuracyPriorityEvidence): AccuracyPriorityResult {
  const band = bandFor(evidence);
  const score = BAND_WEIGHT[band] * 1000 + subPriorityScore(evidence);
  return { canonicalGameId: evidence.canonicalGameId, band, score };
}

/**
 * Deterministic ranking: highest score first; ties broken by canonicalGameId
 * ascending so repeated calls on the same input always produce the same
 * order (never insertion-order-dependent).
 */
export function rankByAccuracyPriority(entries: AccuracyPriorityEvidence[]): AccuracyPriorityResult[] {
  return entries
    .map(computeAccuracyPriority)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.canonicalGameId.localeCompare(b.canonicalGameId);
    });
}
