/**
 * Visual Library 2.0, Step 4 — minimal REAL data source for the sidebar's
 * Running / Favorites / My Games mini-sections.
 *
 * What this hook wires for real, using IPC that already exists and is
 * already exposed on window.electronAPI:
 *   - Favorites: `listFavorites()` (electron/personal-library-ipc.ts) for the
 *     real favorited canonical game ids, then `trainerCatalogGet()`
 *     (electron/trainer-catalog-ipc.ts) per id for real display data
 *     (title, verification/mod-pack presence). Bounded to the first
 *     FAVORITES_FETCH_LIMIT ids so the sidebar never fans out an unbounded
 *     number of IPC calls.
 *   - Running: on mount, reads the real `get-current-detected-process`
 *     snapshot (catalog-process-watch.ts's existing in-memory detection, so
 *     a game already running when SOLITH starts shows up immediately), then
 *     subscribes to the real `onCatalogProcessDetected` event (the same
 *     signal App.tsx's process-detect toast uses) for live updates —
 *     including clearing the running game when a later event reports none.
 *     Both paths share one reducer (`deriveRunningGameState` in
 *     `personal-library-running-snapshot.ts`) so the mapping logic is never
 *     duplicated. This is real, not fabricated.
 *   - My Games: the SAME three narrow, indexed, small-result IPC calls
 *     TrainerLibraryPage.tsx's own "My-Games fast path" effect already uses
 *     (`installDiscoveryList()`, `trainerCatalogListOwned()`, plus
 *     `listFavorites()` for the favorite flag), unioned into one
 *     catalogGameId set, then resolved to display data via
 *     `trainerCatalogGet()` per id — never the ~6,800-row full catalog
 *     fetch (`fetchAllCandidatePages`), which stays exclusive to
 *     TrainerLibraryPage.tsx. Step 5 (Home/My-Games pages) additionally
 *     fetches real validation-receipt evidence for this SAME bounded id set
 *     via `getValidationReceiptsForGames()` — the identical IPC + evidence
 *     bridge (`deriveReceiptEvidence`) TrainerLibraryPage.tsx's own accuracy
 *     badge uses — so `trainerAccuracy` here can reach real
 *     `LOCALLY_VERIFIED`/`NEEDS_REVERIFY` states instead of always flooring
 *     at `VERSION_UNKNOWN`. The actual composition into a
 *     `PersonalLibraryGame` is a pure function in
 *     `personal-library-my-games.ts` (see that file's header for exactly
 *     which fields are still reduced-fidelity) — kept out of this file so
 *     the composition logic is unit-testable without React or a DOM.
 */
import { useEffect, useState } from 'react';
import type { GameCardData } from '../components/game-card-status.js';
import type { PersonalLibraryGame, TrainerAvailability } from '../../core/personal-library/model.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import type { DiscoveryCatalogEntry } from '../../core/discovery-catalog/types.js';
import type { ValidationReceipt } from '../../core/validation-receipts/store.js';
import { buildMyGamesFastPath, type FastPathInstallRecord } from './personal-library-my-games.js';
import {
  deriveRunningGameState,
  EMPTY_RUNNING_STATE,
  type RunningGameState,
  type RunningProcessDetection,
} from './personal-library-running-snapshot.js';

const FAVORITES_FETCH_LIMIT = 5;
/** Bounds trainerCatalogGet() fan-out for the My-Games fast-path id union — same rationale as FAVORITES_FETCH_LIMIT. */
const MY_GAMES_FETCH_LIMIT = 40;

function trainerAvailabilityFromCatalogEntry(entry: TrainerCatalogEntry): TrainerAvailability {
  if (entry.verificationStatus === 'verified') return 'VERIFIED';
  if (entry.hasModPack || entry.verificationStatus === 'community') return 'COMMUNITY';
  return 'NONE';
}

function toGameCardData(entry: TrainerCatalogEntry, overrides: Partial<GameCardData> = {}): GameCardData {
  const trainerAvailability = trainerAvailabilityFromCatalogEntry(entry);
  return {
    gameId: entry.catalogGameId,
    title: entry.displayName,
    running: false,
    installed: false,
    owned: 'unknown',
    favorite: true,
    launchers: [],
    trainerAvailability,
    // No validation-receipt evidence is available from a catalog-entry-only
    // lookup, so this never claims LOCALLY_VERIFIED/EXACT_VERSION_MATCH —
    // only the honest floor for "a trainer exists but nothing here proves
    // more than that" vs. "no trainer at all".
    trainerAccuracy: trainerAvailability === 'NONE' ? 'NONE' : 'VERSION_UNKNOWN',
    ...overrides,
  };
}

