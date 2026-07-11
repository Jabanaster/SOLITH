import React from 'react';
import styles from './LibraryLaunchDialog.module.css';

export type LibraryLaunchMode = 'live-trainer' | 'save-controls';

export interface LibraryLaunchChoice {
  catalogGameId: string;
  displayName: string;
  memoryCheatCount: number;
  saveControlCount: number;
}

interface LibraryLaunchDialogProps {
  choice: LibraryLaunchChoice;
  onSelect: (mode: LibraryLaunchMode) => void;
  onCancel: () => void;
}

export function LibraryLaunchDialog({ choice, onSelect, onCancel }: LibraryLaunchDialogProps) {
  const hybrid = choice.memoryCheatCount > 0 && choice.saveControlCount > 0;

  return (
    <div className={styles.backdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-labelledby="library-launch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="library-launch-title">Launch {choice.displayName}</h2>
        <p className={styles.subtitle}>
          This definition includes {choice.memoryCheatCount} live-memory feature
          {choice.memoryCheatCount === 1 ? '' : 's'} and {choice.saveControlCount} save-field control
          {choice.saveControlCount === 1 ? '' : 's'}. Choose how to open it.
        </p>
        <div className={styles.actions}>
          {choice.memoryCheatCount > 0 && (
            <button type="button" className={styles.primary} onClick={() => onSelect('live-trainer')}>
              Live Trainer
              <span className={styles.hint}>Memory scan, freeze, and toggles</span>
            </button>
          )}
          {choice.saveControlCount > 0 && (
            <button type="button" className={styles.primary} onClick={() => onSelect('save-controls')}>
              Save Controls
              <span className={styles.hint}>Backup, approve, and rollback save edits</span>
            </button>
          )}
          {hybrid && (
            <button type="button" className={styles.secondary} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
