import React from 'react';
import styles from './HomePage.module.css';
import { HomeShelf } from '../components/HomeShelf.js';
import { primaryStatusLabel, trainerStatusLabel } from '../components/game-card-status.js';
import type { PersonalLibraryGame } from '../../core/personal-library/model.js';
import {
  selectLocallyVerifiedShelf,
  selectMyGamesShelf,
  selectNeedsReverifyShelf,
  selectRecentlyDetectedShelf,
  selectRunningOrTopPriorityGame,
  selectTrainersReadyShelf,
} from '../../core/personal-library/home-sections.js';

/**
 * Home page — Visual Library 2.0, Step 5.
 *
 * Every section here (hero + every shelf) is a thin wrapper around the pure
 * selectors in src/core/personal-library/home-sections.ts, which already
 * enforce the owner's hard rule: a section renders ONLY when it has real,
 * meaningful data behind it. This component adds no additional
 * inference/fabrication on top of those selectors — it only decides layout
 * and wires `onSelectGame`/`onBrowseAll`.
 *
 * Data source: `myGames` comes from usePersonalLibraryGames() (real fast-path
 * IPC — see that hook's header for exactly which fields are reduced-fidelity
 * vs. real). This component never queries IPC itself.
 */

/** Per-shelf cap — keeps a shelf a reasonable horizontal-scroll length rather than dumping the entire personal library into one row. */
const SHELF_LIMIT = 12;

export interface HomePageProps {
  /** Real personal-library games from usePersonalLibraryGames().myGames. */
  myGames: PersonalLibraryGame[];
  /** True while the underlying fast-path IPC calls are still in flight. */
  loading?: boolean;
  /** Navigate to 'game-detail' for the given gameId (App.tsx's handleLibraryGameSelect). */
  onSelectGame: (gameId: string) => void;
  /** Navigate to the existing 'trainer-library' view. */
  onBrowseAll: () => void;
}

export function HomePage({ myGames, loading = false, onSelectGame, onBrowseAll }: HomePageProps) {
  const heroGame = selectRunningOrTopPriorityGame(myGames);

  const myGamesShelf = selectMyGamesShelf(myGames, SHELF_LIMIT);
  const trainersReadyShelf = selectTrainersReadyShelf(myGames, SHELF_LIMIT);
  const locallyVerifiedShelf = selectLocallyVerifiedShelf(myGames, SHELF_LIMIT);
  const recentlyDetectedShelf = selectRecentlyDetectedShelf(myGames, SHELF_LIMIT);
  const needsReverifyShelf = selectNeedsReverifyShelf(myGames, SHELF_LIMIT);

  const hasAnyShelfContent =
    myGamesShelf.length > 0 ||
    trainersReadyShelf.length > 0 ||
    locallyVerifiedShelf.length > 0 ||
    recentlyDetectedShelf.length > 0 ||
    needsReverifyShelf.length > 0;

  return (
    <div className={styles.page} data-testid="home-page">
      {heroGame ? (
        <section className={styles.hero} data-testid="home-hero" aria-label="Continue">
          <p className={styles.heroEyebrow}>{heroGame.running ? 'Currently Running' : 'Pick Up Where You Left Off'}</p>
          <h1 className={styles.heroTitle}>{heroGame.title}</h1>
          <p className={styles.heroMeta}>
            {primaryStatusLabel(heroGame) ?? 'In Your Library'} · {trainerStatusLabel(heroGame)}
          </p>
          <button
            type="button"
            className={styles.heroButton}
            onClick={() => onSelectGame(heroGame.gameId)}
            data-testid="home-hero-select"
          >
            {heroGame.running ? 'Open' : 'View Details'}
          </button>
        </section>
      ) : loading ? (
        <section className={styles.heroEmpty} data-testid="home-hero-empty">
          <p>Loading your library…</p>
        </section>
      ) : (
        // Owner's explicit rule: never fabricate a featured game. No running
        // game and no priority-ranked personal-library game at all means the
        // hero renders nothing rather than a placeholder card.
        <section className={styles.heroEmpty} data-testid="home-hero-empty">
          <p>No games in your library yet. Browse the catalog to get started.</p>
        </section>
      )}

      {hasAnyShelfContent && (
        <div className={styles.shelves}>
          <HomeShelf title="My Games" games={myGamesShelf} onSelect={onSelectGame} />
          <HomeShelf title="Trainers Ready" games={trainersReadyShelf} onSelect={onSelectGame} />
          <HomeShelf title="Locally Verified" games={locallyVerifiedShelf} onSelect={onSelectGame} />
          <HomeShelf title="Recently Detected" games={recentlyDetectedShelf} onSelect={onSelectGame} />
          <HomeShelf title="Needs Reverify" games={needsReverifyShelf} onSelect={onSelectGame} />
        </div>
      )}

      <div className={styles.browseAllWrap}>
        <button type="button" className={styles.browseAllButton} onClick={onBrowseAll} data-testid="home-browse-all">
          Browse All Supported Games
        </button>
      </div>
    </div>
  );
}

export default HomePage;
