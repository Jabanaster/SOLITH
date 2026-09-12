/**
 * SOLITH Phase 3 — persistence for canonical_provider_links (see
 * database/index.ts's applySchema for the table doc). Links a provider
 * catalog record to a canonical game with an explicit confidence level from
 * cross-provider-match.ts.
 */
import db from '../database/index.js';
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { CrossProviderLinkConfidence, CrossProviderMatchCandidate } from './cross-provider-match.js';

export interface CanonicalProviderLink {
  provider: LinkedLibraryProvider;
  providerGameId: string;
  canonicalGameId: string;
  confidence: CrossProviderLinkConfidence;
  evidence: CrossProviderMatchCandidate[];
  linkedAt: string;
}

interface CanonicalProviderLinkRow {
  provider: string;
  providerGameId: string;
  canonicalGameId: string;
  confidence: string;
  evidenceJson: string;
  linkedAt: string;
}

function rowToLink(row: CanonicalProviderLinkRow): CanonicalProviderLink {
  return {
    provider: row.provider as LinkedLibraryProvider,
    providerGameId: row.providerGameId,
    canonicalGameId: row.canonicalGameId,
    confidence: row.confidence as CrossProviderLinkConfidence,
    evidence: JSON.parse(row.evidenceJson) as CrossProviderMatchCandidate[],
    linkedAt: row.linkedAt,
  };
}

/**
 * Records/updates a provider-record-to-canonical-game link. Callers must
 * decide policy themselves (this function does not enforce EXACT/HIGH-only
 * application) — but every real consumer in this codebase (discovery query,
 * provider badge display) MUST filter to confidence IN ('EXACT','HIGH')
 * before treating a link as applied. POSSIBLE/AMBIGUOUS rows exist purely
 * for review/audit visibility.
 */
export function upsertCanonicalProviderLink(link: Omit<CanonicalProviderLink, 'linkedAt'>): void {
  db.prepare(
    `INSERT INTO canonical_provider_links (provider, providerGameId, canonicalGameId, confidence, evidenceJson, linkedAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(provider, providerGameId) DO UPDATE SET
       canonicalGameId = excluded.canonicalGameId,
       confidence = excluded.confidence,
       evidenceJson = excluded.evidenceJson,
       linkedAt = excluded.linkedAt`,
  ).run(link.provider, link.providerGameId, link.canonicalGameId, link.confidence, JSON.stringify(link.evidence));
}

export function getCanonicalProviderLink(provider: LinkedLibraryProvider, providerGameId: string): CanonicalProviderLink | null {
  const row = db
    .prepare('SELECT * FROM canonical_provider_links WHERE provider = ? AND providerGameId = ?')
    .get(provider, providerGameId) as CanonicalProviderLinkRow | undefined;
  return row ? rowToLink(row) : null;
}

/** All provider identities linked to one canonical game, at ANY confidence — callers filter as needed. */
export function listProviderLinksForCanonical(canonicalGameId: string): CanonicalProviderLink[] {
  const rows = db
    .prepare('SELECT * FROM canonical_provider_links WHERE canonicalGameId = ? ORDER BY provider')
    .all(canonicalGameId) as CanonicalProviderLinkRow[];
  return rows.map(rowToLink);
}

/** Only EXACT/HIGH links — the applied/merged provider identities for one canonical game. */
export function listAppliedProviderLinksForCanonical(canonicalGameId: string): CanonicalProviderLink[] {
  return listProviderLinksForCanonical(canonicalGameId).filter((l) => l.confidence === 'EXACT' || l.confidence === 'HIGH');
}

/** POSSIBLE/AMBIGUOUS links awaiting stronger evidence or manual review — never treated as applied. */
export function listLinksNeedingReview(): CanonicalProviderLink[] {
  const rows = db
    .prepare("SELECT * FROM canonical_provider_links WHERE confidence IN ('POSSIBLE', 'AMBIGUOUS') ORDER BY linkedAt DESC")
    .all() as CanonicalProviderLinkRow[];
  return rows.map(rowToLink);
}
