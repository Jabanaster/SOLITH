/**
 * TrainerControlPanel — Milestone H
 *
 * Displays trainer controls loaded from game profiles.
 * Controls are now data-driven, loaded from profile JSON files instead of hardcoded.
 *
 * Only controls with backend='save_field' and safetyStatus='requires_approval'
 * or 'supported' can be executed; all others are shown in a disabled/future state.
 *
 * Workflow:
 *   proposeWrite → show diff/confirmation → approveAndWrite → verify → offer rollback
 *
 * Milestone H refactor: controls are now loaded from src/core/game-profiles/profiles/stardew-valley.json
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  TrainerControl,
  ControlSafetyStatus,
} from '../../core/trainer-host/trainer-control-schema.js';
import {
  isControlExecutable,
  requiresApproval,
  BACKEND_LABELS,
  SAFETY_STATUS_LABELS,
} from '../../core/trainer-host/trainer-control-schema.js';
import type { GameProfile } from '../../core/game-profiles/types.js';
import { validateGameProfile } from '../../core/game-profiles/types.js';
import { loadTrainerControls } from '../../core/game-profiles/transform.js';
// Renderer-safe: import the profile as data (bundled by Vite). We must NOT import
// the fs-backed loader here, or Node built-ins get pulled into the browser bundle.
import stardewProfileData from '../../core/game-profiles/profiles/stardew-valley.json';
import { SAVE_EDIT_RISK_COPY } from '../save-edit-risk-labels.js';

// ── Profile-driven control loading ───────────────────────────────────────────

/**
 * Loads trainer controls from the Stardew Valley game profile.
 * Replaces the hardcoded buildControls() from Milestone G.
 *
 * The profile is validated at build/runtime; an invalid profile yields no
 * controls rather than rendering an unsafe/partial panel.
 */
export function buildControls(): TrainerControl[] {
  const profile = stardewProfileData as GameProfile;
  const errors = validateGameProfile(profile);
  if (errors.length > 0) {
    console.error('Stardew profile failed validation:', errors);
    return [];
  }
  return loadTrainerControls(profile);
}

// Note: The rest of the panel implementation below remains unchanged.
// Controls are now loaded from profile but the UI behavior is identical:
//   - Money, Stamina, Farming XP are executable through save-backed workflow
//   - Disabled/future controls cannot execute
//   - Approval workflow enforced
//   - Rollback available after successful write
//   - Companion files remain untouched

// ── Per-control state ─────────────────────────────────────────────────────────

type ControlPhase =
  | 'idle'
  | 'reading'
  | 'proposing'
  | 'awaiting_approval'
  | 'writing'
  | 'applied'
  | 'rolling_back'
  | 'rolled_back'
  | 'error';

