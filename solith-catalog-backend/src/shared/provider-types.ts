/**
 * Phase 3.2 — minimal mirror of the main repo's
 * src/core/provider-catalog/types.ts ProviderGameRecord shape, kept in sync
 * manually (see shared/README.md). Only the fields the backend's matching
 * logic actually needs are duplicated here.
 */
export type ProviderCatalogRecordType = 'game' | 'dlc' | 'demo' | 'tool' | 'soundtrack' | 'server' | 'other';

export interface ProviderGameRecord {
  provider: string;
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
  rawRevision?: string;
}
