export type ArtworkKind = 'header' | 'cover' | 'icon';

/**
 * ROADMAP §4.2 artwork rights/provenance classification — governs whether an
 * asset may enter SOLITH's *persistent* managed cache. Technical fetchability
 * is not permission to persist: only 'solith-owned', 'explicitly-licensed',
 * and 'user-provided' may ever be written to disk (see
 * fetch-policy.ts#isPersistableRightsClass and
 * cache-writer.ts#writeArtworkFileAtomic, which enforces this as a hard
 * core-level gate, not a UI-only restriction). 'remote-unverified-rights' is
 * the default — and currently only — classification for any third-party
 * remote source (Steam CDN included) until a specific documented permission
 * basis exists; it is never auto-promoted by a successful download, and
 * nothing in the IPC/renderer boundary can self-assert a different class.
 */
export type ArtworkRightsClass = 'solith-owned' | 'explicitly-licensed' | 'user-provided' | 'remote-unverified-rights';

/** 'rights-blocked' is not an error — it records that a source was correctly refused persistent storage under the current rights policy. It is distinct from 'failed' so "retry missing artwork" never retries something retrying can't fix. */
export type ArtworkCacheStatus = 'ok' | 'failed' | 'pending' | 'rights-blocked';

export interface ArtworkCacheEntry {
  catalogGameId: string;
  kind: ArtworkKind;
  sourceUrl: string;
  rightsClass: ArtworkRightsClass;
  /** Optional license identifier/note — only ever meaningful for 'explicitly-licensed' entries. */
  licenseNote?: string;
  localPath: string;
  sizeBytes: number;
  status: ArtworkCacheStatus;
  fetchedAt: string;
  lastError?: string;
}

/** ROADMAP §4.5 background-fetch priority tiers, highest priority first. */
export const ARTWORK_FETCH_PRIORITY_ORDER = ['visible', 'installed', 'favorite', 'popular', 'deep-catalog'] as const;
export type ArtworkFetchPriorityTier = (typeof ARTWORK_FETCH_PRIORITY_ORDER)[number];

export interface ArtworkFetchJob {
  catalogGameId: string;
  kind: ArtworkKind;
  sourceUrl: string;
  priority: ArtworkFetchPriorityTier;
  /** Assigned by trusted job-building code only (electron/artwork-cache-ipc.ts) — never sourced from renderer/IPC input. */
  rightsClass: ArtworkRightsClass;
}
