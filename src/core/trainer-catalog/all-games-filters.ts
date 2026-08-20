import type { TrainerCatalogEntry } from './types.js';
import type { InstallPlatform } from '../install-discovery/types.js';

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

/**
 * ROADMAP §3.6 Launcher. V1 semantics: detected install platform for
 * installed games only. Reuses the exact InstallPlatform enum — no
 * separate storefront-availability model for uninstalled entries exists.
 */
export type TrainerLibraryLauncherFilter = InstallPlatform;

export interface TrainerLibraryFilterState {
  availability: TrainerLibraryAvailabilityFilter[];
  catalog: TrainerLibraryCatalogFilter[];
  /** Optional so the pre-existing 19-value call sites remain unchanged. */
  launcher?: TrainerLibraryLauncherFilter[];
}

export interface TrainerLibraryFilterContext {
  installedCatalogGameIds?: Set<string>;
  /** Membership in the existing §3.3 Popular projection over the eligible catalog. */
  popularCatalogGameIds?: Set<string>;
  /**
   * Detected install platform(s) per catalogGameId, from installed_games
   * evidence only. Never derived from steamAppId or any other inferred ID —
   * an entry absent from this map is treated as having no launcher evidence,
   * not as belonging to a default platform.
   */
  installedPlatformsByCatalogGameId?: Map<string, Set<InstallPlatform>>;
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

/** Exact ROADMAP §3.6 Launcher labels, mapped to the actual InstallPlatform enum. */
export const TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS: Record<TrainerLibraryLauncherFilter, string> = {
  steam: 'Steam',
  gog: 'GOG',
  epic: 'Epic Games Store',
  ubisoft: 'Ubisoft Connect',
  ea: 'EA app',
  xbox: 'Xbox / Microsoft Store',
  battlenet: 'Battle.net',
  manual: 'Standalone',
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

function matchesLauncher(
  entry: TrainerCatalogEntry,
  selected: TrainerLibraryLauncherFilter[],
  context: TrainerLibraryFilterContext,
): boolean {
  if (selected.length === 0) return true;
  // Uninstalled entries carry no launcher evidence at all — they never match,
  // never fall back to a default platform. steamAppId is deliberately unused.
  const platforms = context.installedPlatformsByCatalogGameId?.get(entry.catalogGameId);
  if (!platforms) return false;
  return selected.some((filter) => platforms.has(filter));
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
      matchesCatalog(entry, filters.catalog, context) &&
      matchesLauncher(entry, filters.launcher ?? [], context),
  );
}