/**
 * Discovery Master Pass, Stage 1 fallback — same purpose as
 * personal-library-my-games.ts's discovery fallback: a favorited game with
 * no legacy trainer-catalog row (the normal case for a Discovery-only
 * favorite) still needs a real card instead of showing its raw internal id.
 * trainerAvailability is capped at 'COMMUNITY' for the same honesty reason
 * documented there — this table's boolean signal cannot evidence SOLITH
 * curation.
 */
function toGameCardDataFromDiscovery(entry: DiscoveryCatalogEntry, overrides: Partial<GameCardData> = {}): GameCardData {
  const trainerAvailability: GameCardData['trainerAvailability'] = entry.trainerAvailable ? 'COMMUNITY' : 'NONE';
  return {
    gameId: entry.solithGameId,
    title: entry.title,
    running: false,
    installed: false,
    owned: 'unknown',
    favorite: true,
    launchers: [],
    trainerAvailability,
    trainerAccuracy: trainerAvailability === 'NONE' ? 'NONE' : 'VERSION_UNKNOWN',
    ...overrides,
  };
}

export interface UsePersonalLibraryGamesResult {
  /** Currently-running game, if a real process-detect event has fired this session. Never fabricated. */
  runningGame: GameCardData | null;
  /** Real favorited games (bounded to FAVORITES_FETCH_LIMIT), most-recently-fetched order. */
  favoriteGames: GameCardData[];
  /**
   * Real installed/owned/favorited games composed from the fast-path IPC
   * sources — see the file-level comment and personal-library-my-games.ts
   * for exactly which fields are reduced-fidelity. Stays [] only when none
   * of install-discovery, owned-confirmed, or favorites has any evidence.
   */
  myGames: PersonalLibraryGame[];
  loading: boolean;
}

