import type { TrainerCatalogEntry } from './types.js';
import { steamCdnImages } from './types.js';
import type { ArtworkKind } from '../artwork-cache/types.js';
import type { ArtworkCacheEntry } from '../artwork-cache/types.js';

/**
 * Core Product Completion audit, Mission 2 — narrow allowlist for image URLs
 * reaching `<img src>`. Only schemes this codebase actually produces are
 * permitted: `https:` (Steam CDN artwork, remote-synced catalog artwork) and
 * `solith-asset:` (Electron's own guarded local-file bridge). No producer
 * anywhere in this codebase ever emits `data:`/`blob:` artwork, and
 * `javascript:`/`vbscript:`/`http:`/raw `file:`/any unrecognized or
 * malformed URL is rejected outright rather than passed through — a
 * rejected/malformed URL resolves to `undefined` (no image), letting the
 * existing `fallbackArtworkTreatment` cover render in its place instead of
 * ever reaching the DOM.
 */
const ALLOWED_ABSOLUTE_SCHEMES = new Set(['https:', 'solith-asset:']);

/**
 * Root-relative or relative bundled-asset references only (`/x.png`,
 * `./x.png`, `../x.png`) — never a scheme, and never protocol-relative
 * (`//host/...`, which a browser resolves against the CURRENT page's
 * scheme and could otherwise be abused to silently load an unexpected origin).
 */
function isAllowedRelativePath(url: string): boolean {
  if (url.startsWith('//')) return false;
  return /^\.{1,2}\//.test(url) || url.startsWith('/');
}

function looksLikeLocalFileReference(url: string): boolean {
  return /^file:\/\//i.test(url) || /^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\\\');
}

/** Route local cover files through Electron's guarded protocol instead of raw file://. */
export function toSolithAssetUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (isAllowedRelativePath(url)) return url;
  if (looksLikeLocalFileReference(url)) {
    return `solith-asset://local/${encodeURIComponent(url)}`;
  }
  try {
    const parsed = new URL(url);
    return ALLOWED_ABSOLUTE_SCHEMES.has(parsed.protocol) ? url : undefined;
  } catch {
    // Malformed URL (fails WHATWG parsing) — fail closed to no image,
    // never a raw pass-through of unparseable/untrusted input.
    return undefined;
  }
}

/**
 * Audit + Mission 7 (partial) — identity-safety gate for provider-derived (Steam
 * CDN) artwork. 'trusted' means the catalogGameId this entry is being resolved
 * under is backed by an exact provider/catalog id (canonical-games/identity.ts
 * tier 1 `steam:<appId>` or tier 2 `catalog:<catalogGameId>`, surfaced as
 * `CanonicalGame.identityStatus === 'verified'`) — safe to serve Steam CDN
 * artwork keyed off `entry.steamAppId`. 'weak' means the link was only a
 * tier 3/4 executable-or-title match (`identityStatus === 'backfilled'`): the
 * catalog entry itself may be the WRONG edition/remaster for this installation,
 * so provider-derived artwork must not be served — a wrong image is worse than
 * the SOLITH fallback (owner's explicit rule). Callers resolving a catalog
 * entry directly by its own catalogGameId (e.g. browsing the Trainer Library
 * catalog list itself, never through an installed-game identity match) are
 * trusted by construction and may omit this — it defaults to 'trusted'.
 */
export type ArtworkCanonicalConfidence = 'trusted' | 'weak';

export interface CoverUrlOptions {
  canonicalConfidence?: ArtworkCanonicalConfidence;
}

type ArtworkCacheAccessors = {
  isInitialized: () => boolean;
  getArtworkCacheEntry: (catalogGameId: string, kind: ArtworkKind) => ArtworkCacheEntry | null | undefined;
};

let cacheAccessors: ArtworkCacheAccessors | null = null;
let cacheAccessorsUnavailable = false;

/**
 * Lazily and safely loads the DB-backed artwork cache accessors via dynamic
 * import. This module is used from BOTH main-process/Node contexts (unit
 * tests; electron/canonical-games-ipc.ts via
 * src/core/canonical-games/render-model.ts) and the Electron renderer bundle
 * (src/app/components/GameCard.tsx and other src/app/ callers, always
 * mounted via AppSidebar → SidebarQuickAccess). A static top-level
 * `import ... from '../database/index.js'` would crash the renderer at load
 * time — that module transitively calls fileURLToPath(import.meta.url) at
 * module scope (src/shared/app-paths.ts), which Vite's renderer build cannot
 * satisfy (node:url resolves to a browser shim without fileURLToPath there).
 * A dynamic import() defers evaluation to this point (a separate,
 * lazily-evaluated chunk) so any renderer-side failure rejects this promise
 * instead of throwing during initial bundle evaluation — caught below and
 * treated as "cache unavailable", which the resolution hierarchy already
 * handles gracefully (falls through to the next tier).
 */
