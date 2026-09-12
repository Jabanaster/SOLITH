import type { ArtworkFetchJob, ArtworkFetchPriorityTier, ArtworkKind } from './types.js';
import { steamCdnImages, type TrainerCatalogEntry } from '../trainer-catalog/types.js';
import { artworkCacheKey } from './cache-key.js';

/**
 * ROADMAP Mission 4 — automatic, safe, asynchronous artwork-cache
 * population for the user's OWN personal games only (never the full
 * ~6,800-row catalog). This module is a pure, side-effect-free job builder:
 * it never touches the network, disk, or database itself — it only decides
 * WHICH jobs to enqueue and at WHAT priority, then hands them to the
 * existing queue/fetch-executor/fetch-policy machinery
 * (src/core/artwork-cache/{queue,fetch-executor,fetch-policy}.ts) exactly
 * the same way electron/artwork-cache-ipc.ts's Settings-page manual refresh
 * already does. No second fetch pipeline is built here.
 *
 * Five personal-library priority signals, highest first:
 *   Running > Installed > Confirmed Owned > Favorites > Recently Detected
 *
 * mapped 1:1 (rank-preserving) onto the five EXISTING ArtworkFetchPriorityTier
 * values in types.ts (ARTWORK_FETCH_PRIORITY_ORDER, also highest-first):
 *   'visible' | 'installed' | 'favorite' | 'popular' | 'deep-catalog'
 *
 *   Running          -> 'visible'      (what the user is looking at right now)
 *   Installed         -> 'installed'    (direct name match, and the same
 *                                        tier the existing retry-missing
 *                                        path already uses)
 *   Confirmed Owned   -> 'favorite'     (no dedicated "owned" tier exists;
 *                                        this is the next-highest slot)
 *   Favorites         -> 'popular'      (reuses the tier the catalog
 *                                        candidate-job builder already uses
 *                                        for its own "no explicit scope"
 *                                        fallback — 'favorite' is taken by
 *                                        Confirmed Owned above)
 *   Recently Detected -> 'deep-catalog' (lowest personal-library priority,
 *                                        matches the lowest existing tier)
 *
 * This is an ORDINAL reuse of the existing tier enum (queue.ts's
 * priorityRank is just `ARTWORK_FETCH_PRIORITY_ORDER.indexOf(tier)`), not a
 * claim that e.g. "Favorites" IS the catalog's notion of "popular" — the
 * tier names predate this feature and are reused for their rank, not their
 * label.
 *
 * A game can qualify for more than one signal at once (e.g. running AND
 * favorited); only the SINGLE highest-ranked tier is used per game — this
 * builder never emits duplicate jobs for the same (catalogGameId, kind).
 */
export type PersonalGamePriorityLevel = 'running' | 'installed' | 'confirmed-owned' | 'favorite' | 'recently-detected';

export const PERSONAL_GAME_PRIORITY_TIER_MAP: Record<PersonalGamePriorityLevel, ArtworkFetchPriorityTier> = {
  running: 'visible',
  installed: 'installed',
  'confirmed-owned': 'favorite',
  favorite: 'popular',
  'recently-detected': 'deep-catalog',
};

export interface PersonalGameArtworkCandidate {
  catalogGameId: string;
  running: boolean;
  installed: boolean;
  confirmedOwned: boolean;
  favorite: boolean;
  recentlyDetected: boolean;
  /**
   * Same 'trusted'/'weak' identity-confidence gate cover-url.ts's
   * `ArtworkCanonicalConfidence` already enforces for provider-derived
   * artwork. Computed by the caller from the game's REAL identity signal
   * (e.g. PersonalLibraryGame.canonicalConfidence 'EXACT'/'HIGH' ->
   * 'trusted', 'POSSIBLE'/'UNKNOWN' -> 'weak'). A 'weak' candidate is NEVER
   * queued by this module — fuzzy/title-only identity must never trigger an
   * automatic background fetch, only an explicit user action can.
   */
  canonicalConfidence: 'trusted' | 'weak';
}

function highestPriorityLevel(candidate: PersonalGameArtworkCandidate): PersonalGamePriorityLevel | null {
  if (candidate.running) return 'running';
  if (candidate.installed) return 'installed';
  if (candidate.confirmedOwned) return 'confirmed-owned';
  if (candidate.favorite) return 'favorite';
  if (candidate.recentlyDetected) return 'recently-detected';
  return null;
}

const FILL_KINDS: ArtworkKind[] = ['header', 'cover', 'icon'];

