import React, { useEffect, useState } from 'react';
import styles from './GameDetailPage.module.css';
import type { PersonalLibraryGame } from '../../core/personal-library/model.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import type { DiscoveryCatalogEntry } from '../../core/discovery-catalog/types.js';
import { DetailBanner } from '../components/game-detail/DetailBanner.js';
import { TrainerSection } from '../components/game-detail/TrainerSection.js';
import { GameInfoSection } from '../components/game-detail/GameInfoSection.js';
import { TrainerSourcesSection } from '../components/game-detail/TrainerSourcesSection.js';
import { buildNonPersonalGameDetailView } from './game-detail-discovery-fallback.js';

/**
 * GameDetailPage — Visual Library 2.0, Step 7 (final step).
 *
 * AUDIT FINDINGS this component is built strictly against (owner's explicit
 * rule: "only expose actions already supported safely; do not invent
 * unavailable data"):
 *
 *   - "Open Game Folder": REAL. `install-discovery-open-path` IPC exists
 *     (electron/trainer-deck-ipc.ts), is exposed as
 *     `window.electronAPI.installDiscoveryOpenPath({ catalogGameId,
 *     targetPath? })` (electron/preload.ts), and is already called for real
 *     by TrainerDeckPage.tsx's `handleOpenInstallFolder`. It resolves the
 *     install path from main-process-owned installation records and opens it
 *     via `shell.openPath` — this component reuses that exact call, keyed
 *     off the game's real `gameId` (== catalogGameId), and only when
 *     `game.installed` is true (the handler 404s with `not_installed`
 *     otherwise, so this mirrors its own precondition).
 *
 *   - "Play"/"Launch Game": REAL IPC exists (`launch-installation` /
 *     `window.electronAPI.launchInstallation`, electron/canonical-games-ipc.ts)
 *     but it starts the game's .exe via `shell.openPath(executablePath)` —
 *     a live-game-launch primitive. The owner's HARD RULE for this step
 *     forbids triggering any launch/attach flow from here, so this button is
 *     deliberately NOT implemented. This is a confirmed gap, not an oversight.
 *
 *   - "Open Trainer": partially real. There is no dedicated "open trainer for
 *     this game" IPC; what's real is the EXISTING 'live-memory' View
 *     (src/app/nav-views.ts) and App.tsx's established
 *     `openLiveTrainerFromDeck(catalogGameId)` pattern
 *     (`setLibraryLaunchGameId` + `setCurrentView('live-memory')`), which
 *     TrainerDeckPage already uses to reach the live-memory trainer page.
 *     This component exposes that exact navigation via the caller-supplied
 *     `onOpenTrainer` prop — pure view navigation, never a process-attach or
 *     Lua/Auto-Assembler execution call. It is rendered only when the game
 *     has `trainerAvailability !== 'NONE'`.
 *
 *   - Save management (backup/restore): audited and OMITTED. Real
 *     `getBackups(gameId)` / `restoreBackup(backupId)` IPC exists
 *     (electron/preload.ts, backing src/core/saves + the Backups page), but
 *     it is keyed to the OLDER Game Library `gameId` space
 *     (src/core/games/index.ts's `generateId()`-based ids) — a completely
 *     different id space from the canonical/catalog `gameId` this page and
 *     `PersonalLibraryGame` use, with no mapping between the two found
 *     anywhere in the codebase. Passing this page's `gameId` into
 *     `getBackups` would silently query the wrong id space (or a
 *     non-existent row) and render a misleading "no backups" empty state
 *     rather than an honest one, so the entire section is omitted rather
 *     than fabricated. See PR notes for this gap.
 *
 * Data: this page first re-derives the game from the SAME `myGames` the
 * caller already loaded via usePersonalLibraryGames() (no second fetch of
 * the personal-library projection), plus one `trainerCatalogGet` call for
 * the full catalog entry (artwork, sources, executables) when the id is
 * catalog-backed — mirroring the exact pattern TrainerLibraryPage.tsx and
 * usePersonalLibraryGames.ts already use for the same lookup.
 *
 * Discovery Master Pass, Stage 2 identity audit: `myGames` only contains
 * install/owned/favorite evidence — a game reached by BROWSING Discovery
 * (not yet favorited) has none of that, so the original `myGames.find(...)`
 * lookup alone rendered "no longer in your library" for a perfectly valid,
 * just-not-personal-yet game. See game-detail-discovery-fallback.ts: when
 * the `myGames` lookup misses, this page resolves the id against the
 * Discovery catalog (and trainer catalog) directly and builds an honest,
 * non-fabricated view model instead.
 */

