import React from 'react';
import type { TrainerItem } from '../../shared/types/index.js';
import type { TrainerCardState } from './TrainerCard.js';

interface ContextPanelProps {
  item: TrainerItem | null;
  value: any;
  cardState: TrainerCardState | null;
  lastBackupId: string | null;
  lastOpMessage: string | null;
  onRestore: (backupId: string) => void;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({
  item, value, cardState, lastBackupId, lastOpMessage, onRestore
}) => {
  if (!item) {
    return (
      <aside className="context-panel context-empty" aria-label="Trainer item details">
        <div className="context-placeholder">
          <div className="context-icon" aria-hidden="true">◎</div>
          <p>Select a trainer item to see details, preconditions, and restore options.</p>
        </div>
      </aside>
    );
  }

  const hasProposedValue = value !== undefined && value !== '' && value !== null;

  return (
    <aside className="context-panel" aria-label={`Details for ${item.name}`}>
      <div className="cp-header">
        <h4>{item.name}</h4>
        <span className="cp-category">{item.category}</span>
      </div>

      <p className="cp-description">{item.description || 'No description provided.'}</p>

      <section className="cp-section" aria-label="Values">
        <div className="cp-row">
          <span className="cp-key">Current value</span>
          <strong className="cp-val">
            {item.currentValue !== undefined ? String(item.currentValue) : '—'}
          </strong>
        </div>
        <div className="cp-row">
          <span className="cp-key">Proposed</span>
          <strong className={`cp-val ${hasProposedValue ? 'cp-proposed' : 'cp-empty'}`}>
            {hasProposedValue ? String(value) : '—'}
          </strong>
        </div>
      </section>

      <section className="cp-section" aria-label="Recipe details">
        <div className="cp-row">
          <span className="cp-key">Risk</span>
          <span className={`risk-chip risk-${item.risk.toLowerCase()}`}>{item.risk}</span>
        </div>
        {item.confidence !== undefined && (
          <div className="cp-row">
            <span className="cp-key">Confidence</span>
            <span className="cp-val">{item.confidence}%</span>
          </div>
        )}
        {item.min !== undefined && item.max !== undefined && (
          <div className="cp-row">
            <span className="cp-key">Range</span>
            <span className="cp-val">{item.min} – {item.max}</span>
          </div>
        )}
      </section>

      {item.path && (
        <section className="cp-section" aria-label="Target path">
          <div className="cp-label">Target path</div>
          <code className="cp-path">{item.path}</code>
        </section>
      )}

      {cardState === 'GAME_RUNNING' && (
        <div className="cp-warning" role="alert">
          Close the game before applying changes. The game may overwrite your edits.
        </div>
      )}

      {cardState === 'NEEDS_RESCAN' && (
        <div className="cp-warning" role="alert">
          The save structure changed after a game update. Use Workshop Mode to rescan.
        </div>
      )}

      {lastOpMessage && (
        <section className="cp-section" aria-label="Last operation">
          <div className="cp-label">Last operation</div>
          <div className="cp-op">{lastOpMessage}</div>
        </section>
      )}

      {lastBackupId && (
        <section className="cp-section" aria-label="Restore">
          <div className="cp-label">Backup available</div>
          <button
            className="btn-secondary cp-restore-btn"
            onClick={() => onRestore(lastBackupId)}
            aria-label="Restore from last backup"
          >
            ↩ Restore Last Backup
          </button>
        </section>
      )}
    </aside>
  );
};
