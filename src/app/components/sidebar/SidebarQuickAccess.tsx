/**
 * Visual Library 2.0, Step 4 — the "Running" / "Favorites" / "My Games"
 * mini-sections split out of AppSidebar.tsx to keep both files under the
 * repo's ~400-line-per-file guidance. Purely presentational: all data comes
 * from usePersonalLibraryGames() in the parent.
 */
import React from 'react';
import { GameCard } from '../GameCard.js';
import type { GameCardData } from '../game-card-status.js';
import styles from './sidebar.module.css';

interface QuickAccessSectionProps {
  title: string;
  games: GameCardData[];
  onSelectGame: (gameId: string) => void;
  onViewAll: () => void;
  /** Bound applied to the rendered list — the shelf still shows "View all" whenever the real count exceeds it. */
  limit: number;
  emptyHint?: string;
}

function QuickAccessSection({ title, games, onSelectGame, onViewAll, limit, emptyHint }: QuickAccessSectionProps) {
  if (games.length === 0) {
    if (!emptyHint) return null;
    return (
      <section className={styles.quickSection} aria-label={title}>
        <h4 className={styles.quickSectionTitle}>{title}</h4>
        <p className={styles.quickSectionEmpty}>{emptyHint}</p>
      </section>
    );
  }

  const visible = games.slice(0, limit);
  const hasMore = games.length > limit;

  return (
    <section className={styles.quickSection} aria-label={title}>
      <div className={styles.quickSectionHeader}>
        <h4 className={styles.quickSectionTitle}>{title}</h4>
        {hasMore && (
          <button type="button" className={styles.viewAllLink} onClick={onViewAll}>
            View all
          </button>
        )}
      </div>
      <div className={styles.quickSectionList}>
        {visible.map((game) => (
          <GameCard key={game.gameId} game={game} mode="list" onSelect={onSelectGame} />
        ))}
      </div>
      {!hasMore && games.length > 0 && (
        <button type="button" className={styles.viewAllLink} onClick={onViewAll}>
          View all
        </button>
      )}
    </section>
  );
}

export interface SidebarQuickAccessProps {
  runningGame: GameCardData | null;
  favoriteGames: GameCardData[];
  myGames: GameCardData[];
  onSelectGame: (gameId: string) => void;
  onViewAllGames: () => void;
  shelfLimit: number;
}

export function SidebarQuickAccess({
  runningGame,
  favoriteGames,
  myGames,
  onSelectGame,
  onViewAllGames,
  shelfLimit,
}: SidebarQuickAccessProps) {
  return (
    <div className={styles.quickAccess}>
      {/* Running has no placeholder when nothing is running — only ever renders with a real game. */}
      {runningGame && (
        <QuickAccessSection
          title="Running"
          games={[runningGame]}
          onSelectGame={onSelectGame}
          onViewAll={onViewAllGames}
          limit={1}
        />
      )}
      <QuickAccessSection
        title="Favorites"
        games={favoriteGames}
        onSelectGame={onSelectGame}
        onViewAll={onViewAllGames}
        limit={shelfLimit}
      />
      <QuickAccessSection
        title="My Games"
        games={myGames}
        onSelectGame={onSelectGame}
        onViewAll={onViewAllGames}
        limit={shelfLimit}
      />
    </div>
  );
}

export default SidebarQuickAccess;
