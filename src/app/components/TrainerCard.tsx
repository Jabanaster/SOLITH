import React from 'react';
import {
  OPERATION_FAILED_BEFORE_WRITE_MESSAGE,
  UNSUPPORTED_FORMAT_BLOCKED_MESSAGE,
} from '../reliability-messages.js';
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
  BLOCKED:      { label: 'Blocked',      color: 'blocked', explanation: UNSUPPORTED_FORMAT_BLOCKED_MESSAGE },
  APPLYING:     { label: 'Applying…',    color: 'info',    explanation: 'Writing change atomically. Do not close.' },
  APPLIED:      { label: 'Applied ✓',    color: 'safe',    explanation: 'Change applied. Backup created.' },
  RESTORED:     { label: 'Restored ✓',   color: 'safe',    explanation: 'Original value restored from backup.' },
  FAILED:       { label: 'Failed',       color: 'risky',   explanation: OPERATION_FAILED_BEFORE_WRITE_MESSAGE },
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
  const stateDescriptionId = `trainer-state-${item.id}`;
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
            <label htmlFor={`trainer-slider-${item.id}`} className="tc-label">
              {item.name}
            </label>
            <input
              id={`trainer-slider-${item.id}`}
              type="range"
              min={item.min ?? 0}
              max={item.max ?? 100}
              step={item.step ?? 1}
              value={value ?? item.min ?? 0}
              disabled={isDisabled}
              onChange={e => onValueChange(Number(e.target.value))}
              className="trainer-slider"
              aria-describedby={stateInfo.explanation ? stateDescriptionId : undefined}
            />
            <span className="slider-val">{value ?? 0}{item.unit ? ` ${item.unit}` : ''}</span>
          </div>
        );

      case 'dropdown':
        return (
          <div onClick={e => e.stopPropagation()}>
            <label htmlFor={`trainer-dropdown-${item.id}`} className="tc-label">
              {item.name}
            </label>
            <select
              id={`trainer-dropdown-${item.id}`}
              value={String(value ?? '')}
              disabled={isDisabled}
              onChange={e => onValueChange(e.target.value)}
              className="trainer-select"
              onClick={e => e.stopPropagation()}
              aria-describedby={stateInfo.explanation ? stateDescriptionId : undefined}
            >
              {(item.options ?? []).map(opt => (
                <option key={`${typeof opt.value}:${String(opt.value)}`} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
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
            aria-describedby={stateInfo.explanation ? stateDescriptionId : undefined}
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
        <p className="tc-state-msg" id={stateDescriptionId}>{stateInfo.explanation}</p>
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
            aria-describedby={stateInfo.explanation ? stateDescriptionId : undefined}
          >
            {state === 'APPLYING' ? '…' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
};
