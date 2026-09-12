import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';

/**
 * ROADMAP §online-foundation (Mission 3) — normalized external-provider game record.
 *
 * Maps 1:1 to the `provider_catalog_records` table (src/core/database/index.ts),
 * PRIMARY KEY (provider, providerGameId). This is raw per-provider catalog data
 * (Steam/GOG/etc), never a second source of truth for canonical identity — see
 * canonical-games/types.ts's CanonicalGame. A record may exist with no canonical
 * game link yet (catalog-only, e.g. browsable-but-not-owned/installed titles).
 *
 * All fields beyond the identity/title/type core are optional and MUST NOT be
 * fabricated when a provider does not actually supply them — leave undefined
 * rather than defaulting to a guessed value (see provider-capabilities.ts's
 * honesty requirements for what SOLITH can legitimately source per provider).
 */
export type ProviderCatalogRecordType = 'game' | 'dlc' | 'demo' | 'tool' | 'soundtrack' | 'server' | 'other';

export interface ProviderGameRecord {
  provider: LinkedLibraryProvider;
  providerGameId: string;
  title: string;
  type: ProviderCatalogRecordType;
  storeUrl?: string;
  releaseDate?: string;
  developer?: string;
  publisher?: string;
  genres?: string[];
  tags?: string[];
  rating?: number;
  ratingSource?: string;
  popularityRank?: number;
  popularitySource?: string;
  lastUpdated: string;
  /**
   * Phase 3 — opaque provider-supplied revision/change marker (an eTag, a
   * "last modified" value, or any other provider-specific token proving this
   * exact record changed), used ONLY to decide whether a re-fetched record
   * needs to be written again. Never parsed/interpreted cross-provider —
   * Steam's, Epic's, and GOG's revision markers have no shared meaning.
   */
  rawRevision?: string;
}
