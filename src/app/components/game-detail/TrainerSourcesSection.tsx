import React from 'react';
import styles from './GameDetailSections.module.css';
import type { TrainerCatalogEntry } from '../../../core/trainer-catalog/types.js';

/**
 * Trainer sources section — Visual Library 2.0, Step 7.
 *
 * Renders the real `sources` array off the catalog entry (provider + last
 * synced timestamp) plus the entry's own verification tier — no invented
 * source breakdown. Renders nothing (section omitted) when there is no
 * catalog entry at all, or the entry lists no sources, since there is
 * nothing real to show.
 */

const PROVIDER_LABELS: Record<string, string> = {
  bundled: 'Bundled',
  mrantifun: 'MrAntiFun',
  fling: 'FLiNG',
  plitch: 'PLITCH',
  'remote-listing': 'Remote Listing',
  'ct-import': 'Local CT Import',
};

export interface TrainerSourcesSectionProps {
  entry: TrainerCatalogEntry | null;
}

export function TrainerSourcesSection({ entry }: TrainerSourcesSectionProps) {
  if (!entry || entry.sources.length === 0) return null;

  return (
    <section className={styles.section} data-testid="game-detail-sources-section">
      <h2 className={styles.heading}>Trainer Sources</h2>
      <p className={styles.emptyNote}>
        Verification tier: {entry.verificationStatus}
        {entry.certLevel ? ` (${entry.certLevel})` : ''}
      </p>
      <ul className={styles.sourceList}>
        {entry.sources.map((source, index) => (
          <li key={`${source.provider}-${index}`} className={styles.sourceItem} data-testid="game-detail-source-item">
            <span>{PROVIDER_LABELS[source.provider] ?? source.provider}</span>
            {source.lastSyncedAt && <span className={styles.sourceMeta}>Synced {source.lastSyncedAt}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default TrainerSourcesSection;