export function usePersonalLibraryGames(): UsePersonalLibraryGamesResult {
  const [favoriteGames, setFavoriteGames] = useState<GameCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const api = (window as any).electronAPI;
      if (!api?.listFavorites || !api?.trainerCatalogGet) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const favResult = await api.listFavorites();
        const ids: string[] = Array.isArray(favResult?.favoriteIds) ? favResult.favoriteIds : [];
        const boundedIds = ids.slice(0, FAVORITES_FETCH_LIMIT);
        const cards = await Promise.all(
          boundedIds.map(async (catalogGameId: string): Promise<GameCardData | null> => {
            try {
              const result = await api.trainerCatalogGet({ catalogGameId });
              if (result?.success && result.entry) return toGameCardData(result.entry as TrainerCatalogEntry);
            } catch {
              // Fall through to the Discovery-catalog fallback below.
            }
            // No legacy trainer-catalog row — the normal case for a game
            // favorited from Discovery before it ever had a trainer.
            try {
              const discoveryResult = await api.discoveryCatalogGet?.({ solithGameId: catalogGameId });
              if (discoveryResult?.success && discoveryResult.entry) {
                return toGameCardDataFromDiscovery(discoveryResult.entry as DiscoveryCatalogEntry);
              }
            } catch {
              // Neither catalog resolved this id — leave it out rather than fabricate.
            }
            return null;
          }),
        );
        if (cancelled) return;
        setFavoriteGames(cards.filter((card): card is GameCardData => card !== null));
      } catch {
        // No favorites available (browser mode, or IPC failure) — leave empty rather than fabricate.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const [runningState, setRunningState] = useState<RunningGameState>(EMPTY_RUNNING_STATE);
  const runningCatalogGameId = runningState.runningCatalogGameId;

  // Mount-time snapshot — reads catalog-process-watch.ts's existing
  // in-memory detection via the read-only get-current-detected-process IPC
  // so a game already running when SOLITH starts shows up in the sidebar
  // immediately, instead of sitting empty until the next background poll
  // fires onCatalogProcessDetected below. Runs BEFORE that event
  // subscription takes over for live updates, and shares the exact same
  // deriveRunningGameState reducer so the two paths never diverge.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = (window as any).electronAPI;
      if (!api?.getCurrentDetectedProcess) return;
      try {
        const result = await api.getCurrentDetectedProcess();
        if (cancelled || !result?.success) return;
        setRunningState((prev) => deriveRunningGameState(result.detection ?? null, prev));
      } catch {
        // No snapshot available (browser mode, or IPC failure) — leave empty rather than fabricate.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const api = (window as any).electronAPI;
    const unsubscribe = api?.onCatalogProcessDetected?.((payload: RunningProcessDetection | null) => {
      setRunningState((prev) => deriveRunningGameState(payload, prev));
    });
    return () => unsubscribe?.();
  }, []);

  const [myGames, setMyGames] = useState<PersonalLibraryGame[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const api = (window as any).electronAPI;
      if (!api?.installDiscoveryList || !api?.trainerCatalogListOwned || !api?.listFavorites || !api?.trainerCatalogGet) {
        return;
      }
      try {
        const [installResult, ownedResult, favoritesResult] = await Promise.all([
          api.installDiscoveryList(),
          api.trainerCatalogListOwned(),
          api.listFavorites(),
        ]);
        if (cancelled) return;

        const installRecords: FastPathInstallRecord[] =
          installResult?.success && Array.isArray(installResult.games)
            ? installResult.games.map((game: any) => ({
                catalogGameId: game.catalogGameId,
                catalogDisplayName: game.catalogDisplayName,
                identityStatus: game.identityStatus,
                platform: game.platform,
                installPath: game.installPath,
                executablePath: game.executablePath,
                detectedAt: game.detectedAt,
                lastSeenAt: game.lastSeenAt,
              }))
            : [];
        const ownedCatalogGameIds: string[] =
          ownedResult?.success && Array.isArray(ownedResult.ownedCatalogGameIds)
            ? ownedResult.ownedCatalogGameIds
            : [];
        const favoriteCatalogGameIds: string[] =
          favoritesResult?.success && Array.isArray(favoritesResult.favoriteIds) ? favoritesResult.favoriteIds : [];

        const fastIds = new Set<string>([
          ...installRecords.map((r) => r.catalogGameId).filter((id): id is string => Boolean(id)),
          ...ownedCatalogGameIds,
          ...favoriteCatalogGameIds,
        ]);
        const boundedIds = [...fastIds].slice(0, MY_GAMES_FETCH_LIMIT);

        const catalogEntriesById: Record<string, TrainerCatalogEntry> = {};
        await Promise.all(
          boundedIds.map(async (catalogGameId) => {
            try {
              const result = await api.trainerCatalogGet({ catalogGameId });
              if (result?.success && result.entry) {
                catalogEntriesById[catalogGameId] = result.entry as TrainerCatalogEntry;
              }
            } catch {
              // No catalog entry resolved for this id — the composer below
              // honestly falls back to trainerAvailability 'NONE' rather
              // than fabricating one.
            }
          }),
        );
        if (cancelled) return;

        // Discovery Master Pass, Stage 1 fallback — for ids the legacy
        // trainer-catalog lookup above didn't resolve (the normal case for a
        // Discovery-only favorite/install), try the Discovery catalog so the
        // composer isn't left with a raw internal id as the display title.
        const unresolvedIds = boundedIds.filter((id) => !catalogEntriesById[id]);
        const discoveryEntriesById: Record<string, DiscoveryCatalogEntry> = {};
        if (api.discoveryCatalogGet && unresolvedIds.length > 0) {
          await Promise.all(
            unresolvedIds.map(async (solithGameId) => {
              try {
                const result = await api.discoveryCatalogGet({ solithGameId });
                if (result?.success && result.entry) {
                  discoveryEntriesById[solithGameId] = result.entry as DiscoveryCatalogEntry;
                }
              } catch {
                // Neither catalog resolved this id — the composer's honest floor applies.
              }
            }),
          );
        }
        if (cancelled) return;

        // Real validation-receipt evidence for this SAME bounded id set —
        // closes the "Locally Verified never populates on Home/My Games"
        // gap by reusing the exact IPC + evidence bridge
        // TrainerLibraryPage.tsx's accuracy badge already uses. Optional:
        // an older host without this IPC, or a failed call, just means
        // trainerAccuracy stays at personal-library-my-games.ts's honest
        // VERSION_UNKNOWN floor for this session — never a hard failure and
        // never a fabricated receipt.
        let receiptsByGameId: Record<string, ValidationReceipt | null> | undefined;
        if (api.getValidationReceiptsForGames && boundedIds.length > 0) {
          try {
            const receiptsResult = await api.getValidationReceiptsForGames(boundedIds);
            if (receiptsResult?.success && receiptsResult.receipts) {
              receiptsByGameId = receiptsResult.receipts as Record<string, ValidationReceipt | null>;
            }
          } catch {
            // Leave receiptsByGameId undefined — honest fallback, not fabricated.
          }
        }
        if (cancelled) return;

        setMyGames(
          buildMyGamesFastPath({
            installRecords,
            ownedCatalogGameIds,
            favoriteCatalogGameIds,
            catalogEntriesById,
            discoveryEntriesById,
            runningCatalogGameId,
            nowIso: new Date().toISOString(),
            receiptsByGameId,
          }),
        );
      } catch {
        // No fast-path data available (browser mode, or an IPC failure) — leave empty rather than fabricate.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runningCatalogGameId]);

  return { runningGame: runningState.runningGame, favoriteGames, myGames, loading };
}
