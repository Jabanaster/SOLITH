import type { TrainerCatalogEntry } from './types.js';
import { steamCdnImages } from './types.js';

/** Resolve Steam library cover art for catalog cards (all real Steam app IDs). */
export function resolveCatalogCoverUrl(entry: TrainerCatalogEntry): string | undefined {
  if (entry.coverUrl) return entry.coverUrl;
  if (entry.steamAppId && entry.steamAppId > 0) {
    return steamCdnImages(entry.steamAppId).coverUrl;
  }
  return entry.headerUrl;
}

export function resolveCatalogHeaderUrl(entry: TrainerCatalogEntry): string | undefined {
  if (entry.headerUrl) return entry.headerUrl;
  if (entry.steamAppId && entry.steamAppId > 0) {
    return steamCdnImages(entry.steamAppId).headerUrl;
  }
  return undefined;
}
