/**
 * SOLITH Phase 3 — cross-provider canonical identity matching.
 *
 * Distinct from identity.ts/dedupe.ts (which group LOCAL INSTALL evidence,
 * e.g. installed_games rows, into canonical games via steamAppId/exe-path
 * evidence). This module solves a different problem: given raw
 * ProviderGameRecord rows from independent catalog ingestion (Steam, Epic,
 * GOG, ...), decide which ones represent the SAME real-world game and
 * therefore should share one canonical game, vs. which are legitimately
 * distinct (remaster, sequel, demo, regional variant, definitive edition).
 *
 * Hard rule from the owner's Phase 3 prompt: "Never use title-only fuzzy
 * match as final authority. If uncertain: keep records separate /
 * AMBIGUOUS." This module is built around that rule, not around maximizing
 * merge rate.
 */
/**
 * PHASE 3.2 BACKEND PORT: this file is a manually-synced duplicate of the
 * main repo's src/core/canonical-games/cross-provider-match.ts, adapted only
 * in its import paths (this backend is a separate Cloudflare Worker package
 * with its own build, not a monorepo — see shared/README.md for why this is
 * a deliberate duplication, not an accident). The MATCHING LOGIC below is
 * byte-for-byte identical to the main repo's, including the Phase 3.1 P1
 * security fix (title+publisher can never reach HIGH/EXACT).
 */
import { normalizeCatalogTitle } from './normalize-title.js';
import type { ProviderGameRecord } from './provider-types.js';
import { EDITION_DISTINCTIONS, KNOWN_PROVIDER_ALIASES } from './edition-registry.js';

/**
 * EXACT/HIGH auto-merge (share one canonical game). POSSIBLE stays unmerged
 * pending stronger evidence — the record is kept standalone, with the
 * candidate recorded for a human/future-signal decision, never silently
 * applied. AMBIGUOUS means multiple candidates were found with no way to
 * pick one — must never silently pick a winner. UNLINKED means no canonical
 * candidate at all (the record stands alone as its own canonical game,
 * exactly like a launcher-exclusive title).
 */
export type CrossProviderLinkConfidence = 'EXACT' | 'HIGH' | 'POSSIBLE' | 'AMBIGUOUS' | 'UNLINKED';

export type CrossProviderMatchEvidenceKind =
  | 'known-provider-alias'
  | 'local-install-bridge'
  | 'normalized-title-and-publisher'
  | 'normalized-title-and-release-year'
  | 'normalized-title-only';

export interface CrossProviderMatchCandidate {
  /** The existing canonical game (or provisional grouping key) this record could link to. */
  canonicalGameId: string;
  confidence: CrossProviderLinkConfidence;
  evidence: CrossProviderMatchEvidenceKind;
  /** Human-readable reason, for audit/review UI — never used as matching logic itself. */
  reason: string;
}

export interface CrossProviderMatchResult {
  record: ProviderGameRecord;
  /** Empty when UNLINKED (no candidate at all). */
  candidates: CrossProviderMatchCandidate[];
  confidence: CrossProviderLinkConfidence;
}

/** A canonical game candidate already known to the matcher, built from provider records already linked to it. */
export interface CanonicalCandidateGame {
  canonicalGameId: string;
  normalizedTitle: string;
  publisher?: string;
  releaseYear?: number;
  /** (provider, providerGameId) pairs already linked — used for the known-alias bridge. */
  linkedProviderIds: Array<{ provider: string; providerGameId: string }>;
}

function normalizedTitleOf(record: ProviderGameRecord): string | null {
  return normalizeCatalogTitle(record.title);
}

function normalizedPublisherOf(value: string | undefined): string | null {
  if (!value) return null;
  const stripped = value
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|s\.a\.|sa|gmbh|co|corp|corporation|entertainment|studios|studio|games|interactive)\b\.?/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return stripped.length > 0 ? stripped : null;
}

function releaseYearOf(record: ProviderGameRecord): number | null {
  if (!record.releaseDate) return null;
  const year = Number(record.releaseDate.slice(0, 4));
  return Number.isFinite(year) && year > 1970 && year < 2100 ? year : null;
}

/**
 * Checks the curated edition-distinction registry: does this normalized
 * title correspond to a known family of DISTINCT titles (remaster, sequel,
 * demo, etc.) that must never auto-merge with each other even though their
 * titles are similar? Returns the distinguishing key if so (e.g. a record
 * for "Oblivion Remastered" and a record for "Oblivion" get different
 * distinguishing keys and can never match each other via title alone).
 */
function editionDistinguisherFor(normalizedTitle: string): string | null {
  for (const family of EDITION_DISTINCTIONS) {
    for (const member of family.members) {
      if (member.matches.some((pattern) => pattern.test(normalizedTitle))) {
        return `${family.familyId}:${member.editionId}`;
      }
    }
  }
  return null;
}

/**
 * Looks up a curated, explicitly-known cross-provider alias for this exact
 * (provider, providerGameId) — e.g. "Steam AppID 1091500 IS GOG product
 * 1423049311, IS Epic namespace cdprojektred/witcher3" for a title the
 * owner/maintainers have manually verified. This is the ONLY path that can
 * produce EXACT confidence between records with no shared local install
 * evidence, because it is not inferred — it is asserted.
 */
function knownAliasCanonicalKeyFor(record: ProviderGameRecord): string | null {
  for (const alias of KNOWN_PROVIDER_ALIASES) {
    const match = alias.members.find((m) => m.provider === record.provider && m.providerGameId === record.providerGameId);
    if (match) return alias.canonicalKey;
  }
  return null;
}