/**
 * Discovery Master Pass, Stage 2 — narrowed to the 4 fields this function
 * actually reads, so a Discovery-only game (no trainer-catalog row, but a
 * real Steam AppID from discovery_catalog_entries.providerIds) can supply a
 * lightweight object here instead of requiring a full, partly-fabricated
 * TrainerCatalogEntry. Every real TrainerCatalogEntry still satisfies this
 * type, so existing callers are unaffected.
 */
export type ArtworkUrlSource = Pick<TrainerCatalogEntry, 'steamAppId' | 'headerUrl' | 'coverUrl' | 'iconUrl'>;

/**
 * Mirrors electron/artwork-cache-ipc.ts's own `candidateUrlsForEntry`
 * exactly (curated entry URL first, Steam-CDN-derived URL as fallback).
 * Duplicated deliberately rather than imported: that module is Electron
 * main-process-only (imports `app`/`ipcMain`), while this module must stay
 * a plain, dependency-free core module usable both from the IPC handler and
 * from Node unit tests with no Electron runtime.
 */
function candidateUrlsForEntry(entry: ArtworkUrlSource): Partial<Record<ArtworkKind, string>> {
  const derived = entry.steamAppId ? steamCdnImages(entry.steamAppId) : {};
  return {
    header: entry.headerUrl ?? derived.headerUrl,
    cover: entry.coverUrl ?? derived.coverUrl,
    icon: entry.iconUrl ?? derived.iconUrl,
  };
}

export interface BuildPersonalGamePriorityFillJobsOptions {
  /**
   * Cache keys (artworkCacheKey(catalogGameId, kind) format) to exclude
   * outright. Callers MUST include every key that already has ANY recorded
   * attempt — 'ok', 'failed', AND 'rights-blocked', not only 'ok' — so this
   * builder never re-queues a just-failed or just-blocked fetch on every
   * app launch/render. This is the request-storm guard required by ROADMAP
   * Mission 6 ("no repeated-fetch-loop-on-every-render for a failed/missing
   * entry"); retrying a 'failed' entry stays an explicit, separate action
   * (the existing "Retry Missing" Settings-page flow), never automatic.
   */
  skipCacheKeys?: ReadonlySet<string>;
}

/**
 * Pure job builder: filters candidates to trusted-identity personal games
 * missing a cache attempt, ranks them by the priority mapping above, and
 * returns ArtworkFetchJob[] ready to hand to `runArtworkFetchQueue`
 * (queue.ts) via the same executor (`fetchArtworkJob`, fetch-executor.ts)
 * every other artwork-cache entry point already uses. Never mutates its
 * inputs; never throws for a malformed individual candidate (skips it).
 */
export function buildPersonalGamePriorityFillJobs(
  candidates: PersonalGameArtworkCandidate[],
  catalogEntriesById: Record<string, ArtworkUrlSource>,
  options: BuildPersonalGamePriorityFillJobsOptions = {},
): ArtworkFetchJob[] {
  const skip = options.skipCacheKeys ?? new Set<string>();
  const jobs: ArtworkFetchJob[] = [];

  for (const candidate of candidates) {
    // Never fuzzy-match: only an exact/high-confidence canonical identity
    // may trigger an automatic fetch.
    if (candidate.canonicalConfidence !== 'trusted') continue;

    const level = highestPriorityLevel(candidate);
    if (!level) continue; // no personal-library signal at all — nothing to prioritize

    const entry = catalogEntriesById[candidate.catalogGameId];
    if (!entry) continue; // no catalog identity resolved — nothing to fetch a URL for

    const priority = PERSONAL_GAME_PRIORITY_TIER_MAP[level];
    const urls = candidateUrlsForEntry(entry);

    for (const kind of FILL_KINDS) {
      const sourceUrl = urls[kind];
      if (!sourceUrl) continue;

      const cacheKey = artworkCacheKey(candidate.catalogGameId, kind);
      if (skip.has(cacheKey)) continue;

      jobs.push({
        catalogGameId: candidate.catalogGameId,
        kind,
        sourceUrl,
        priority,
        // Same rights classification electron/artwork-cache-ipc.ts's
        // existing manual-refresh candidate builder already assigns to
        // every URL this function can currently derive (curated-but-
        // unverified, or Steam CDN) — see ROADMAP §4.2 in types.ts. This
        // module changes WHEN and WHICH jobs get queued; it does not, and
        // must not, change the persistent-cache rights policy itself. The
        // fetch-executor/cache-writer rights gate still applies downstream
        // exactly as it does for every other entry point.
        rightsClass: 'remote-unverified-rights',
      });
    }
  }

  return jobs;
}
