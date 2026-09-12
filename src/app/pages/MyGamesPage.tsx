import React, { useEffect, useMemo, useState } from 'react';
import styles from './MyGamesPage.module.css';
import { GameCard, type GameCardData } from '../components/GameCard.js';
import { ViewModeToggle, type LibraryViewMode } from '../components/ViewModeToggle.js';
import type { PersonalLibraryGame } from '../../core/personal-library/model.js';
import {
  LIBRARY_SECTION_LABELS,
  organizeLibrary,
  type LibraryGameEvidence,
  type LibrarySectionKey,
} from '../../core/trainer-catalog/library-sections.js';

/**
 * My Games page — Visual Library 2.0, Step 5.
 *
 * Personal-library-only view: shows ONLY games this session has real
 * installed/owned evidence for, never the full unowned catalog. Reuses
 * src/core/trainer-catalog/library-sections.ts's FROZEN
 * organizeLibrary/assignLibrarySection hierarchy verbatim (per this step's
 * explicit instruction not to modify that module) rather than inventing a
 * second sectioning scheme.
 *
 * `organizeLibrary` itself has no concept of "personal library only" — it
 * also buckets pure-catalog games (favorited-but-never-installed-or-owned,
 * or any other catalog spillover) into its 'other'/'missing_unsupported'
 * sections. This page stays personal-only not by filtering the INPUT
 * (organizeLibrary is used verbatim on every game `usePersonalLibraryGames`
 * handed it), but by only ever RENDERING the three sections that are
 * actually personal-library evidence: 'installed', 'owned_supported',
 * 'owned_unsupported'. A game that lands in 'other' or
 * 'missing_unsupported' — i.e. one with no install/ownership evidence at
 * all, only a favorite mark or catalog presence — is real data that
 * organizeLibrary correctly classified as NOT personal-library evidence, so
 * it is intentionally excluded from this page's render, matching this
 * page's own name.
 */

const PERSONAL_SECTION_ORDER: readonly LibrarySectionKey[] = ['installed', 'owned_supported', 'owned_unsupported'];

export interface MyGamesPageProps {
  /** Real personal-library games from usePersonalLibraryGames().myGames. */
  myGames: PersonalLibraryGame[];
  loading?: boolean;
  onSelectGame: (gameId: string) => void;
}

function toLibraryGameEvidence(game: PersonalLibraryGame): LibraryGameEvidence {
  return {
    canonicalGameId: game.gameId,
    displayName: game.title,
    isInstalled: game.installed,
    ownedConfirmed: game.owned === true,
    // Only meaningful for organizeLibrary's 'other' vs excluded fallback,
    // neither of which this page renders — see file header. A catalog entry
    // was resolved whenever any trainer evidence exists.
    isKnownToCatalog: game.trainerAvailability !== 'NONE',
    hasTrainerSupport: game.trainerAvailability !== 'NONE',
    // No linked-library signal is gathered by the fast path this page's data
    // comes from (see personal-library-my-games.ts) — honestly false rather
    // than fabricated. Does not affect which of the three rendered sections
    // an installed/owned game lands in.
    isFromLinkedLibrary: false,
    isRunning: game.running,
  };
}

function toGameCardData(game: PersonalLibraryGame): GameCardData {
  return {
    gameId: game.gameId,
    title: game.title,
    running: game.running,
    installed: game.installed,
    owned: game.owned,
    favorite: game.favorite,
    launchers: game.launchers,
    trainerAvailability: game.trainerAvailability,
    trainerAccuracy: game.trainerAccuracy,
    artworkUrl: game.artworkUrl,
  };
}

export function MyGamesPage({ myGames, loading = false, onSelectGame }: MyGamesPageProps) {
  // Read the persisted grid/list preference via IPC (window.electronAPI.getSettings()),
  // not by importing src/core/settings directly — that module is main-process-only
  // (it transitively pulls in better-sqlite3 via src/core/database) and crashes the
  // renderer bundle if imported here. ViewModeToggle owns writes to this setting.
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getSettings().then((settings: { libraryViewMode?: unknown }) => {
      if (!cancelled && (settings?.libraryViewMode === 'grid' || settings?.libraryViewMode === 'list')) {
        setViewMode(settings.libraryViewMode);
      }
    }).catch(() => {
      // Fall back to the 'grid' default already set above.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const gamesById = useMemo(() => new Map(myGames.map((game) => [game.gameId, game])), [myGames]);

  // Discovery Master Pass section 21 ("FAVORITED GAMES MUST APPEAR ABOVE ALL
  // OTHER GAMES"): organizeLibrary (frozen — see file header) buckets any
  // game with no install/ownership evidence into 'other', which this page
  // deliberately never renders. A favorited-but-not-installed-or-owned game
  // (the normal case for a game favorited from Discovery) would otherwise
  // be silently invisible here despite being favorited. This section is
  // sourced directly from `myGames`'s real `favorite` flag, bypassing
  // organizeLibrary entirely, and rendered first.
  const favoriteGames = useMemo(() => myGames.filter((game) => game.favorite), [myGames]);
  const favoriteGameIds = useMemo(() => new Set(favoriteGames.map((game) => game.gameId)), [favoriteGames]);

  const organized = useMemo(
    () => organizeLibrary(myGames.map(toLibraryGameEvidence)),
    [myGames],
  );

  const personalSections = PERSONAL_SECTION_ORDER.map((sectionKey) => ({
    sectionKey,
    label: LIBRARY_SECTION_LABELS[sectionKey],
    // A favorited game already shown in the Favorites section above is
    // excluded here so it doesn't render twice.
    entries: organized.sections[sectionKey].filter((entry) => !favoriteGameIds.has(entry.canonicalGameId)),
  })).filter((section) => section.entries.length > 0);

  const isEmpty = personalSections.length === 0 && favoriteGames.length === 0;

  return (
    <div className={styles.page} data-testid="my-games-page">
      <div className={styles.header}>
        <h1 className={styles.title}>My Games</h1>
        <ViewModeToggle onChange={setViewMode} />
      </div>

      {isEmpty ? (
        <div className={styles.emptyState} data-testid="my-games-empty">
          {loading ? (
            <p>Loading your library…</p>
          ) : (
            <p>No installed or owned games yet. Games you install or mark as owned will show up here.</p>
          )}
        </div>
      ) : (
        <>
          {favoriteGames.length > 0 ? (
            <section className={styles.section} data-testid="my-games-section" data-section-key="favorites">
              <h2 className={styles.sectionTitle}>Favorites</h2>
              <div
                className={viewMode === 'grid' ? styles.gridLayout : styles.listLayout}
                data-testid="my-games-section-items"
              >
                {favoriteGames.map((game) => (
                  <GameCard key={game.gameId} game={toGameCardData(game)} mode={viewMode} onSelect={onSelectGame} />
                ))}
              </div>
            </section>
          ) : null}
          {personalSections.map((section) => (
          <section key={section.sectionKey} className={styles.section} data-testid="my-games-section">
            <h2 className={styles.sectionTitle}>{section.label}</h2>
            <div
              className={viewMode === 'grid' ? styles.gridLayout : styles.listLayout}
              data-testid="my-games-section-items"
            >
              {section.entries.map((entry) => {
                const game = gamesById.get(entry.canonicalGameId);
                if (!game) return null;
                return (
                  <GameCard
                    key={entry.canonicalGameId}
                    game={toGameCardData(game)}
                    mode={viewMode}
                    onSelect={onSelectGame}
                  />
                );
              })}
            </div>
          </section>
          ))}
        </>
      )}
    </div>
  );
}

export default MyGamesPage;
