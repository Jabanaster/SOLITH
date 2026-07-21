import React from 'react';
import type { CheatDefinition } from '../../core/cheat-system/types.js';
import type { CheatSessionState } from '../hooks/useGameCheatSession.js';
import styles from './AvowedCheatDeck.module.css';

/** Pinned L0 feature ids — must match AVOWED_L0_DEFINITION / AVOWED_CONFIG.pinnedCheatIds. */
export const AVOWED_L0_FEATURE_IDS = [
  'infinite-health',
  'infinite-stamina',
  'infinite-essence',
] as const;

export type AvowedZeroInputStatus = {
  phase: 'idle' | 'preparing' | 'ready' | 'error';
  message?: string;
  counts?: { resolved: number; scanRequired: number; failed: number };
};

export interface AvowedCheatDeckProps {
  features: CheatDefinition[];
  zeroInputStatus: AvowedZeroInputStatus;
  getState: (cheatId: string) => CheatSessionState;
  /** Parent owns toggle/discovery/IPC — deck only presents L0 chrome + hydrate badges. */
  renderFeature: (cheat: CheatDefinition) => React.ReactNode;
}

function hydrateLabel(state: CheatSessionState): string {
  if (state.confirmedAddress) return 'hydrated';
  if (state.status === 'discovering') return 'scanning';
  if (state.status === 'error') return 'error';
  return 'scan-required';
}

/**
 * Thin Avowed deck surface for Xbox PC Game Pass (WinGDK) + Steam.
 * No polling and no parallel session state — relies on useGameCheatSession
 * Zero-Input prepare + event-driven hydrate.
 */
export const AvowedCheatDeck: React.FC<AvowedCheatDeckProps> = ({
  features,
  zeroInputStatus,
  getState,
  renderFeature,
}) => {
  const l0Features = features.filter((f) =>
    (AVOWED_L0_FEATURE_IDS as readonly string[]).includes(f.id),
  );

  return (
    <section className={styles.deck} data-game="avowed" data-tier="L0">
      <header className={styles.header}>
        <h2 className={styles.title}>Avowed L0 Deck</h2>
        <p className={styles.subtitle}>
          Steam (<code>Avowed.exe</code>) and Xbox PC Game Pass (
          <code>Avowed-WinGDK-Shipping.exe</code>). All features are scan-required — no verified
          AOBs or pointer chains.
        </p>
        {zeroInputStatus.phase !== 'idle' && (
          <p className={styles.zeroInput} role="status" aria-live="polite" data-zero-input-phase={zeroInputStatus.phase}>
            {zeroInputStatus.phase === 'preparing' &&
              (zeroInputStatus.message ?? 'Zero-Input preparing…')}
            {zeroInputStatus.phase === 'ready' && (
              <>
                {zeroInputStatus.message ?? 'Zero-Input ready'}
                {zeroInputStatus.counts
                  ? ` — resolved ${zeroInputStatus.counts.resolved}, scan-required ${zeroInputStatus.counts.scanRequired}, failed ${zeroInputStatus.counts.failed}`
                  : null}
              </>
            )}
            {zeroInputStatus.phase === 'error' && (zeroInputStatus.message ?? 'Zero-Input error')}
          </p>
        )}
      </header>

      <ul className={styles.hydrateList} aria-label="L0 feature hydrate status">
        {l0Features.map((feature) => {
          const state = getState(feature.id);
          const label = hydrateLabel(state);
          return (
            <li key={feature.id} className={styles.hydrateItem} data-hydrate={label}>
              <span className={styles.featureName}>{feature.name}</span>
              <span className={styles.badge} data-badge={label}>
                L0 · {label}
              </span>
            </li>
          );
        })}
      </ul>

      <div className={styles.featureList}>{l0Features.map((feature) => renderFeature(feature))}</div>
    </section>
  );
};