export interface MatchProviderRecordInput {
  record: ProviderGameRecord;
  candidates: CanonicalCandidateGame[];
  /**
   * Optional bridge from Phase 1's local-install identity system
   * (canonical-games/identity.ts): if this exact provider record's game is
   * already known to be installed and linked to a canonical game via
   * trusted local evidence (steamAppId / exe+title tier 1-3), pass that
   * canonicalGameId here. This is the strongest possible non-curated
   * evidence, since it is grounded in a real local installation, not
   * inference from catalog metadata alone.
   */
  localInstallCanonicalGameId?: string;
}

/**
 * Matches one provider catalog record against known canonical candidates.
 * Never mutates anything — pure decision function. The caller (store-layer
 * ingestion code) is responsible for applying EXACT/HIGH results and
 * recording POSSIBLE/AMBIGUOUS for review.
 */
export function matchProviderRecordToCanonical(input: MatchProviderRecordInput): CrossProviderMatchResult {
  const { record, candidates, localInstallCanonicalGameId } = input;
  const normalizedTitle = normalizedTitleOf(record);

  if (localInstallCanonicalGameId) {
    return {
      record,
      confidence: 'EXACT',
      candidates: [
        {
          canonicalGameId: localInstallCanonicalGameId,
          confidence: 'EXACT',
          evidence: 'local-install-bridge',
          reason: 'This provider record matches a game already linked to a canonical game via trusted local installation evidence.',
        },
      ],
    };
  }

  const knownKey = knownAliasCanonicalKeyFor(record);
  if (knownKey) {
    return {
      record,
      confidence: 'EXACT',
      candidates: [
        {
          canonicalGameId: knownKey,
          confidence: 'EXACT',
          evidence: 'known-provider-alias',
          reason: 'Explicit curated cross-provider identity mapping for this exact provider ID.',
        },
      ],
    };
  }

  if (!normalizedTitle) {
    return { record, confidence: 'UNLINKED', candidates: [] };
  }

  const thisDistinguisher = editionDistinguisherFor(normalizedTitle);
  const thisPublisher = normalizedPublisherOf(record.publisher);
  const thisYear = releaseYearOf(record);

  const scored: CrossProviderMatchCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.normalizedTitle !== normalizedTitle) continue;

    // Distinct-edition registry check: if EITHER side is a member of a known
    // edition family and they resolve to different members, this can never
    // be a match, regardless of any other corroborating field.
    const candidateDistinguisher = editionDistinguisherFor(candidate.normalizedTitle);
    if (thisDistinguisher && candidateDistinguisher && thisDistinguisher !== candidateDistinguisher) {
      continue;
    }

    const candidatePublisher = normalizedPublisherOf(candidate.publisher);
    const publishersMatch = Boolean(thisPublisher && candidatePublisher && thisPublisher === candidatePublisher);
    const yearsClose =
      thisYear != null && candidate.releaseYear != null && Math.abs(thisYear - candidate.releaseYear) <= 1;

    if (publishersMatch) {
      // SECURITY FIX (Phase 3 hostile review, P1): title+publisher corroboration
      // was previously scored HIGH and auto-merged with zero human review. Both
      // fields are fully attacker-controlled string content on Epic's and GOG's
      // unauthenticated, unofficial (PARTIAL-capability) catalog endpoints — a
      // compromised/spoofed response supplying the real public title+publisher
      // of an existing canonical game would auto-merge into it silently. Per the
      // owner's own rule ("never use title-only fuzzy match as final authority.
      // If uncertain: keep records separate"), NO purely metadata-heuristic match
      // may reach HIGH/EXACT — only a curated KNOWN_PROVIDER_ALIASES entry or the
      // local-install-bridge (real local file evidence) can. This is downgraded
      // to POSSIBLE, which sync-orchestrator.ts never auto-applies — it always
      // routes to the review queue.
      scored.push({
        canonicalGameId: candidate.canonicalGameId,
        confidence: 'POSSIBLE',
        evidence: 'normalized-title-and-publisher',
        reason: `Normalized title "${normalizedTitle}" and publisher "${thisPublisher}" both match, but metadata-only corroboration is never auto-applied — see curated alias/local-install-bridge paths for that.`,
      });
    } else if (yearsClose) {
      scored.push({
        canonicalGameId: candidate.canonicalGameId,
        confidence: 'POSSIBLE',
        evidence: 'normalized-title-and-release-year',
        reason: `Normalized title matches and release years are within 1 year (${thisYear} vs ${candidate.releaseYear}), but publisher could not be corroborated.`,
      });
    } else {
      scored.push({
        canonicalGameId: candidate.canonicalGameId,
        confidence: 'POSSIBLE',
        evidence: 'normalized-title-only',
        reason: 'Only the normalized title matches — publisher and release year could not corroborate. Title-only match is never treated as final authority.',
      });
    }
  }

  if (scored.length === 0) {
    return { record, confidence: 'UNLINKED', candidates: [] };
  }

  const exactOrHigh = scored.filter((c) => c.confidence === 'HIGH');
  const distinctHighTargets = new Set(exactOrHigh.map((c) => c.canonicalGameId));

  if (distinctHighTargets.size === 1) {
    return { record, confidence: 'HIGH', candidates: exactOrHigh };
  }
  if (distinctHighTargets.size > 1) {
    // Two or more DIFFERENT canonical games both look like a HIGH-confidence
    // match (e.g. publisher matches two distinctly-canonicalized entries) —
    // a genuine conflict. Never silently pick one.
    return { record, confidence: 'AMBIGUOUS', candidates: scored };
  }

  const distinctPossibleTargets = new Set(scored.map((c) => c.canonicalGameId));
  if (distinctPossibleTargets.size === 1) {
    return { record, confidence: 'POSSIBLE', candidates: scored };
  }
  return { record, confidence: 'AMBIGUOUS', candidates: scored };
}
