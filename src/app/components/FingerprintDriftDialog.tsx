import React from 'react';
import styles from './FingerprintDriftDialog.module.css';

interface FingerprintDriftDialogProps {
  warning: string;
  onProceed: () => void;
  onCancel: () => void;
}

export function FingerprintDriftDialog({ warning, onProceed, onCancel }: FingerprintDriftDialogProps) {
  return (
    <div className={styles.backdrop} role="presentation">
      <div className={styles.dialog} role="alertdialog" aria-labelledby="drift-title" aria-describedby="drift-body">
        <h2 id="drift-title">Executable mismatch detected</h2>
        <p id="drift-body">{warning}</p>
        <p className={styles.note}>
          The loaded trainer definition may not match this game build (patch day drift). Proceed only if you trust this
          definition for the running executable.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel attach
          </button>
          <button type="button" className={styles.proceed} onClick={onProceed}>
            Proceed anyway
          </button>
        </div>
      </div>
    </div>
  );
}
