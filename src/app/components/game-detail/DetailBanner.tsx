import React from 'react';
import styles from './DetailBanner.module.css';
import type { PersonalLibraryGame } from '../../../core/personal-library/model.js';
import type { TrainerCatalogEntry } from '../../../core/trainer-catalog/types.js';
import { resolveCatalogHeaderUrl } from '../../../core/trainer-catalog/cover-url.js';
import { fallbackArtworkTreatment } from '../../pages/trainer-card-fallback-artwork.js';
import { primaryStatusLabel, trainerStatusLabel, type GameCardData } from '../game-card-status.js';

/**
 * GameDetailPage banner — Visual Library 2.0, Step 7.
 *
 * Actions row renders ONLY buttons this step's audit confirmed are backed by
 * real, wired IPC (see GameDetailPage.tsx's header for the audit findings):
 *   - "Open Game Folder" — real `installDiscoveryOpenPath` IPC, same call
 *     TrainerDeckPage.tsx's handleOpenInstallFolder already makes. Rendered
 *     only when `game.installed` is true (the handler itself 404s on
 *     `not_installed`, so this mirrors the handler's own precondition rather
 *     than inventing a new one).
 *   - "Open Trainer" — navigates to the EXISTING 'live-memory' view via the
 *     caller-supplied `onOpenTrainer` callback (App.tsx's real
 *     `openLiveTrainerFromDeck`/`setCurrentView('live-memory')` pattern).
 *     This never starts a live-memory/process-attach flow itself — it is
 *     pure navigation, matching the owner's hard "no live-game interaction"
 *     rule for this step. Rendered only when a trainer genuinely exists
 *     (`trainerAvailability !== 'NONE'`).
 *
 * No "Play"/"Launch Game" button exists here or anywhere in this file —
 * the audit found `launch-installation`/`launchInstallation` IPC is real but
 * starts the game executable, which the hard rule forbids wiring in this step.
 */

export interface DetailBannerProps {
  game: PersonalLibraryGame;
  /** Full catalog entry, used only for header artwork — undefined renders the branded fallback. */
  entry: TrainerCatalogEntry | null;
  onOpenFolder: () => void;
  folderBusy: boolean;
  folderError: string | null;
  onOpenTrainer: () => void;
}

function toCardData(game: PersonalLibraryGame): GameCardData {
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
  };
}

export function DetailBanner({ game, entry, onOpenFolder, folderBusy, folderError, onOpenTrainer }: DetailBannerProps) {
  const cardData = toCardData(game);
  const headerUrl = entry
    ? resolveCatalogHeaderUrl(entry, {
        canonicalConfidence: game.canonicalConfidence === 'EXACT' || game.canonicalConfidence === 'HIGH' ? 'trusted' : 'weak',
      })
    : undefined;
  const fallback = fallbackArtworkTreatment(game.title);
  const primaryLabel = primaryStatusLabel(cardData);
  const trainerLabel = trainerStatusLabel(cardData);
  const canOpenFolder = game.installed;
  const canOpenTrainer = game.trainerAvailability !== 'NONE';

  return (
    <section className={styles.banner} data-testid="game-detail-banner">
      <div className={styles.artworkWrap}>
        {headerUrl ? (
          <img
            src={headerUrl}
            alt={`${game.title} artwork`}
            className={styles.artworkImage}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const fallbackEl = img.nextElementSibling;
              if (fallbackEl) (fallbackEl as HTMLElement).style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className={styles.artworkFallback}
          data-testid="game-detail-artwork-fallback"
          style={{
            ...(headerUrl ? { display: 'none' } : undefined),
            ['--fallback-hue-a' as string]: fallback.hueA,
            ['--fallback-hue-b' as string]: fallback.hueB,
          }}
        >
          <span aria-hidden="true">{fallback.initial}</span>
        </div>
      </div>

      <div className={styles.info}>
        <h1 className={styles.title}>{game.title}</h1>
        <p className={styles.statusLine} data-testid="game-detail-status-line">
          {[primaryLabel, trainerLabel].filter(Boolean).join(' · ')}
        </p>

        <div className={styles.actions}>
          {canOpenFolder && (
            <button
              type="button"
              className={styles.actionButton}
              onClick={onOpenFolder}
              disabled={folderBusy}
              data-testid="game-detail-open-folder"
            >
              {folderBusy ? 'Opening…' : 'Open Game Folder'}
            </button>
          )}
          {canOpenTrainer && (
            <button
              type="button"
              className={styles.actionButtonSecondary}
              onClick={onOpenTrainer}
              data-testid="game-detail-open-trainer"
            >
              Open Trainer
            </button>
          )}
        </div>
        {folderError && (
          <p className={styles.actionError} data-testid="game-detail-folder-error" role="alert">
            {folderError}
          </p>
        )}
      </div>
    </section>
  );
}

export default DetailBanner;
