import type { TrainerCatalogEntry } from './types.js';

/** ROADMAP §3.6 — evidence-backed Availability subset only. */
export type TrainerLibraryAvailabilityFilter =
  | 'installed'
  | 'not-installed'
  | 'has-trainer-profile'
  | 'verified'
  | 'community-unverified';

/** ROADMAP §3.6 — evidence-backed Catalog subset only. */
export type TrainerLibraryCatalogFilter =
  | 'popular'
  | 'new-release'
  | 'niche-deep-catalog'
  | 'recently-added';

export interface TrainerLibraryFilterState {
  availability: TrainerLibraryAvailabilityFilter[];
  catalog: TrainerLibraryCatalogFilter[];
}

export interface TrainerLibraryFilterContext {
  installedCatalogGameIds?: Set<string>;
  /** Membership in the existing §3.3 Popular projection over the eligible catalog. */
  popularCatalogGameIds?: Set<string>;
}

export const TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS: Record<TrainerLibraryAvailabilityFilter, string> = {
  installed: 'Installed',
  'not-installed': 'Not installed',
  'has-trainer-profile': 'Has trainer/profile',
  verified: 'Verified',
  'community-unverified': 'Community/unverified',
};

export const TRAINER_LIBRARY_CATALOG_FILTER_LABELS: Record<TrainerLibraryCatalogFilter, string> = {
  popular: 'Popular',
  'new-release': 'New release',
  'niche-deep-catalog': 'Niche/deep catalog',
  'recently-added': 'Recently added',
};

function hasValidTimestamp(value: string | undefined): boolean {
  return Boolean(value) && !Number.isNaN(Date.parse(value!));
}

function matchesAvailability(
  entry: TrainerCatalogEntry,
  selected: TrainerLibraryAvailabilityFilter[],
  context: TrainerLibraryFilterContext,
): boolean {
  if (selected.length === 0) return true;
  const installed = context.installedCatalogGameIds?.has(entry.catalogGameId) ?? false;
  return selected.some((filter) => {
    switch (filter) {
      case 'installed':
        return installed;
      case 'not-installed':
        return !installed;
      case 'has-trainer-profile':
        return entry.hasModPack === true;
      case 'verified':
        return entry.verificationStatus === 'verified';
      case 'community-unverified':
        return entry.verificationStatus !== 'verified';
    }
  });
}

function matchesCatalog(
  entry: TrainerCatalogEntry,
  selected: TrainerLibraryCatalogFilter[],
  context: TrainerLibraryFilterContext,
): boolean {
  if (selected.length === 0) return true;
  const popularIds = context.popularCatalogGameIds;
  return selected.some((filter) => {
    switch (filter) {
      case 'popular':
        return popularIds?.has(entry.catalogGameId) ?? false;
      case 'niche-deep-catalog':
        // Niche was owner-accepted as the complement of the established Popular projection.
        // Missing projection evidence is not interpreted as "niche".
        return popularIds ? !popularIds.has(entry.catalogGameId) : false;
      case 'new-release':
        // §3.6 has no owner-defined age window. The bounded slice therefore filters
        // only on trustworthy release-date evidence and never invents recency.
        return hasValidTimestamp(entry.releaseDate);
      case 'recently-added':
        // Same evidence-only rule as New release: createdAt is immutable insertion
        // evidence; legacy/unknown/malformed timestamps do not match.
        return hasValidTimestamp(entry.createdAt);
    }
  });
}

/**
 * ROADMAP §3.6 derived filter projection.
 *
 * Multi-select semantics are OR within a category and AND across categories.
 * The input array is never mutated.
 */
export function filterTrainerLibraryEntries(
  entries: TrainerCatalogEntry[],
  filters: TrainerLibraryFilterState,
  context: TrainerLibraryFilterContext = {},
): TrainerCatalogEntry[] {
  return entries.filter(
    (entry) =>
      matchesAvailability(entry, filters.availability, context) &&
      matchesCatalog(entry, filters.catalog, context),
  );
}
