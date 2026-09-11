/**
 * Discovery Catalog — lightweight local catalog record (Mission 6, Phase 1
 * online-foundation).
 *
 * This is a NEW, deliberately lightweight table — separate from
 * `trainer_catalog_games` (src/core/trainer-catalog/), which is the
 * trainer-coverage-focused catalog with real artwork URLs and is NOT what
 * this table is for. Per the owner's brief: "no bundled third-party
 * artwork", designed to hold 10,000-100,000+ shipped local records for
 * offline title discovery/search — title, aliases, provider IDs, basic
 * classification, and a trainer/CT availability signal only.
 *
 * Maps 1:1 to the `discovery_catalog_entries` table defined in
 * src/core/database/index.ts's applySchema(). Do not add fields here that
 * are not backed by an actual column — see that schema for the exact
 * column list before editing this interface.
 */

import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';

/** Matches discovery_catalog_entries.type — free-form today, kept as string to avoid over-constraining ingestion. */
export type DiscoveryCatalogEntryType = string;

export interface DiscoveryCatalogEntry {
  /** Primary key — column `solithGameId`. */
  solithGameId: string;
  title: string;
  normalizedTitle: string;
  /** Column `aliasesJson` (TEXT, JSON-encoded string array). */
  aliases: string[];
  /** Column `providerIdsJson` (TEXT, JSON-encoded object) — external per-provider catalog IDs, not local install evidence. */
  providerIds: Partial<Record<LinkedLibraryProvider, string>>;
  type: DiscoveryCatalogEntryType;
  /** Column `releaseDate` — ISO date string, optional. */
  releaseDate?: string;
  /** Column `releaseYear` — optional, indexed. */
  releaseYear?: number;
  /** Column `genresJson` (TEXT, JSON-encoded string array). */
  genres: string[];
  /** Column `tagsJson` (TEXT, JSON-encoded string array). */
  tags: string[];
  /** Column `trainerAvailable` (INTEGER 0/1), indexed. */
  trainerAvailable: boolean;
  /** Column `ctAvailable` (INTEGER 0/1). */
  ctAvailable: boolean;
  updatedAt: string;
}
