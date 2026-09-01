import { createHash } from 'node:crypto';
import { normalizeCatalogTitle } from './normalize-title.js';
import type { TrainerCatalogEntry } from './types.js';

export type IdentityReviewReason =
  | 'slug-collision'
  | 'title-source-ambiguity'
  | 'metadata-conflict'
  | 'identity-conflict';

export type IdentityReviewStatus = 'pending' | 'resolved' | 'ignored';

export type IdentityReviewResolution =
  | 'keep-existing'
  | 'accept-incoming'
  | 'treat-separate'
  | 'ignore';

/**
 * Review-safe snapshot of a catalog record: the structured catalog entry plus the
 * provider/source that produced it. No raw HTML and no ModPack cheat payloads are
 * ever stored here — only the same small, structured fields already persisted in
 * trainer_catalog_games — which is what lets "accept incoming" / "treat separate"
 * resolutions write a complete entry later without re-fetching anything.
 */
export interface IdentityReviewRecordSummary {
  entry: TrainerCatalogEntry;
  provider: string;
  sourceUrl?: string;
}

export interface IdentityReviewItem {
  id: string;
  reason: IdentityReviewReason;
  status: IdentityReviewStatus;
  leftRecord: IdentityReviewRecordSummary;
  rightRecord: IdentityReviewRecordSummary;
  resolution?: IdentityReviewResolution;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface IncomingCatalogWrite {
  entry: TrainerCatalogEntry;
  provider: string;
  sourceUrl?: string;
}

const stripToAlnum = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function toRecordSummary(
  entry: TrainerCatalogEntry,
  provider: string,
  sourceUrl: string | undefined,
): IdentityReviewRecordSummary {
  return { entry, provider, sourceUrl };
}

/**
 * Deterministic fingerprint for a (catalogGameId, incoming provider+source) pair,
 * so the same unresolved collision reuses one review row instead of duplicating.
 */
export function computeIdentityReviewFingerprint(
  catalogGameId: string,
  provider: string,
  sourceUrl: string | undefined,
): string {
  const hash = createHash('sha256');
  hash.update(catalogGameId);
  hash.update('|');
  hash.update(provider);
  hash.update('|');
  hash.update(sourceUrl ?? '');
  return hash.digest('hex').slice(0, 32);
}

/**
 * Decides whether writing `incoming` over `existing` (same catalogGameId) is safe to
 * auto-upsert, or must be deferred to manual review. Returns null when safe.
 *
 * False-positive guards (Step 12): identical post-hygiene titles, or a resync from a
 * source already recorded on the existing entry, are never flagged.
 */
export function detectIdentityCollision(
  existing: TrainerCatalogEntry,
  incoming: IncomingCatalogWrite,
): { reason: IdentityReviewReason; fingerprint: string } | null {
  const normExisting = normalizeCatalogTitle(existing.displayName);
  const normIncoming = normalizeCatalogTitle(incoming.entry.displayName);

  const steamConflict =
    existing.steamAppId != null &&
    incoming.entry.steamAppId != null &&
    existing.steamAppId !== incoming.entry.steamAppId;

  if (normExisting !== null && normExisting === normIncoming && !steamConflict) {
    return null;
  }

  const alreadyKnownSource = existing.sources.some(
    (source) => source.provider === incoming.provider && source.url === incoming.sourceUrl,
  );
  if (alreadyKnownSource && !steamConflict) {
    return null;
  }

  const fingerprint = computeIdentityReviewFingerprint(
    existing.catalogGameId,
    incoming.provider,
    incoming.sourceUrl,
  );

  if (steamConflict) {
    return { reason: 'metadata-conflict', fingerprint };
  }

  if (
    normExisting !== null &&
    normIncoming !== null &&
    stripToAlnum(normExisting) === stripToAlnum(normIncoming)
  ) {
    return { reason: 'slug-collision', fingerprint };
  }

  const knownProviderDifferentSource = existing.sources.some(
    (source) => source.provider === incoming.provider && source.url !== incoming.sourceUrl,
  );
  if (knownProviderDifferentSource) {
    return { reason: 'identity-conflict', fingerprint };
  }

  return { reason: 'title-source-ambiguity', fingerprint };
}

export function buildIdentityReviewRecords(
  existing: TrainerCatalogEntry,
  incoming: IncomingCatalogWrite,
): { leftRecord: IdentityReviewRecordSummary; rightRecord: IdentityReviewRecordSummary } {
  const existingSource = existing.sources[0];
  return {
    leftRecord: toRecordSummary(existing, existingSource?.provider ?? 'unknown', existingSource?.url),
    rightRecord: toRecordSummary(incoming.entry, incoming.provider, incoming.sourceUrl),
  };
}

/** Deterministic, stable id for a "treat as separate" resolution — no random ids. */
export function buildSeparateIdentityCatalogGameId(originalCatalogGameId: string, provider: string): string {
  return `${originalCatalogGameId}--${provider}`;
}
