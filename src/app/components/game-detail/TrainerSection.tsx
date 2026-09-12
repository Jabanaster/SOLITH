import React from 'react';
import styles from './GameDetailSections.module.css';
import type { PersonalLibraryGame } from '../../../core/personal-library/model.js';
import type { TrainerCatalogEntry } from '../../../core/trainer-catalog/types.js';

/**
 * Trainer + trainer-accuracy section — Visual Library 2.0, Step 7.
 *
 * Every value here is read directly off the real PersonalLibraryGame /
 * TrainerCatalogEntry records — no invented cheat lists, no fabricated
 * accuracy state. `trainerAccuracy` reuses the same 7-state model
 * (`TrainerAccuracyState`) the rest of the app computes via
 * `computeTrainerAccuracy` (see src/core/trainer-catalog/trainer-accuracy.ts)
 * — this component only renders it, never re-derives it.
 */

const ACCURACY_LABELS: Record<PersonalLibraryGame['trainerAccuracy'], string> = {
  NONE: 'No Trainer',
  VERSION_UNKNOWN: 'Trainer Ready — Version Unknown',
  LOCALLY_VERIFIED: 'Locally Verified',
  EXACT_VERSION_MATCH: 'Exact Version Match',
  STRONG_MATCH: 'Strong Match',
  NEEDS_REVERIFY: 'Needs Reverify',
  INCOMPATIBLE: 'Incompatible',
};

export interface TrainerSectionProps {
  game: PersonalLibraryGame;
  entry: TrainerCatalogEntry | null;
}

export function TrainerSection({ game, entry }: TrainerSectionProps) {
  if (game.trainerAvailability === 'NONE') {
    return (
      <section className={styles.section} data-testid="game-detail-trainer-section">
        <h2 className={styles.heading}>Trainer</h2>
        <p className={styles.emptyNote}>No trainer available for this game yet.</p>
      </section>
    );
  }

  return (
    <section className={styles.section} data-testid="game-detail-trainer-section">
      <h2 className={styles.heading}>Trainer</h2>
      <dl className={styles.factList}>
        <div className={styles.fact}>
          <dt>Cheats</dt>
          <dd data-testid="game-detail-cheat-count">{game.trainerCount}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Availability</dt>
          <dd>{game.trainerAvailability}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Accuracy</dt>
          <dd data-testid="game-detail-trainer-accuracy">{ACCURACY_LABELS[game.trainerAccuracy]}</dd>
        </div>
        {entry?.certLevel && (
          <div className={styles.fact}>
            <dt>Certification</dt>
            <dd>{entry.certLevel === 'L3_Certified' ? 'Certified (L3)' : 'Community (L0)'}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export default TrainerSection;