function loadCacheAccessors(): Promise<ArtworkCacheAccessors | null> {
  if (cacheAccessors) return Promise.resolve(cacheAccessors);
  if (cacheAccessorsUnavailable) return Promise.resolve(null);
  return Promise.all([
    import('../database/index.js'),
    import('../artwork-cache/store.js'),
  ]).then(([dbModule, storeModule]) => {
    cacheAccessors = {
      isInitialized: dbModule.isInitialized,
      getArtworkCacheEntry: storeModule.getArtworkCacheEntry,
    };
    return cacheAccessors;
  }).catch(() => {
    cacheAccessorsUnavailable = true;
    return null;
  });
}

// Kick off loading immediately (module init) so main-process callers
// (canonical-games-ipc, tests) have accessors ready well before any real
// lookup happens — same-process dynamic import of a local module resolves
// on the order of a microtask, long before the first real request. In the
// renderer this same call simply fails once and permanently disables the
// cache tier for the session (see loadCacheAccessors' catch above).
void loadCacheAccessors();

/**
 * Mission 6/7 — locally cached artwork (see src/core/artwork-cache/*) takes
 * precedence over any remote URL. Only an 'ok' status entry is usable; a
 * 'failed'/'pending'/'rights-blocked' row means no verified local file exists,
 * so resolution continues to the next hierarchy step instead of pointing at a
 * non-existent or refused path.
 */
function resolveCachedArtworkUrl(catalogGameId: string, kind: ArtworkKind): string | undefined {
  // This module is called from contexts (unit tests, pure resolution
  // helpers, the renderer bundle) that never initialize the database, or
  // where the cache accessors failed/haven't finished loading yet — the
  // cache lookup is an enhancement, not a hard dependency, so any of those
  // cases must fall through to the rest of the hierarchy rather than throw.
  if (!cacheAccessors || !cacheAccessors.isInitialized()) return undefined;
  const cached = cacheAccessors.getArtworkCacheEntry(catalogGameId, kind);
  if (cached?.status === 'ok' && cached.localPath) return toSolithAssetUrl(cached.localPath);
  return undefined;
}

/**
 * Resolve cover art for catalog cards, in precedence order:
 *   1. locally cached artwork (artwork-cache store, status 'ok')
 *   2. trusted `entry.coverUrl` (curated/seed data, already allowlist-checked)
 *   3. provider-derived Steam CDN artwork — ONLY when canonicalConfidence is
 *      'trusted' (exact steamAppId/catalogGameId-backed identity), never for a
 *      weakly-matched (title-only) canonical identity
 *   4. `entry.headerUrl` as a last resort
 *   5. undefined — caller renders the existing SOLITH branded fallback
 */
export function resolveCatalogCoverUrl(entry: TrainerCatalogEntry, options?: CoverUrlOptions): string | undefined {
  const cached = resolveCachedArtworkUrl(entry.catalogGameId, 'cover');
  if (cached) return cached;
  if (entry.coverUrl) return toSolithAssetUrl(entry.coverUrl);
  const confidence = options?.canonicalConfidence ?? 'trusted';
  if (confidence === 'trusted' && entry.steamAppId && entry.steamAppId > 0) {
    return steamCdnImages(entry.steamAppId).coverUrl;
  }
  return toSolithAssetUrl(entry.headerUrl);
}

/** Same precedence as resolveCatalogCoverUrl, for the 'header' artwork kind. */
export function resolveCatalogHeaderUrl(entry: TrainerCatalogEntry, options?: CoverUrlOptions): string | undefined {
  const cached = resolveCachedArtworkUrl(entry.catalogGameId, 'header');
  if (cached) return cached;
  if (entry.headerUrl) return toSolithAssetUrl(entry.headerUrl);
  const confidence = options?.canonicalConfidence ?? 'trusted';
  if (confidence === 'trusted' && entry.steamAppId && entry.steamAppId > 0) {
    return steamCdnImages(entry.steamAppId).headerUrl;
  }
  return undefined;
}
