/**
 * Discovery Master Pass, Stage 2 — GameDetailPage identity/resolution audit.
 *
 * GameDetailPage originally resolved a game ONLY via `myGames.find(...)`
 * (the personal-library projection): any id not already installed, owned,
 * or favorited rendered "This game is no longer in your library" — which is
 * WRONG for the normal Discovery browsing case (a game the user has not yet
 * favorited/installed/owned). This module builds an honest, non-fabricated
 * `PersonalLibraryGame` view model for that case, from real Discovery-
 * catalog (and, when available, trainer-catalog) data — never claiming
 * install/ownership evidence that doesn't exist.
 *
 * Every field mirrors the SAME honesty rules already established in
 * personal-library-my-games.ts's Discovery-catalog fallback (Stage 1):
 * trainerAvailability caps at 'COMMUNITY' (never 'VERIFIED') when resolved
 * only from Discovery's coarse boolean signal, canonicalConfidence is
 * 'UNKNOWN' (no install-based identity evidence exists for a
 * not-yet-personal game), and every evidence array stays empty rather than
 * fabricated.
 */
import type { PersonalLibraryGame } from '../../core/personal-library/model.js';
import type { DiscoveryCatalogEntry } from '../../core/discovery-catalog/types.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';

export function buildNonPersonalGameDetailView(
  gameId: string,
  discoveryEntry: DiscoveryCatalogEntry | null,
  trainerEntry: TrainerCatalogEntry | null,
  isFavorite: boolean,
): PersonalLibraryGame | null {
  if (!discoveryEntry && !trainerEntry) return null;

  const title = trainerEntry?.displayName ?? discoveryEntry?.title ?? gameId;

  let trainerAvailability: PersonalLibraryGame['trainerAvailability'] = 'NONE';
  let trainerCount = 0;
  if (trainerEntry) {
    if (trainerEntry.verificationStatus === 'verified') {
      trainerAvailability = 'VERIFIED';
      trainerCount = trainerEntry.cheatCount ?? 0;
    } else if (trainerEntry.hasModPack || trainerEntry.verificationStatus === 'community') {
      trainerAvailability = 'COMMUNITY';
      trainerCount = trainerEntry.cheatCount ?? 0;
    }
  } else if (discoveryEntry?.trainerAvailable) {
    trainerAvailability = 'COMMUNITY';
  }

  return {
    gameId,
    title,
    running: false,
    installed: false,
    owned: 'unknown',
    favorite: isFavorite,
    recentlyDetected: false,
    launchers: [],
    installEvidence: [],
    ownershipEvidence: [],
    canonicalConfidence: 'UNKNOWN',
    trainerAvailability,
    trainerCount,
    trainerAccuracy: trainerAvailability === 'NONE' ? 'NONE' : 'VERSION_UNKNOWN',
    versionEvidence: [],
  };
}
