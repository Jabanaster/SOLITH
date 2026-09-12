import React from 'react';
import styles from './GameDetailSections.module.css';
import type { PersonalLibraryGame } from '../../../core/personal-library/model.js';
import { LAUNCHER_LABELS } from '../game-card-status.js';

/**
 * Game information section — Visual Library 2.0, Step 7.
 *
 * Owner's rule: only fields with real evidence on the record render; any
 * field with no evidence renders "Unknown" rather than being fabricated.
 * All values come straight off `PersonalLibraryGame.installEvidence` /
 * `versionEvidence` (src/core/personal-library/model.ts) — this component
 * performs no inference of its own, only picks the most-recently-seen
 * install evidence row to summarize.
 */

const UNKNOWN = 'Unknown';

function mostRecentInstall(game: PersonalLibraryGame) {
  if (game.installEvidence.length === 0) return null;
  return [...game.installEvidence].sort(
    (a, b) => Date.parse(b.lastSeenAt || b.detectedAt) - Date.parse(a.lastSeenAt || a.detectedAt),
  )[0];
}

function mostRecentVersion(game: PersonalLibraryGame) {
  if (game.versionEvidence.length === 0) return null;
  return [...game.versionEvidence].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
}

export interface GameInfoSectionProps {
  game: PersonalLibraryGame;
}

export function GameInfoSection({ game }: GameInfoSectionProps) {
  const install = mostRecentInstall(game);
  const version = mostRecentVersion(game);

  const rows: Array<{ label: string; value: string; testId: string }> = [
    {
      label: 'Version',
      value: version?.executableVersion ?? UNKNOWN,
      testId: 'game-detail-info-version',
    },
    {
      label: 'Executable path',
      value: install?.executablePath ?? UNKNOWN,
      testId: 'game-detail-info-executable',
    },
    {
      label: 'Install path',
      value: install?.installPath ?? UNKNOWN,
      testId: 'game-detail-info-install-path',
    },
    {
      label: 'Launcher',
      value: install ? LAUNCHER_LABELS[install.launcher] : UNKNOWN,
      testId: 'game-detail-info-launcher',
    },
    {
      label: 'Last detected',
      value: install?.lastSeenAt ?? UNKNOWN,
      testId: 'game-detail-info-last-detected',
    },
  ];

  return (
    <section className={styles.section} data-testid="game-detail-info-section">
      <h2 className={styles.heading}>Game Information</h2>
      <dl className={styles.factList}>
        {rows.map((row) => (
          <div className={styles.fact} key={row.label}>
            <dt>{row.label}</dt>
            <dd data-testid={row.testId}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default GameInfoSection;
