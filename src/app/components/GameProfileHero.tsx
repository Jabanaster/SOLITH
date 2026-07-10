import React from 'react';
import styles from './GameProfileHero.module.css';

interface GameProfileHeroChip {
  label: string;
  tone: 'safe' | 'neutral' | 'gold';
}

interface GameProfileHeroProps {
  gameName: string;
  initials: string;
  pathLabel: string;
  chips: GameProfileHeroChip[];
  actionLabel: string;
  onAction: () => void;
}

/**
 * The single strongest visual element on any page that uses it — the
 * "focal point" per the design spec. Not wired into any page yet; this is
 * the built, typed primitive for a later pass to consume.
 */
export const GameProfileHero: React.FC<GameProfileHeroProps> = ({
  gameName,
  initials,
  pathLabel,
  chips,
  actionLabel,
  onAction,
}) => {
  return (
    <div className={styles.hero}>
      <div className={styles.art}>{initials}</div>
      <div className={styles.body}>
        <div className={styles.topRow}>
          <div>
            <div className={styles.title}>{gameName}</div>
            <div className={styles.sub}>{pathLabel}</div>
          </div>
          <button className={styles.action} onClick={onAction}>{actionLabel}</button>
        </div>
        <div className={styles.meta}>
          {chips.map((chip) => (
            <span key={chip.label} className={`${styles.chip} ${styles[chip.tone]}`}>{chip.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
};
