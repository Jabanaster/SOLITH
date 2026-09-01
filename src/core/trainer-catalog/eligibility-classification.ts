import type { AntiCheatStatus, CatalogExclusionFlag, TrainerCatalogEntry, VerificationStatus } from './types.js';

/**
 * §3.1 typed support-state vocabulary (exact ROADMAP.md terms). Structurally
 * identical to canonical-games' CanonicalGameEligibility by design — the two
 * are the same concept, kept as separate declarations to avoid a cross-module
 * type dependency (trainer-catalog stays the lower-level module).
 */
export type TrainerCatalogEligibilityState = 'eligible' | 'listed' | 'community' | 'verified' | 'unsupported' | 'excluded';

/** §3.2 exclusion reasons plus §3.1 non-safety reasons (explicitly-unsupported, identity-ambiguous). */
export type TrainerCatalogExclusionReasonCode =
  | 'anti-cheat-protected-multiplayer'
  | 'protected-online-only'
  | 'mmo'
  | 'competitive-online-only'
  | 'no-meaningful-offline-play'
  | 'cloud-only'
  | 'dedicated-server'
  | 'demo'
  | 'soundtrack'
  | 'editor-tool'
  | 'dlc-only'
  | 'unsupported-delisted'
  | 'explicitly-unsupported'
  | 'identity-ambiguous';

export interface TrainerCatalogEligibilityEvidence {
  verificationStatus?: VerificationStatus;
  hasModPack?: boolean;
  antiCheat?: AntiCheatStatus;
  offlinePlayAvailable?: boolean;
  catalogExclusionFlags?: CatalogExclusionFlag[];
  explicitlyUnsupported?: boolean;
  /** Set when trusted evidence conflicts on this title's identity (Step 11) — routes to excluded, not a guess. */
  identityAmbiguous?: boolean;
}

export interface TrainerCatalogClassificationResult {
  state: TrainerCatalogEligibilityState;
  excluded: boolean;
  reasonCodes: TrainerCatalogExclusionReasonCode[];
  evidence: TrainerCatalogEligibilityEvidence;
}

const CATALOG_FLAG_REASON: Record<CatalogExclusionFlag, TrainerCatalogExclusionReasonCode> = {
  mmo: 'mmo',
  'competitive-online-only': 'competitive-online-only',
  'no-meaningful-offline-play': 'no-meaningful-offline-play',
  'cloud-only': 'cloud-only',
  'dedicated-server': 'dedicated-server',
  demo: 'demo',
  soundtrack: 'soundtrack',
  'editor-tool': 'editor-tool',
  'dlc-only': 'dlc-only',
  'unsupported-delisted': 'unsupported-delisted',
};

/**
 * Pure, deterministic §3.1/§3.2 classification. Never infers safety facts from
 * title/genre/launcher/popularity/trainer-presence — only from explicit evidence
 * fields. Absent evidence resolves to 'unknown', never to a silently-safe default.
 *
 * Architecture: raw/normalized catalog entry -> this function -> eligible dataset.
 * Verification/provenance (verified/community) is a distinct axis from safety
 * exclusion — a 'verified' title can still be excluded if exclusion evidence
 * exists; exclusion is always checked first and independently.
 */
