import React, { useCallback, useState } from 'react';
import {
  SINGLE_PLAYER_WAIVER_COPY,
  type SinglePlayerWaiverStoreLike,
} from '../../core/live-memory/single-player-waiver-shared.js';

export interface SinglePlayerWaiverModalProps {
  open: boolean;
  scopeKey: string;
  store?: SinglePlayerWaiverStoreLike | null;
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * Trust Shift acknowledgement — sticky after accept (caller persists via store).
 */
export const SinglePlayerWaiverModal: React.FC<SinglePlayerWaiverModalProps> = ({
  open,
  scopeKey,
  store,
  onAccept,
  onCancel,
}) => {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const accept = useCallback(() => {
    setBusy(true);
    try {
      store?.accept(scopeKey);
      onAccept();
    } finally {
      setBusy(false);
    }
  }, [onAccept, scopeKey, store]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiver-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: 'var(--surface, #1a1a1a)',
          color: 'var(--text, #f2f2f2)',
          border: '1px solid var(--border, #444)',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <h2 id="waiver-title" style={{ marginTop: 0 }}>
          Enable live modifications?
        </h2>
        <p>{SINGLE_PLAYER_WAIVER_COPY}</p>
        <p style={{ fontSize: 13, opacity: 0.85 }}>
          Scope: <code>{scopeKey}</code>. Acceptance is stored locally on this machine (no cloud).
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={accept} disabled={busy}>
            I understand — enable
          </button>
        </div>
      </div>
    </div>
  );
};

export default SinglePlayerWaiverModal;
