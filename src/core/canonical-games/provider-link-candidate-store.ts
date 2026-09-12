/**
 * SOLITH Phase 3.1, Mission 7 — persistence for
 * `canonical_provider_link_candidates` (see database/index.ts's applySchema
 * for the table doc). This is the ONLY place POSSIBLE/AMBIGUOUS
 * cross-provider match candidates are recorded — advisory/audit-only, NEVER
 * an applied link. Consumers must use `provider-link-store.ts`'s
 * `listAppliedProviderLinksForCanonical` (EXACT/HIGH only) for anything that
 * treats a link as real.
 */
import db from '../database/index.js';
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { CrossProviderLinkConfidence, CrossProviderMatchCandidate } from './cross-provider-match.js';

export interface CanonicalProviderLinkCandidate {
  provider: LinkedLibraryProvider;
  providerGameId: string;
  candidateCanonicalGameId: string;
  confidence: CrossProviderLinkConfidence;
  evidence: CrossProviderMatchCandidate[];
  observedAt: string;
}

interface CandidateRow {
  provider: string;
  providerGameId: string;
  candidateCanonicalGameId: string;
  confidence: string;
  evidenceJson: string;
  observedAt: string;
}

function rowToCandidate(row: CandidateRow): CanonicalProviderLinkCandidate {
  return {
    provider: row.provider as LinkedLibraryProvider,
    providerGameId: row.providerGameId,
    candidateCanonicalGameId: row.candidateCanonicalGameId,
    confidence: row.confidence as CrossProviderLinkConfidence,
    evidence: JSON.parse(row.evidenceJson) as CrossProviderMatchCandidate[],
    observedAt: row.observedAt,
  };
}

/**
 * Records the FULL candidate set for one (provider, providerGameId)'s
 * POSSIBLE/AMBIGUOUS match, replacing any prior candidate set for that exact
 * pair (a re-sync may produce a different candidate set as new canonical
 * games appear) — never silently dropping any candidate down to just one.
 */
export function recordLinkCandidates(
  provider: LinkedLibraryProvider,
  providerGameId: string,
  confidence: CrossProviderLinkConfidence,
  candidates: CrossProviderMatchCandidate[],
): void {
  db.prepare('DELETE FROM canonical_provider_link_candidates WHERE provider = ? AND providerGameId = ?').run(provider, providerGameId);

  const insert = db.prepare(
    `INSERT INTO canonical_provider_link_candidates
       (provider, providerGameId, candidateCanonicalGameId, confidence, evidenceJson, observedAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  );
  for (const candidate of candidates) {
    insert.run(provider, providerGameId, candidate.canonicalGameId, confidence, JSON.stringify(candidates));
  }
}

export function listCandidatesForRecord(provider: LinkedLibraryProvider, providerGameId: string): CanonicalProviderLinkCandidate[] {
  const rows = db
    .prepare('SELECT * FROM canonical_provider_link_candidates WHERE provider = ? AND providerGameId = ? ORDER BY candidateCanonicalGameId')
    .all(provider, providerGameId) as CandidateRow[];
  return rows.map(rowToCandidate);
}

/** All POSSIBLE/AMBIGUOUS candidates awaiting review, across every provider record. */
export function listAllLinkCandidatesNeedingReview(): CanonicalProviderLinkCandidate[] {
  const rows = db
    .prepare("SELECT * FROM canonical_provider_link_candidates WHERE confidence IN ('POSSIBLE', 'AMBIGUOUS') ORDER BY observedAt DESC")
    .all() as CandidateRow[];
  return rows.map(rowToCandidate);
}
