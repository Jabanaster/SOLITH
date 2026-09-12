import React from 'react';
import styles from './HomeShelf.module.css';
import { GameCard, type GameCardData } from './GameCard.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';

export interface HomeShelfProps {
  /** Shelf heading, e.g. "My Games", "Trainers Ready". */
  title: string;
  /**
   * Real games to render in this shelf — already filtered/sorted/capped by
   * the caller's selector (src/core/personal-library/home-sections.ts).
   * This component never re-filters or re-sorts; it only decides whether to
   * render anything at all.
   */
  games: GameCardData[];
  /**
   * Optional catalog entries keyed by gameId, used only for cover-art
   * resolution (GameCard's own `catalogEntry` prop) — a game with no entry
   * here still renders correctly via GameCard's branded fallback artwork.
   */
  catalogEntriesById?: Record<string, TrainerCatalogEntry>;
  onSelect: (gameId: string) => void;
}

/**
 * Reusable horizontal-scroll shelf for the Home page (and My Games, where
 * useful) — Visual Library 2.0, Step 5.
 *
 * Hard rule shared with home-sections.ts (owner-specified): a shelf renders
 * ONLY when it has real, meaningful data behind it. This component enforces
 * that itself (returns null on an empty `games` array) so every call site
 * gets the rule for free, but callers are still expected to only ever pass
 * an already-populated array — this is a defensive backstop, not a reason
 * for a caller to skip its own empty check.
 */
export function HomeShelf({ title, games, catalogEntriesById, onSelect }: HomeShelfProps) {
  if (games.length === 0) return null;

  return (
    <section className={styles.shelf} aria-labelledby={`${slugify(title)}-heading`} data-testid="home-shelf">
      <h2 className={styles.title} id={`${slugify(title)}-heading`}>
        {title}
      </h2>
      <div className={styles.track} role="list">
        {games.map((game) => (
          <div className={styles.item} role="listitem" key={game.gameId}>
            <GameCard
              game={game}
              catalogEntry={catalogEntriesById?.[game.gameId]}
              mode="grid"
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default HomeShelf;