export function classifyTrainerCatalogEligibility(
  evidence: TrainerCatalogEligibilityEvidence,
): TrainerCatalogClassificationResult {
  const safetyReasonCodes: TrainerCatalogExclusionReasonCode[] = [];

  if (evidence.identityAmbiguous) {
    safetyReasonCodes.push('identity-ambiguous');
  }

  for (const flag of evidence.catalogExclusionFlags ?? []) {
    safetyReasonCodes.push(CATALOG_FLAG_REASON[flag]);
  }

  const antiCheat = evidence.antiCheat ?? 'unknown';
  if (antiCheat === 'protected-online-only') {
    safetyReasonCodes.push('protected-online-only');
  } else if (antiCheat === 'protected-multiplayer') {
    // Strict whole-game rule: offline/campaign content sharing a title with
    // anti-cheat-protected multiplayer excludes the ENTIRE game — never expose
    // the offline slice as trainer-eligible while suppressing only multiplayer.
    safetyReasonCodes.push('anti-cheat-protected-multiplayer');
  }
  // antiCheat === 'unknown' or 'none' contributes no exclusion reason. Unknown
  // status is never silently treated as safe/supported — it simply does not,
  // on its own, exclude a title lacking any other exclusion evidence.

  const excluded = safetyReasonCodes.length > 0;
  if (excluded) {
    return { state: 'excluded', excluded: true, reasonCodes: safetyReasonCodes, evidence };
  }

  if (evidence.explicitlyUnsupported) {
    return { state: 'unsupported', excluded: false, reasonCodes: ['explicitly-unsupported'], evidence };
  }

  if (evidence.verificationStatus === 'verified') {
    return { state: 'verified', excluded: false, reasonCodes: [], evidence };
  }
  if (evidence.verificationStatus === 'community') {
    return { state: 'community', excluded: false, reasonCodes: [], evidence };
  }
  if (evidence.verificationStatus === 'metadata-only' || evidence.verificationStatus === 'unverified') {
    return { state: 'listed', excluded: false, reasonCodes: [], evidence };
  }

  // No trainer-catalog link at all (e.g. a canonical game with no catalogGameId yet).
  return { state: 'eligible', excluded: false, reasonCodes: [], evidence };
}

export function deriveEligibilityEvidenceFromCatalogEntry(
  entry: Pick<
    TrainerCatalogEntry,
    'verificationStatus' | 'hasModPack' | 'antiCheat' | 'offlinePlayAvailable' | 'catalogExclusionFlags' | 'explicitlyUnsupported'
  >,
): TrainerCatalogEligibilityEvidence {
  return {
    verificationStatus: entry.verificationStatus,
    hasModPack: entry.hasModPack,
    antiCheat: entry.antiCheat,
    offlinePlayAvailable: entry.offlinePlayAvailable,
    catalogExclusionFlags: entry.catalogExclusionFlags,
    explicitlyUnsupported: entry.explicitlyUnsupported,
  };
}

export function isEntryEligibleForTrainerLibrary(evidence: TrainerCatalogEligibilityEvidence): boolean {
  return !classifyTrainerCatalogEligibility(evidence).excluded;
}

/** Central exclusion boundary (Step 9) — apply at the query/result layer so excluded titles cannot re-enter via search, All Games, or launcher-specific views. */
export function filterEligibleForTrainerLibrary<
  T extends Pick<
    TrainerCatalogEntry,
    'verificationStatus' | 'hasModPack' | 'antiCheat' | 'offlinePlayAvailable' | 'catalogExclusionFlags' | 'explicitlyUnsupported'
  >,
>(entries: T[]): T[] {
  return entries.filter((entry) => isEntryEligibleForTrainerLibrary(deriveEligibilityEvidenceFromCatalogEntry(entry)));
}

export const ELIGIBILITY_STATE_LABELS: Record<TrainerCatalogEligibilityState, string> = {
  eligible: 'Eligible',
  listed: 'Listed',
  community: 'Community / Unverified',
  verified: 'Verified',
  unsupported: 'Unsupported',
  excluded: 'Excluded',
};

const REASON_LABELS: Record<TrainerCatalogExclusionReasonCode, string> = {
  'anti-cheat-protected-multiplayer': 'Includes anti-cheat-protected multiplayer alongside offline content',
  'protected-online-only': 'Anti-cheat-protected online-only game',
  mmo: 'Massively multiplayer online game',
  'competitive-online-only': 'Competitive online-only game',
  'no-meaningful-offline-play': 'No meaningful offline play',
  'cloud-only': 'Cloud-only title',
  'dedicated-server': 'Dedicated server software',
  demo: 'Demo',
  soundtrack: 'Soundtrack',
  'editor-tool': 'Editor/tool product',
  'dlc-only': 'DLC-only product',
  'unsupported-delisted': 'Unsupported delisted product',
  'explicitly-unsupported': 'Explicitly marked unsupported',
  'identity-ambiguous': 'Identity could not be confidently resolved',
};

export function describeExclusionReason(code: TrainerCatalogExclusionReasonCode): string {
  return REASON_LABELS[code];
}
