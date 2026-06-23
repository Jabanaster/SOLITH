import React from 'react';
import type { TrainerItem } from '../../shared/types/index.js';

interface ApplyDialogProps {
  item: TrainerItem;
  value: any;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ApplyDialog: React.FC<ApplyDialogProps> = ({ item, value, onConfirm, onCancel }) => {
  const isRisky = item.risk === 'Risky';
  const isBlocked = item.risk === 'Blocked';
  const shortFile = item.source
    ? item.source.split('\\').pop() ?? item.source.split('/').pop() ?? item.source
    : '—';

  if (isBlocked) return null;

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-dialog-title"
      onClick={onCancel}
    >
      <div className="dialog-box" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3 id="apply-dialog-title">Apply Change</h3>
          <button className="dialog-close" onClick={onCancel} aria-label="Cancel">✕</button>
        </div>

        <div className="dialog-body">
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
          >
            Confirm Apply
          </button>
        </div>
      </div>
    </div>
  );
};
