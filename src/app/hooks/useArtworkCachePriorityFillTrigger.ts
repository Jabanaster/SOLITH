/**
 * ROADMAP Mission 4 — renderer-side trigger for automatic artwork-cache
 * population, scoped to the user's OWN personal games only. Consumes the
 * SAME real data usePersonalLibraryGames.ts already produces (never a
 * second data source), converts it to the priority signals
 * personal-game-priority-fill.ts understands, and fires ONE fire-and-forget
 * IPC call (`window.electronAPI.artworkCachePriorityFill`) — never a direct
 * database or core/artwork-cache import. A direct-DB import from renderer
 * code is exactly the class of bug that caused an earlier P0 boot crash
 * this session (see cover-url.ts's `loadCacheAccessors` comment for the
 * same renderer/main-process boundary this hook respects); this hook stays
 * IPC-only, matching the existing Settings-page artwork refresh call.
 *
 * "Re-render once a fetch lands" — this app has no live cache-update event
 * today (the existing Settings-page manual refresh doesn't force-refresh
 * already-mounted cards either; ArtworkCacheSection.tsx only polls its own
 * progress counters). cover-url.ts's cache lookup is synchronous and reads
 * fresh on every call, so a card that (re)mounts after a background fetch
 * completes picks up the newly-cached image for free — no new event bus is
 * introduced here, matching this app's existing pattern rather than adding
 * a new one for a single caller.
 *
 * Never blocks rendering: this hook triggers a `useEffect` side effect only
 * and returns nothing — callers do not await or gate UI on it.
 */
import { useEffect, useRef } from 'react';
import type { GameCardData } from '../components/game-card-status.js';
import type { PersonalLibraryGame } from '../../core/personal-library/model.js';
import type { PersonalGameArtworkCandidate } from '../../core/artwork-cache/personal-game-priority-fill.js';

export interface UseArtworkCachePriorityFillTriggerInput {
  runningGame: GameCardData | null;
  favoriteGames: GameCardData[];
  myGames: PersonalLibraryGame[];
}

function confidenceFromCanonical(
  confidence: PersonalLibraryGame['canonicalConfidence'] | undefined,
): 'trusted' | 'weak' {
  // Mirrors cover-url.ts's own trusted/weak split for provider-derived
  // artwork: only an exact or high-confidence identity match may trigger an
  // automatic fetch. 'POSSIBLE'/'UNKNOWN' (or missing) stays 'weak'.
  return confidence === 'EXACT' || confidence === 'HIGH' ? 'trusted' : 'weak';
}

function candidateSignature(candidates: PersonalGameArtworkCandidate[]): string {
  return candidates
    .map(
      (c) =>
        `${c.catalogGameId}:${c.running ? 1 : 0}${c.installed ? 1 : 0}${c.confirmedOwned ? 1 : 0}${c.favorite ? 1 : 0}${c.recentlyDetected ? 1 : 0}${c.canonicalConfidence}`,
    )
    .sort()
    .join('|');
}

/**
 * Builds one candidate per real personal-library game id, unioning
 * runningGame + favoriteGames + myGames — never fabricated, only ever
 * derived from signals usePersonalLibraryGames.ts already resolved via real
 * IPC. A game appearing under multiple signals (e.g. running AND favorited)
 * gets ONE merged candidate; personal-game-priority-fill.ts itself picks the
 * single highest-ranked tier from the merged flags.
 */
function buildCandidates({
  runningGame,
  favoriteGames,
  myGames,
}: UseArtworkCachePriorityFillTriggerInput): PersonalGameArtworkCandidate[] {
  const byId = new Map<string, PersonalGameArtworkCandidate>();

  const upsert = (
    catalogGameId: string,
    patch: Partial<Omit<PersonalGameArtworkCandidate, 'catalogGameId' | 'canonicalConfidence'>>,
    canonicalConfidence: 'trusted' | 'weak',
  ): void => {
    const existing = byId.get(catalogGameId) ?? {
      catalogGameId,
      running: false,
      installed: false,
      confirmedOwned: false,
      favorite: false,
      recentlyDetected: false,
      canonicalConfidence,
    };
    byId.set(catalogGameId, {
      ...existing,
      ...patch,
      // A game confirmed 'trusted' by any one real signal stays trusted
      // even if merged with a 'weak' signal for the same id — never
      // downgrade real evidence.
      canonicalConfidence: existing.canonicalConfidence === 'trusted' || canonicalConfidence === 'trusted' ? 'trusted' : 'weak',
    });
  };

  if (runningGame) {
    // A real process-detect match IS an exact identity signal (the running
    // process was matched to this exact catalogGameId) — trusted by
    // construction, same rationale cover-url.ts documents for a catalog
    // entry resolved directly by its own id.
    upsert(runningGame.gameId, { running: true }, 'trusted');
  }

  for (const game of favoriteGames) {
    // favoriteGames entries come from a direct trainerCatalogGet(catalogGameId)
    // lookup (see usePersonalLibraryGames.ts's toGameCardData), never a
    // title-only match — trusted by construction.
    upsert(game.gameId, { favorite: true }, 'trusted');
  }

  for (const game of myGames) {
    upsert(
      game.gameId,
      {
        installed: game.installed,
        confirmedOwned: game.owned === true,
        favorite: game.favorite,
        recentlyDetected: game.recentlyDetected,
      },
      confidenceFromCanonical(game.canonicalConfidence),
    );
  }

  return [...byId.values()];
}

export function useArtworkCachePriorityFillTrigger(input: UseArtworkCachePriorityFillTriggerInput): void {
  const { runningGame, favoriteGames, myGames } = input;
  const firedForSignature = useRef<string | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.artworkCachePriorityFill) return; // browser/dev mode without Electron IPC — no-op, never fabricate

    const candidates = buildCandidates({ runningGame, favoriteGames, myGames });
    if (candidates.length === 0) return;

    const signature = candidateSignature(candidates);
    // Only fire again when the underlying signal set actually changed
    // (a new game installed/favorited/running/etc.) — never on every
    // render or every identical re-mount, so this can never become a
    // request-storm source itself.
    if (firedForSignature.current === signature) return;
    firedForSignature.current = signature;

    void api.artworkCachePriorityFill({ candidates }).catch(() => {
      // Best-effort background enhancement — never surfaced as a user-facing error.
    });
  }, [runningGame, favoriteGames, myGames]);
}

export default useArtworkCachePriorityFillTrigger;
