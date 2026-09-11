import type { ArtworkCacheEntry } from './types.js';

/**
 * ROADMAP Phase 1 online-foundation, Mission 14 — the artwork STATE a UI
 * would render for a given game's artwork slot. This is deliberately a
 * DIFFERENT concept from `ArtworkCacheStatus` (types.ts): that type records
 * the outcome of a single cache-fetch *job* ('ok' | 'failed' | 'pending' |
 * 'rights-blocked'). `ArtworkResolutionState` is the higher-level RESOLVED
 * PRESENTATION state — it additionally accounts for a user-provided/custom
 * override (which has no fetch job at all) and for whether the game is
 * currently a "personal" game (favorited/installed/owned/running/recently
 * detected), which determines whether an absent cache entry should present
 * as "nothing to show" (NONE) or "artwork could be fetched" (PROVIDER_AVAILABLE).
 *
 * Nothing here decides whether a fetch is attempted — that remains
 * personal-game-priority-fill.ts's job. This module is pure presentation
 * derivation, consumed by UI code deciding what to render for one artwork
 * slot.
 */
export type ArtworkResolutionState =
  | 'NONE'
  | 'LOCAL_CUSTOM'
  | 'LOCAL_CACHED_PROVIDER'
  | 'PROVIDER_AVAILABLE'
  | 'FAILED'
  | 'RIGHTS_BLOCKED';

export interface DeriveArtworkResolutionStateInput {
  /** True when the user has supplied their own artwork for this slot. Always wins — custom art overrides provider art per the owner's explicit requirement. */
  hasCustomArtwork: boolean;
  /** The most recent artwork-cache record for this (game, kind), if any fetch was ever attempted. */
  cacheEntry?: ArtworkCacheEntry;
  /** True when this game currently has ANY personal-library signal (favorite, installed, owned, running, recently detected) — mirrors personal-game-priority-fill.ts's notion of "personal". */
  isPersonal: boolean;
}

/**
 * Pure function: derives the single ArtworkResolutionState a UI should
 * render for one artwork slot. `hasCustomArtwork` short-circuits everything
 * else — a custom override is shown regardless of what the provider-fetch
 * pipeline did or didn't do. Otherwise the state comes from the cache
 * entry's status; a 'pending' entry (or no entry at all) only reads as
 * PROVIDER_AVAILABLE for a personal game — a Discovery-only (non-personal)
 * game with no cache entry has nothing eligible to fetch, so it reads NONE.
 */
export function deriveArtworkResolutionState(
  input: DeriveArtworkResolutionStateInput,
): ArtworkResolutionState {
  if (input.hasCustomArtwork) return 'LOCAL_CUSTOM';

  const { cacheEntry, isPersonal } = input;

  if (!cacheEntry) return isPersonal ? 'PROVIDER_AVAILABLE' : 'NONE';

  switch (cacheEntry.status) {
    case 'ok':
      return 'LOCAL_CACHED_PROVIDER';
    case 'failed':
      return 'FAILED';
    case 'rights-blocked':
      return 'RIGHTS_BLOCKED';
    case 'pending':
      return isPersonal ? 'PROVIDER_AVAILABLE' : 'NONE';
    default:
      return 'NONE';
  }
}