interface ControlState {
  phase: ControlPhase;
  currentValue?: string;
  proposalId?: string;
  proposedNewValue?: string;
  backupPath?: string;
  message?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safetyStatusColor(status: ControlSafetyStatus): string {
  switch (status) {
    case 'supported':          return 'safe';
    case 'requires_approval':  return 'caution';
    case 'rollback_available': return 'info';
    case 'disabled':           return 'muted';
    case 'future_feature':     return 'muted';
    default:                   return 'muted';
  }
}

const api = () => (window as any).electronAPI as Record<string, (...args: any[]) => Promise<any>> | undefined;

// ── ControlRow ────────────────────────────────────────────────────────────────

interface ControlRowProps {
  control: TrainerControl;
  state: ControlState;
  inputValue: string;
  onInputChange: (v: string) => void;
  onPropose: () => void;
  onApprove: () => void;
  onCancelProposal: () => void;
  onRollback: () => void;
}

const ControlRow: React.FC<ControlRowProps> = ({
  control, state, inputValue, onInputChange,
  onPropose, onApprove, onCancelProposal, onRollback,
}) => {
  const executable = isControlExecutable(control);
  const needsApproval = requiresApproval(control);
  const riskCopy = executable ? SAVE_EDIT_RISK_COPY.executable : SAVE_EDIT_RISK_COPY.blocked;
  const backendLabel = BACKEND_LABELS[control.backend];
  const statusLabel = SAFETY_STATUS_LABELS[
    state.phase === 'applied' && state.backupPath ? 'rollback_available' : control.safetyStatus
  ];
  const statusColor = safetyStatusColor(
    state.phase === 'applied' && state.backupPath ? 'rollback_available' : control.safetyStatus
  );

  const isBusy = state.phase === 'reading' || state.phase === 'proposing' ||
                 state.phase === 'writing' || state.phase === 'rolling_back';

  return (
    <div
      className={`trainer-control-row backend-${control.backend.replace(/_/g, '-')} phase-${state.phase}`}
      data-testid={`control-${control.id}`}
      aria-label={`${control.label} — ${statusLabel}`}
    >
      <div className="tcr-header">
        <div className="tcr-meta">
          <span className="tcr-category">{control.category}</span>
          <span className={`tcr-status-badge status-${statusColor}`}
                data-testid={`status-${control.id}`}>
            {statusLabel}
          </span>
          <span className={`tcr-status-badge status-${executable ? 'caution' : 'muted'}`}
                data-testid={`edit-state-${control.id}`}>
            {riskCopy.label}
          </span>
          <span className="tcr-backend" data-testid={`backend-${control.id}`}>
            {backendLabel}
          </span>
        </div>
        <h4 className="tcr-label">{control.label}</h4>
        <p className="tcr-description">{control.description}</p>
      </div>

      {state.message && (
        <p className={`tcr-message ${state.phase === 'error' ? 'tcr-error' : 'tcr-info'}`}
           data-testid={`message-${control.id}`}>
          {state.message}
        </p>
      )}

      <p className="tcr-message tcr-info" data-testid={`edit-state-message-${control.id}`}>
        {riskCopy.label}: {riskCopy.detail}
      </p>

      {state.currentValue !== undefined && (
        <div className="tcr-current-row">
          <span className="tcr-field-label">Current</span>
          <strong className="tcr-current-value" data-testid={`current-${control.id}`}>
            {state.currentValue}
          </strong>
        </div>
      )}

      {/* Awaiting approval: show diff + approve/cancel */}
      {state.phase === 'awaiting_approval' && (
        <div className="tcr-proposal-box" data-testid={`proposal-${control.id}`}>
          <p className="tcr-proposal-label">Executable XML save-field write — review proposal, approve explicitly, then write with backup:</p>
          <div className="tcr-diff">
            <span className="diff-old">{state.currentValue ?? '?'}</span>
            <span className="diff-arrow">→</span>
            <span className="diff-new">{state.proposedNewValue}</span>
          </div>
          <div className="tcr-proposal-actions">
            <button
              className="tcr-btn tcr-btn-approve"
              onClick={onApprove}
              data-testid={`approve-btn-${control.id}`}
            >
              Approve & Write
            </button>
            <button
              className="tcr-btn tcr-btn-cancel"
              onClick={onCancelProposal}
              data-testid={`cancel-btn-${control.id}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rollback available after successful write */}
      {state.phase === 'applied' && state.backupPath && (
        <div className="tcr-rollback-row" data-testid={`rollback-area-${control.id}`}>
          <button
            className="tcr-btn tcr-btn-rollback"
            onClick={onRollback}
            disabled={isBusy}
            data-testid={`rollback-btn-${control.id}`}
          >
            Rollback
          </button>
        </div>
      )}

      {/* Input + propose button for executable controls in idle/applied/rolled_back state */}
      {executable && ['idle', 'applied', 'rolled_back', 'error'].includes(state.phase) && (
        <div className="tcr-input-row" onClick={e => e.stopPropagation()}>
          {control.controlType === 'number_input' && (
            <input
              type="number"
              className="tcr-number-input"
              value={inputValue}
              min={control.min}
              max={control.max}
              placeholder="New value…"
              disabled={isBusy}
              onChange={e => onInputChange(e.target.value)}
              data-testid={`input-${control.id}`}
            />
          )}
          {control.controlType === 'slider' && (
            <input
              type="range"
              className="tcr-slider"
              value={inputValue}
              min={control.min ?? 0}
              max={control.max ?? 100}
              step={control.step ?? 1}
              disabled={isBusy}
              onChange={e => onInputChange(e.target.value)}
              data-testid={`input-${control.id}`}
            />
          )}
          <button
            className="tcr-btn tcr-btn-propose"
            disabled={isBusy || !inputValue}
            onClick={onPropose}
            data-testid={`propose-btn-${control.id}`}
          >
            {needsApproval ? (isBusy ? '…' : 'Propose') : (isBusy ? '…' : 'Apply')}
          </button>
        </div>
      )}

      {/* Non-executable: show reason */}
      {!executable && (
        <div className="tcr-disabled-note" data-testid={`disabled-note-${control.id}`}>
          {control.safetyStatus === 'future_feature'
            ? 'Not yet implemented — planned for a future milestone.'
            : 'Blocked: this control is currently disabled and cannot execute writes.'}
        </div>
      )}
    </div>
  );
};

// ── TrainerControlPanel ───────────────────────────────────────────────────────

interface TrainerControlPanelProps {
  /** If provided, auto-start the TrainerHost when mounted. */
  autoStart?: boolean;
}

const TrainerControlPanel: React.FC<TrainerControlPanelProps> = ({ autoStart = false }) => {
  const controls = buildControls();
  const [hostRunning, setHostRunning] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [controlStates, setControlStates] = useState<Record<string, ControlState>>(
    () => Object.fromEntries(controls.map(c => [c.id, { phase: 'idle' }]))
  );
  const [inputValues, setInputValues] = useState<Record<string, string>>(
    () => Object.fromEntries(controls.map(c => [c.id, '']))
  );

  const electronAPI = api();

  const setControlState = useCallback((id: string, update: Partial<ControlState>) => {
    setControlStates(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }, []);

  // Start host on mount if requested
  useEffect(() => {
    if (!autoStart || !electronAPI) return;
    setHostBusy(true);
    electronAPI.trainerHostStart()
      .then((res: any) => setHostRunning(res?.success !== false))
      .catch(() => {})
      .finally(() => setHostBusy(false));
  }, [autoStart, electronAPI]);

  const handleStartHost = async () => {
    if (!electronAPI) return;
    setHostBusy(true);
    try {
      const res = await electronAPI.trainerHostStart();
      setHostRunning(res?.success !== false);
    } finally {
      setHostBusy(false);
    }
  };

  const handleStopHost = async () => {
    if (!electronAPI) return;
    setHostBusy(true);
    try {
      await electronAPI.trainerHostStop();
      setHostRunning(false);
    } finally {
      setHostBusy(false);
    }
  };

  const handleReadCurrent = useCallback(async (control: TrainerControl) => {
    if (!electronAPI || !control.saveField) return;
    setControlState(control.id, { phase: 'reading', message: undefined });
    try {
      const res = await electronAPI.trainerHostReadField({
        gameId: control.saveField.gameId,
        filePath: control.saveField.filePath,
        field: control.saveField.fieldPath,
      });
      if (res?.success !== false && res?.value !== undefined) {
        setControlState(control.id, { phase: 'idle', currentValue: String(res.value) });
      } else {
        setControlState(control.id, { phase: 'error', message: res?.error ?? 'Read failed' });
      }
    } catch (e) {
      setControlState(control.id, { phase: 'error', message: String(e) });
    }
  }, [electronAPI, setControlState]);

  const handlePropose = useCallback(async (control: TrainerControl, newValue: string) => {
    if (!electronAPI || !control.saveField) return;
    const current = controlStates[control.id]?.currentValue;
    if (!current) {
      setControlState(control.id, { phase: 'error', message: 'Read the current value first.' });
      return;
    }
    setControlState(control.id, { phase: 'proposing', message: undefined });
    try {
      const res = await electronAPI.trainerHostProposeWrite({
        gameId: control.saveField.gameId,
        filePath: control.saveField.filePath,
        field: control.saveField.fieldPath,
        currentValue: current,
        newValue,
      });
      if (res?.success) {
        setControlState(control.id, {
          phase: 'awaiting_approval',
          proposalId: res.proposalId,
          proposedNewValue: newValue,
          message: undefined,
        });
      } else {
        setControlState(control.id, { phase: 'error', message: res?.error ?? 'Proposal failed' });
      }
    } catch (e) {
      setControlState(control.id, { phase: 'error', message: String(e) });
    }
  }, [electronAPI, controlStates, setControlState]);

  const handleApprove = useCallback(async (control: TrainerControl) => {
    const cs = controlStates[control.id];
    if (!electronAPI || !cs?.proposalId) return;
    setControlState(control.id, { phase: 'writing', message: undefined });
    try {
      const res = await electronAPI.trainerHostApproveAndWrite({ proposalId: cs.proposalId });
      if (res?.success) {
        const ts = new Date().toLocaleTimeString();
        setControlState(control.id, {
          phase: 'applied',
          currentValue: res.verifiedValue,
          backupPath: res.backupPath,
          proposalId: undefined,
          proposedNewValue: undefined,
          message: `Written at ${ts}. Backup created.`,
        });
      } else {
        setControlState(control.id, { phase: 'error', message: res?.error ?? 'Write failed' });
      }
    } catch (e) {
      setControlState(control.id, { phase: 'error', message: String(e) });
    }
  }, [electronAPI, controlStates, setControlState]);

  const handleCancelProposal = useCallback((control: TrainerControl) => {
    setControlState(control.id, {
      phase: 'idle',
      proposalId: undefined,
      proposedNewValue: undefined,
      message: 'Proposal cancelled.',
    });
  }, [setControlState]);

  const handleRollback = useCallback(async (control: TrainerControl) => {
    const cs = controlStates[control.id];
    if (!electronAPI || !control.saveField || !cs?.backupPath) return;
    setControlState(control.id, { phase: 'rolling_back', message: undefined });
    try {
      const res = await electronAPI.trainerHostRollback({
        gameId: control.saveField.gameId,
        filePath: control.saveField.filePath,
        backupPath: cs.backupPath,
        field: control.saveField.fieldPath,
      });
      if (res?.success) {
        const ts = new Date().toLocaleTimeString();
        setControlState(control.id, {
          phase: 'rolled_back',
          currentValue: res.verifiedValue,
          backupPath: undefined,
          message: `Rolled back at ${ts}. Original value restored.`,
        });
      } else {
        setControlState(control.id, { phase: 'error', message: res?.error ?? 'Rollback failed' });
      }
    } catch (e) {
      setControlState(control.id, { phase: 'error', message: String(e) });
    }
  }, [electronAPI, controlStates, setControlState]);

  if (!electronAPI) {
    return (
      <div className="trainer-control-panel trainer-no-api">
        <div className="no-api-box glass">
          <h3>Read-Only Preview</h3>
          <p>ResourceForge must run inside Electron to use trainer controls.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="trainer-control-panel" data-testid="trainer-control-panel">
      <div className="tcp-host-bar">
        <span className={`tcp-host-status ${hostRunning ? 'host-running' : 'host-stopped'}`}
              data-testid="host-status">
          TrainerHost: {hostRunning ? 'Running' : 'Stopped'}
        </span>
        {!hostRunning ? (
          <button className="tcr-btn tcr-btn-host" onClick={handleStartHost} disabled={hostBusy}
                  data-testid="start-host-btn">
            {hostBusy ? 'Starting…' : 'Start Host'}
          </button>
        ) : (
          <button className="tcr-btn tcr-btn-host-stop" onClick={handleStopHost} disabled={hostBusy}
                  data-testid="stop-host-btn">
            {hostBusy ? 'Stopping…' : 'Stop Host'}
          </button>
        )}
      </div>

      <div className="tcp-controls-list" data-testid="controls-list">
        {controls.map(control => {
          const cs = controlStates[control.id];
          const executable = isControlExecutable(control);
          return (
            <div key={control.id} className="tcp-control-wrapper">
              {executable && cs.phase === 'idle' && cs.currentValue === undefined && hostRunning && (
                <button
                  className="tcr-btn tcr-btn-read"
                  onClick={() => handleReadCurrent(control)}
                  data-testid={`read-btn-${control.id}`}
                >
                  Read Current
                </button>
              )}
              <ControlRow
                control={control}
                state={cs}
                inputValue={inputValues[control.id] ?? ''}
                onInputChange={v => setInputValues(prev => ({ ...prev, [control.id]: v }))}
                onPropose={() => handlePropose(control, inputValues[control.id] ?? '')}
                onApprove={() => handleApprove(control)}
                onCancelProposal={() => handleCancelProposal(control)}
                onRollback={() => handleRollback(control)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TrainerControlPanel;
// buildControls is already exported near the top of the file (line 35)
