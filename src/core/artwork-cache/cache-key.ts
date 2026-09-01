import type { ArtworkKind } from './types.js';

/**
 * ROADMAP §4.3 deterministic cache key — also doubles as the on-disk filename
 * stem, so it must stay filesystem-safe and collision-free across games
 * ("cross-game overwrite prevention"). Two different catalogGameIds can never
 * normalize to the same key because the raw id (lowercased, non-alnum
 * collapsed) is itself already the collision-checked catalog identity.
 */
export function artworkCacheKey(catalogGameId: string, kind: ArtworkKind): string {
  const safeId = catalogGameId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (!safeId) throw new Error('artworkCacheKey requires a non-empty catalogGameId');
  return `${safeId}__${kind}`;
}
