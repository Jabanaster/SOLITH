import React, { useState } from 'react';
import styles from './DefinitionRatingPrompt.module.css';

interface DefinitionRatingPromptProps {
  gameName: string;
  catalogGameId: string;
  featureId: string;
  onClose: () => void;
}

export const DefinitionRatingPrompt: React.FC<DefinitionRatingPromptProps> = ({
  gameName,
  catalogGameId,
  featureId,
  onClose,
}) => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (rating: 1 | -1) => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogFeedbackRecord) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await api.trainerCatalogFeedbackRecord({ catalogGameId, featureId, rating });
      setDone(true);
      window.setTimeout(onClose, 1200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="rating-prompt-title">
      <div className={styles.card}>
        <h3 id="rating-prompt-title">Did this cheat work?</h3>
        <p>
          Your feedback helps promote community definitions for <strong>{gameName}</strong>.
        </p>
        {done ? (
          <p className={styles.thanks}>Thanks — recorded.</p>
        ) : (
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void submit(1)}>
              👍 Worked
            </button>
            <button type="button" disabled={busy} onClick={() => void submit(-1)}>
              👎 Did not work
            </button>
            <button type="button" className={styles.skip} disabled={busy} onClick={onClose}>
              Skip
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
