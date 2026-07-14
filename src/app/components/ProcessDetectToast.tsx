import React from 'react';
import styles from './ProcessDetectToast.module.css';

export function ProcessDetectToast({
  displayName,
  executable,
  onOpenDeck,
  onDismiss,
}: {
  displayName: string;
  executable: string;
  onOpenDeck: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <div className={styles.copy}>
        <strong>{displayName}</strong> detected ({executable})
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
