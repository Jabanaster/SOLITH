import type { TrainerCatalogEntry } from './types.js';
import { steamCdnImages } from './types.js';

function isAlreadyBrowserSafeImageUrl(url: string): boolean {
  return /^(https?:|data:|blob:|solith-asset:|\/(?![A-Za-z]:)|\.\/|\.\.\/)/i.test(url);
}

function looksLikeLocalFileReference(url: string): boolean {
  return /^file:\/\//i.test(url) || /^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\\\');
}

/** Route local cover files through Electron's guarded protocol instead of raw file://. */
export function toSolithAssetUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (isAlreadyBrowserSafeImageUrl(url) && !/^file:\/\//i.test(url)) return url;
  if (!looksLikeLocalFileReference(url)) return url;
  return `solith-asset://local/${encodeURIComponent(url)}`;
}

/** Resolve Steam library cover art for catalog cards (all real Steam app IDs). */
export function resolveCatalogCoverUrl(entry: TrainerCatalogEntry): string | undefined {
  if (entry.coverUrl) return toSolithAssetUrl(entry.coverUrl);
  if (entry.steamAppId && entry.steamAppId > 0) {
    return steamCdnImages(entry.steamAppId).coverUrl;
  }
  return toSolithAssetUrl(entry.headerUrl);
}

export function resolveCatalogHeaderUrl(entry: TrainerCatalogEntry): string | undefined {
  if (entry.headerUrl) return toSolithAssetUrl(entry.headerUrl);
  if (entry.steamAppId && entry.steamAppId > 0) {
    return steamCdnImages(entry.steamAppId).headerUrl;
  }
  return undefined;
}
