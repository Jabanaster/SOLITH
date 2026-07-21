import React from 'react';
import styles from './ProcessDetectToast.module.css';

export function ProcessDetectToast({
  displayName,
  executable,
  prepareReady,
  blockReason,
  onOpenDeck,
  onDismiss,
}: {
  displayName: string;
  executable: string;
  prepareReady?: boolean;
  blockReason?: string;
  onOpenDeck: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <div className={styles.copy}>
        <strong>{displayName}</strong> detected ({executable})
        {prepareReady ? (
          <div className={styles.hint}>Zero-Input profile available — open deck and confirm offline to prepare.</div>
        ) : null}
        {blockReason && !prepareReady ? (
          <div className={styles.hint}>{blockReason}</div>
        ) : null}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onOpenDeck}>
          Open Trainer Deck
        </button>
        <button type="button" className={styles.secondary} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
