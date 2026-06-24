import React from 'react';
import type { TrainerItem } from '../../shared/types/index.js';

export type TrainerCardState =
  | 'READY'
  | 'GAME_RUNNING'
  | 'NEEDS_RESCAN'
  | 'BROKEN'
  | 'BLOCKED'
  | 'APPLYING'
  | 'APPLIED'
  | 'RESTORED'
  | 'FAILED';

export const STATE_CONFIG: Record<TrainerCardState, { label: string; color: string; explanation: string }> = {
  READY:        { label: 'Ready',        color: 'safe',    explanation: '' },
  GAME_RUNNING: { label: 'Game Running', color: 'caution', explanation: 'Close the game before modifying this save.' },
  NEEDS_RESCAN: { label: 'Needs Rescan', color: 'caution', explanation: 'The save structure changed after a game update.' },
  BROKEN:       { label: 'Broken',       color: 'risky',   explanation: 'Target file not found or inaccessible.' },
  BLOCKED:      { label: 'Blocked',      color: 'blocked', explanation: 'This target is protected and cannot be edited safely.' },
  APPLYING:     { label: 'Applying…',    color: 'info',    explanation: 'Writing change atomically. Do not close.' },
  APPLIED:      { label: 'Applied ✓',    color: 'safe',    explanation: 'Change applied. Backup created.' },
  RESTORED:     { label: 'Restored ✓',   color: 'safe',    explanation: 'Original value restored from backup.' },
  FAILED:       { label: 'Failed',       color: 'risky',   explanation: 'Apply failed. Original file is unchanged.' },
};

interface TrainerCardProps {
  item: TrainerItem;
  state: TrainerCardState;
  value: any;
  selected: boolean;
  onSelect: () => void;
  onValueChange: (val: any) => void;
  onApply: () => void;
}

export const TrainerCard: React.FC<TrainerCardProps> = ({
  item, state, value, selected, onSelect, onValueChange, onApply
}) => {
  const stateInfo = STATE_CONFIG[state];
  const isBlocked = state === 'BLOCKED' || state === 'BROKEN';
  const isDisabled = isBlocked || state === 'APPLYING' || state === 'GAME_RUNNING';
  const inputType = item.inputType ?? 'number';

  const renderControl = () => {
    if (isBlocked) return null;

    switch (inputType) {
      case 'toggle':
        return (
          <label className="trainer-toggle" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={!!value}
              disabled={isDisabled}
              onChange={e => onValueChange(e.target.checked)}
            />
            <span className="toggle-track" />
          </label>
        );

      case 'slider':
        return (
          <div className="trainer-slider-wrap" onClick={e => e.stopPropagation()}>
            <input
              type="range"
              min={item.min ?? 0}
              max={item.max ?? 100}
              value={value ?? item.min ?? 0}
              disabled={isDisabled}
              onChange={e => onValueChange(Number(e.target.value))}
              className="trainer-slider"
            />
            <span className="slider-val">{value ?? 0}</span>
          </div>
        );

      case 'dropdown':
        return (
          <select
            value={value ?? ''}
            disabled={isDisabled}
            onChange={e => onValueChange(e.target.value)}
            className="trainer-select"
            onClick={e => e.stopPropagation()}
          >
            {(item.options ?? []).map(opt => (
              <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
            ))}
          </select>
        );

      default:
        return (
          <input
            type="number"
            className="trainer-input"
            value={value ?? ''}
            min={item.min}
            max={item.max}
            placeholder="New value…"
            disabled={isDisabled}
            onChange={e => onValueChange(Number(e.target.value))}
            onClick={e => e.stopPropagation()}
          />
        );
    }
  };

  return (
    <div
      className={`trainer-card-v2 state-${state.toLowerCase().replace(/_/g, '-')} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      role="button"
      aria-pressed={selected}
      aria-label={`${item.name} — ${stateInfo.label}`}
    >
      <div className="tc-header">
        <div className="tc-badges">
          <span className="tc-category">{item.category}</span>
          <span className={`tc-state-badge tc-state-${stateInfo.color}`}>{stateInfo.label}</span>
        </div>
        <h4 className="tc-name">{item.name}</h4>
        <span className={`tc-risk risk-chip risk-${item.risk.toLowerCase()}`}>{item.risk}</span>
      </div>

      {stateInfo.explanation && (
        <p className="tc-state-msg">{stateInfo.explanation}</p>
      )}

      <div className="tc-value-row">
        <span className="tc-label">Current</span>
        <strong className="tc-current">
          {item.currentValue !== undefined ? String(item.currentValue) : '—'}
        </strong>
      </div>

      {!isBlocked && (
        <div className="tc-controls" onClick={e => e.stopPropagation()}>
          {renderControl()}
          <button
            className="tc-apply-btn"
            disabled={isDisabled || value === '' || value === undefined || value === null}
            onClick={onApply}
            aria-label={`Apply ${item.name}`}
          >
            {state === 'APPLYING' ? '…' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
};
