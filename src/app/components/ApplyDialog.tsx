import React, { useEffect, useMemo, useRef } from 'react';
import type { TrainerItem } from '../../shared/types/index.js';

interface ApplyDialogProps {
  item: TrainerItem;
  value: any;
  onConfirm: () => void;
  onCancel: () => void;
  isBusy?: boolean;
}

export const ApplyDialog: React.FC<ApplyDialogProps> = ({ item, value, onConfirm, onCancel, isBusy = false }) => {
  const isRisky = item.risk === 'Risky';
  const isBlocked = item.risk === 'Blocked';
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const statusMessage = useMemo(() => (isBusy ? 'Applying change in progress.' : 'Review and confirm the proposed trainer change.'), [isBusy]);
  const shortFile = item.source
    ? item.source.split('\\').pop() ?? item.source.split('/').pop() ?? item.source
    : '—';

  if (isBlocked) return null;

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    const overlay = overlayRef.current;
    const focusable = overlay?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!overlay) return;
      if (event.key === 'Escape' && !isBusy) {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') return;
      const activeFocusable = overlay.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!activeFocusable.length) return;
      const first = activeFocusable[0];
      const last = activeFocusable[activeFocusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isBusy, onCancel]);

  return (
    <div
      ref={overlayRef}
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-dialog-title"
      aria-describedby="apply-dialog-description apply-dialog-status"
      onClick={() => { if (!isBusy) onCancel(); }}
    >
      <div className="dialog-box" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3 id="apply-dialog-title">Apply Change</h3>
          <button className="dialog-close" onClick={onCancel} aria-label="Close apply dialog" disabled={isBusy}>✕</button>
        </div>

        <div className="dialog-body">
          <p id="apply-dialog-description" className="sr-only">
            Confirm the value change preview before applying. A backup will be created first.
          </p>
          <p id="apply-dialog-status" aria-live="polite" className="sr-only">{statusMessage}</p>
          <p className="dialog-recipe-name">{item.name}</p>

          <div className="diff-preview">
            <div className="diff-col">
              <span className="diff-label">Current Value</span>
              <span className="diff-val diff-old">{String(item.currentValue ?? '—')}</span>
            </div>
            <div className="diff-arrow" aria-hidden="true">→</div>
            <div className="diff-col">
              <span className="diff-label">Proposed Value</span>
              <span className="diff-val diff-new">{String(value)}</span>
            </div>
          </div>

          <div className="dialog-meta">
            <div className="meta-row">
              <span className="meta-key">File</span>
              <span className="meta-val">{shortFile}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Target path</span>
              <code className="meta-val meta-code">{item.path ?? '—'}</code>
            </div>
            <div className="meta-row">
              <span className="meta-key">Risk</span>
              <span className={`meta-val risk-chip risk-${item.risk.toLowerCase()}`}>{item.risk}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Backup</span>
              <span className="meta-val">Verified backup created before every write</span>
            </div>
          </div>

          {isRisky && (
            <div className="dialog-warning" role="alert">
              ⚠ This change is marked <strong>Risky</strong>. Verify the game is closed and
              confirm you understand the effect before continuing.
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            className={`btn-primary ${isRisky ? 'btn-risky' : ''}`}
            onClick={onConfirm}
            autoFocus
            disabled={isBusy}
          >
            {isBusy ? 'Applying…' : 'Confirm Apply'}
          </button>
        </div>
      </div>
    </div>
  );
};
