import React from 'react';
import styles from './GameCard.module.css';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import { resolveCatalogCoverUrl } from '../../core/trainer-catalog/cover-url.js';
import { fallbackArtworkTreatment } from '../pages/trainer-card-fallback-artwork.js';
import { primaryStatusLabel, trainerStatusLabel, type GameCardData } from './game-card-status.js';

export type { GameCardData } from './game-card-status.js';

export interface GameCardProps {
  /** A real PersonalLibraryGame, or a compatible subset — see GameCardData. */
  game: GameCardData;
  /**
   * Catalog entry used ONLY for artwork resolution via
   * resolveCatalogCoverUrl (src/core/trainer-catalog/cover-url.ts) —
   * PersonalLibraryGame itself carries no artwork fields. Undefined renders
   * the same SOLITH branded fallback CatalogCard uses for a missing cover.
   */
  catalogEntry?: TrainerCatalogEntry;
  mode: 'grid' | 'list';
  /** Called with the game's id on click/activation — no navigation here, that's a later step. */
  onSelect: (gameId: string) => void;
}

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

export function GameCard({ game, catalogEntry, mode, onSelect }: GameCardProps) {
  // Artwork audit (Mission 7) — HomePage/MyGamesPage/SidebarQuickAccess never
  // pass `catalogEntry` (it's data GameCardData's callers don't have without
  // an extra fetch), which meant real cover art was never resolved on Home,
  // My Games, or the sidebar quick-access shelves — every card there fell
  // back to the branded placeholder regardless of what artwork actually
  // existed (confirmed via a real-Electron DOM audit). `game.artworkUrl` is
  // now precomputed with the SAME confidence-gated resolution by
  // projectPersonalLibraryGame (src/core/personal-library/model.ts), so it
  // takes precedence here; `catalogEntry` stays as a secondary path for any
  // caller that already has a full TrainerCatalogEntry handy.
  const coverUrl = game.artworkUrl ?? (catalogEntry ? resolveCatalogCoverUrl(catalogEntry) : undefined);
  const fallback = fallbackArtworkTreatment(game.title);
  const primaryLabel = primaryStatusLabel(game);
  const trainerLabel = trainerStatusLabel(game);
  const rootClassName = mode === 'grid' ? styles.cardGrid : styles.cardList;

  const handleActivate = () => onSelect(game.gameId);

  return (
    <article
      className={rootClassName}
      data-mode={mode}
      data-testid="game-card"
      role="button"
      tabIndex={0}
      aria-label={`${game.title} — open details`}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (isActivationKey(event.key)) {
          event.preventDefault();
          handleActivate();
        }
      }}
    >
      <div className={styles.coverWrap}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`${game.title} cover art`}
            loading="lazy"
            className={styles.coverImage}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const fallbackEl = img.nextElementSibling;
              if (fallbackEl) (fallbackEl as HTMLElement).style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className={styles.coverFallback}
          data-testid="game-card-fallback"
          style={{
            ...(coverUrl ? { display: 'none' } : undefined),
            ['--fallback-hue-a' as string]: fallback.hueA,
            ['--fallback-hue-b' as string]: fallback.hueB,
          }}
        >
          <span className={styles.coverFallbackInitial} aria-hidden="true">
            {fallback.initial}
          </span>
        </div>
        {game.favorite && (
          <span className={styles.favoriteIndicator} data-testid="game-card-favorite" aria-label="Favorited" title="Favorited">
            ★
          </span>
        )}
      </div>
      <div className={styles.body}>
        <h3 className={styles.title} title={game.title}>
          {game.title}
        </h3>
        {primaryLabel && (
          <p className={styles.primaryLine} data-testid="game-card-primary-line">
            {primaryLabel}
          </p>
        )}
        <p className={styles.secondaryLine} data-testid="game-card-trainer-line">
          {trainerLabel}
        </p>
      </div>
    </article>
  );
}

export default GameCard;
