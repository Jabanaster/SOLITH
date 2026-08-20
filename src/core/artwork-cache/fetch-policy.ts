/**
 * ROADMAP §4.3/§4.5 download-layer policy. Pure, side-effect-free predicates —
 * the actual network fetch (electron/artwork-cache-ipc.ts) must consult every
 * function here before writing anything to disk.
 */
import type { ArtworkRightsClass } from './types.js';

/**
 * ROADMAP §4.2 persistent-cache rights gate. Only these three classes may
 * ever be written to SOLITH's managed artwork cache — 'remote-unverified-rights'
 * (the default for any third-party remote source, Steam CDN included) is
 * deliberately excluded. This is the single source of truth consulted by
 * both fetch-executor.ts (to skip a pointless network fetch) and
 * cache-writer.ts (the actual, unbypassable enforcement point).
 */
const PERSISTABLE_ARTWORK_RIGHTS_CLASSES: ReadonlySet<ArtworkRightsClass> = new Set([
  'solith-owned',
  'explicitly-licensed',
  'user-provided',
]);

export function isPersistableRightsClass(rightsClass: ArtworkRightsClass): boolean {
  return PERSISTABLE_ARTWORK_RIGHTS_CLASSES.has(rightsClass);
}

/** Steam's CDN hosts, the only artwork source currently wired via steamCdnImages(). Extend deliberately, never widen to a wildcard. */
const ALLOWED_ARTWORK_HOSTS = new Set([
  'cdn.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'cdn.steamstatic.com',
]);

export const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
export const MAX_ARTWORK_REDIRECTS = 3;

const ALLOWED_ARTWORK_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isAllowedArtworkUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && ALLOWED_ARTWORK_HOSTS.has(url.hostname);
}

function baseContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

/** SVG is explicitly rejected, never rasterized — ROADMAP §4.3 "reject unsafe SVG or rasterize safely" resolves to reject, since no safe rasterizer exists in this pipeline. */
export function isAllowedArtworkContentType(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  return ALLOWED_ARTWORK_CONTENT_TYPES.has(baseContentType(contentType));
}

export function extensionForContentType(contentType: string): string {
  switch (baseContentType(contentType)) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}