export interface GameDetailPageProps {
  gameId: string;
  /** Real personal-library games from App.tsx's usePersonalLibraryGames().myGames. */
  myGames: PersonalLibraryGame[];
  /** Navigate back to wherever the sidebar/card selection originated. */
  onBack: () => void;
  /**
   * Navigate to the EXISTING 'live-memory' view for this catalogGameId (e.g.
   * App.tsx's `openLiveTrainerFromDeck`). Must be pure navigation — this
   * component never calls a memory-attach or launch API itself.
   */
  onOpenTrainer: (catalogGameId: string) => void;
}

export function GameDetailPage({ gameId, myGames, onBack, onOpenTrainer }: GameDetailPageProps) {
  const personalGame = myGames.find((g) => g.gameId === gameId) ?? null;
  const [entry, setEntry] = useState<TrainerCatalogEntry | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  // Discovery Master Pass, Stage 2 — see game-detail-discovery-fallback.ts's
  // header for why this exists: `personalGame` above is null for any game
  // the user has not yet favorited/installed/owned, which is the NORMAL
  // state for a game reached by browsing Discovery.
  const [fallbackGame, setFallbackGame] = useState<PersonalLibraryGame | null>(null);
  const [resolvingFallback, setResolvingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    void (async () => {
      const api = (window as any).electronAPI;
      if (!api?.trainerCatalogGet) return;
      try {
        const result = await api.trainerCatalogGet({ catalogGameId: gameId });
        if (!cancelled && result?.success && result.entry) {
          setEntry(result.entry as TrainerCatalogEntry);
        }
      } catch {
        // No catalog entry resolved — sections below fall back to their own
        // honest "no data" rendering rather than fabricating one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (personalGame) {
      // Already resolved via the personal-library projection — no fallback needed.
      setFallbackGame(null);
      setResolvingFallback(false);
      return;
    }
    let cancelled = false;
    setResolvingFallback(true);
    void (async () => {
      const api = (window as any).electronAPI;
      const [discoveryResult, trainerResult, favoriteResult] = await Promise.allSettled([
        api?.discoveryCatalogGet?.({ solithGameId: gameId }),
        api?.trainerCatalogGet?.({ catalogGameId: gameId }),
        api?.isFavoriteGame?.({ canonicalGameId: gameId }),
      ]);
      if (cancelled) return;
      const discoveryEntry: DiscoveryCatalogEntry | null =
        discoveryResult.status === 'fulfilled' && discoveryResult.value?.success && discoveryResult.value.entry
          ? (discoveryResult.value.entry as DiscoveryCatalogEntry)
          : null;
      const trainerEntry: TrainerCatalogEntry | null =
        trainerResult.status === 'fulfilled' && trainerResult.value?.success && trainerResult.value.entry
          ? (trainerResult.value.entry as TrainerCatalogEntry)
          : null;
      const isFavorite =
        favoriteResult.status === 'fulfilled' && favoriteResult.value?.success
          ? Boolean(favoriteResult.value.isFavorite)
          : false;
      setFallbackGame(buildNonPersonalGameDetailView(gameId, discoveryEntry, trainerEntry, isFavorite));
      setResolvingFallback(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, personalGame]);

  const game = personalGame ?? fallbackGame;

  const handleOpenFolder = async () => {
    const api = (window as any).electronAPI;
    if (!api?.installDiscoveryOpenPath) {
      setFolderError('Open Game Folder is unavailable in this build.');
      return;
    }
    setFolderBusy(true);
    setFolderError(null);
    try {
      const result = await api.installDiscoveryOpenPath({ catalogGameId: gameId });
      if (!result?.success) {
        setFolderError(result?.error ?? 'Could not open the game folder.');
      }
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : 'Could not open the game folder.');
    } finally {
      setFolderBusy(false);
    }
  };

  if (!game) {
    return (
      <div className={styles.page} data-testid="game-detail-page">
        <button type="button" className={styles.backButton} onClick={onBack} data-testid="game-detail-back">
          ← Back
        </button>
        <div className={styles.notFound} data-testid="game-detail-not-found">
          {resolvingFallback ? 'Loading…' : "This game isn't in your library or the Discovery catalog."}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="game-detail-page">
      <button type="button" className={styles.backButton} onClick={onBack} data-testid="game-detail-back">
        ← Back
      </button>

      <DetailBanner
        game={game}
        entry={entry}
        onOpenFolder={() => void handleOpenFolder()}
        folderBusy={folderBusy}
        folderError={folderError}
        onOpenTrainer={() => onOpenTrainer(game.gameId)}
      />

      <div className={styles.sections}>
        <TrainerSection game={game} entry={entry} />
        <GameInfoSection game={game} />
        <TrainerSourcesSection entry={entry} />
      </div>
    </div>
  );
}

export default GameDetailPage;
