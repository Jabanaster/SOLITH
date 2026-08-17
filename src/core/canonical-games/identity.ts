import { createHash } from 'node:crypto';
import path from 'node:path';
import { normalizeCatalogTitle } from '../trainer-catalog/normalize-title.js';
import type { CanonicalIdentityEvidence, CanonicalIdentityKey } from './types.js';

/**
 * Grouping/ID precedence (Step 5 of the Phase 2A authorization):
 *   1. trusted platform/store identity (steamAppId)
 *   2. trusted existing canonical/catalog identity (catalogGameId already assigned)
 *   3. trusted executable/product metadata (executable basename + normalized title)
 *   4. normalized title alone (exact-string match only — never fuzzy/substring)
 *   5. no reliable evidence — must not be auto-grouped, goes to manual review
 */

function stableHash(parts: Array<string | undefined>): string {
  return createHash('sha256').update(parts.map((part) => part ?? '').join('\0')).digest('hex').slice(0, 32);
}

export function normalizeCanonicalTitle(raw: string | null | undefined): string | null {
  return normalizeCatalogTitle(raw);
}

function executableBasename(executablePath: string | undefined): string | undefined {
  if (!executablePath?.trim()) return undefined;
  return path.basename(executablePath).toLowerCase();
}

/**
 * Deterministic grouping key for one piece of evidence. Same evidence always produces
 * the same key (Step 12 — ID stability across repeated scans; no randomness).
 */
export function computeIdentityKey(evidence: CanonicalIdentityEvidence): CanonicalIdentityKey {
  if (evidence.steamAppId != null) {
    return { key: `steam:${evidence.steamAppId}`, tier: 1, trusted: true };
  }

  if (evidence.catalogGameId) {
    return { key: `catalog:${evidence.catalogGameId}`, tier: 2, trusted: true };
  }

  const exeBasename = executableBasename(evidence.canonicalExecutablePath ?? evidence.executablePath);
  const normalizedTitle = normalizeCanonicalTitle(evidence.displayName);

  if (exeBasename && normalizedTitle) {
    return { key: `exe-title:${exeBasename}::${normalizedTitle}`, tier: 3, trusted: true };
  }

  if (normalizedTitle) {
    return { key: `title:${normalizedTitle}`, tier: 4, trusted: false };
  }

  // No usable identity signal at all. Unique per-source key — never grouped, never reused
  // as a merge target; each such row is its own manual-review candidate.
  return {
    key: `unresolved:${stableHash([evidence.sourceId, evidence.platform, evidence.installIdentity])}`,
    tier: 5,
    trusted: false,
  };
}

/**
 * Deterministic canonical game ID for a trusted (tier 1-4) grouping key. Never derived
 * from a mutable install path, never random. Tier 5 (unresolved) evidence must not call
 * this — it has no trustworthy identity to mint an ID from.
 */
export function generateCanonicalGameId(identityKey: CanonicalIdentityKey): string {
  if (identityKey.tier === 5) {
    throw new Error('Cannot mint a canonical game ID from unresolved (tier 5) identity evidence');
  }
  return `canonical:${stableHash([identityKey.key])}`;
}

/**
 * Deterministic canonical ID for a single evidence row explicitly resolved as "treat as
 * separate" (never merged with anything else). Distinct namespace from
 * generateCanonicalGameId so a later corroborating scan can never accidentally collide
 * a real trusted-identity canonical game with a manually-separated one.
 */
export function generateSeparateCanonicalGameId(evidence: CanonicalIdentityEvidence): string {
  return `canonical:separate:${stableHash([evidence.sourceId, evidence.installIdentity])}`;
}
