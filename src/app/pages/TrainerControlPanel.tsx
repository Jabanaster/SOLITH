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
 * Milestone H/J: default controls load from schema.v1 via buildControls() (Phase 4).
 * Former game-profiles/stardew-valley.json deleted.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
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
import { SAVE_EDIT_RISK_COPY } from '../save-edit-risk-labels.js';
import {
  LOCAL_ONLY_SAFETY_MESSAGE,
  localTrainerServiceFailureMessage,
  operationFailedBeforeWriteMessage,
  userSafeErrorDetail,
} from '../reliability-messages.js';

// ── Profile-driven control loading ───────────────────────────────────────────

import { buildControls } from './trainer-control-panel-build.js';
import { resolveCatalogControlFilePath } from '../../core/definitions/definition-to-trainer-controls.js';

export { buildControls };

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

function categoryGroupLabel(category: string): string {
  const c = category.toUpperCase();
  if (c.includes('CURRENCY') || c.includes('RESOURCE') || c.includes('MONEY')) return 'Resources';
  if (c.includes('STAMINA') || c.includes('HEALTH') || c.includes('STAT')) return 'Player Stats';
  if (c.includes('SKILL') || c.includes('XP')) return 'Skills';
  return category.replace(/_/g, ' ');
}

function groupControls(controls: TrainerControl[]): Array<{ title: string; items: TrainerControl[] }> {
  const map = new Map<string, TrainerControl[]>();
  for (const control of controls) {
    const title = categoryGroupLabel(control.category);
    const list = map.get(title) ?? [];
    list.push(control);
    map.set(title, list);
  }
  const order = ['Resources', 'Player Stats', 'Skills'];
  return [...map.entries()]
    .sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([title, items]) => ({ title, items }));
}

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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
      className="trainer-control-card"
      data-testid={`control-${control.id}`}
      aria-label={`${control.label} — ${statusLabel}`}
    >
      <div className="tcr-header">
        <h4 className="tcr-label">{control.label}</h4>
        <p className="tcr-description">{control.description}</p>
        <div className="tcr-badges">
          <span className="tcr-status-badge status-info">Save-backed</span>
          {executable && needsApproval && (
            <span className="tcr-status-badge status-caution">Approval required</span>
          )}
          {(state.phase === 'applied' && state.backupPath) && (
            <span className="tcr-status-badge status-safe">Rollback available</span>
          )}
          <span className={`tcr-status-badge status-${statusColor}`} data-testid={`status-${control.id}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {state.message && (
        <p className={`tcr-message ${state.phase === 'error' ? 'tcr-error' : 'tcr-info'}`}
           data-testid={`message-${control.id}`}>
          {state.message}
        </p>
      )}

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
          <div className="tcr-diff">
            <span className="diff-old">{state.currentValue ?? '?'}</span>
            <span className="diff-arrow">→</span>
            <span className="diff-new">{state.proposedNewValue}</span>
          </div>
          <div className="tcr-proposal-actions">
            <button className="tcr-btn tcr-btn-approve" onClick={onApprove} data-testid={`approve-btn-${control.id}`}>
              Approve & Write
            </button>
            <button className="tcr-btn tcr-btn-cancel" onClick={onCancelProposal} data-testid={`cancel-btn-${control.id}`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rollback available after successful write */}
      {state.phase === 'applied' && state.backupPath && (
        <div className="tcr-rollback-row" data-testid={`rollback-area-${control.id}`}>
          <button className="tcr-btn tcr-btn-rollback" onClick={onRollback} disabled={isBusy} data-testid={`rollback-btn-${control.id}`}>
            Restore
          </button>
        </div>
      )}

      {executable && ['idle', 'applied', 'rolled_back', 'error'].includes(state.phase) && (
        <div className="tcr-input-row" onClick={e => e.stopPropagation()}>
          {control.controlType === 'number_input' && (
            <input
              type="number"
              className="tcr-number-input"
              value={inputValue}
              min={control.min}
              max={control.max}
              placeholder="Enter new value"
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
          <button type="button" className="tcr-btn tcr-btn-details" onClick={() => setDetailsOpen((v) => !v)}>
            Details
          </button>
        </div>
      )}

      {!executable && (
        <div className="tcr-disabled-note" data-testid={`disabled-note-${control.id}`}>
          {control.safetyStatus === 'future_feature'
            ? 'Not yet implemented — planned for a future milestone.'
            : 'Blocked: this control cannot execute writes in the current build.'}
        </div>
      )}

      {detailsOpen && (
        <div className="tcr-details-panel" data-testid={`details-${control.id}`}>
          <dl>
            <dt>Write method</dt><dd>{backendLabel}</dd>
            <dt>Edit state</dt><dd>{riskCopy.label} — {riskCopy.detail}</dd>
            <dt>Workflow</dt><dd>Backup before write; rollback after successful supported write</dd>
            <dt>Formats</dt><dd>XML, JSON, INI (save-backed)</dd>
          </dl>
        </div>
      )}
    </div>
  );
};

// ── TrainerControlPanel ───────────────────────────────────────────────────────

interface TrainerControlPanelProps {
  /** If provided, auto-start the TrainerHost when mounted. */
  autoStart?: boolean;
  /** When set, uses catalog/imported save-field controls instead of the bundled Stardew profile. */
  controls?: TrainerControl[];
  panelTitle?: string;
  saveFilePath?: string;
  saveDirectoryHint?: string;
  onSaveFilePathChange?: (path: string) => void;
  onApproveSavePath?: () => void | Promise<void>;
}

const TrainerControlPanel: React.FC<TrainerControlPanelProps> = ({
  autoStart = false,
  controls: controlsProp,
  panelTitle,
  saveFilePath = '',
  saveDirectoryHint,
  onSaveFilePathChange,
  onApproveSavePath,
}) => {
  const baseControls = controlsProp ?? buildControls();
  const controls = baseControls;

  const resolveControl = useCallback(
    (control: TrainerControl) => {
      if (!controlsProp || !saveFilePath.trim()) return control;
      return resolveCatalogControlFilePath(control, saveFilePath.trim());
    },
    [controlsProp, saveFilePath],
  );
  const [hostRunning, setHostRunning] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [controlStates, setControlStates] = useState<Record<string, ControlState>>(
    () => Object.fromEntries(controls.map(c => [c.id, { phase: 'idle' }]))
  );
  const [inputValues, setInputValues] = useState<Record<string, string>>(
    () => Object.fromEntries(controls.map(c => [c.id, '']))
  );
  const [hostMessage, setHostMessage] = useState('');

  const electronAPI = api();

  const setControlState = useCallback((id: string, update: Partial<ControlState>) => {
    setControlStates(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }, []);

  // Start host on mount if requested
  useEffect(() => {
    if (!autoStart || !electronAPI) return;
    setHostBusy(true);
    electronAPI.trainerHostStart()
      .then((res: any) => {
        const running = res?.success !== false;
        setHostRunning(running);
        setHostMessage(running ? '' : localTrainerServiceFailureMessage());
      })
      .catch(() => {
        setHostRunning(false);
        setHostMessage(localTrainerServiceFailureMessage());
      })
      .finally(() => setHostBusy(false));
  }, [autoStart, electronAPI]);

  const handleStartHost = async () => {
    if (!electronAPI) return;
    setHostBusy(true);
    try {
      const res = await electronAPI.trainerHostStart();
      const running = res?.success !== false;
      setHostRunning(running);
      setHostMessage(running ? '' : localTrainerServiceFailureMessage());
    } catch {
      setHostRunning(false);
      setHostMessage(localTrainerServiceFailureMessage());
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
      setHostMessage('');
    } finally {
      setHostBusy(false);
    }
  };

  const handleReadCurrent = useCallback(async (control: TrainerControl) => {
    const resolved = resolveControl(control);
    if (!electronAPI || !resolved.saveField) return;
    setControlState(control.id, { phase: 'reading', message: undefined });
    try {
      const res = await electronAPI.trainerHostReadField({
        gameId: resolved.saveField.gameId,
        filePath: resolved.saveField.filePath,
        field: resolved.saveField.fieldPath,
      });
      if (res?.success !== false && res?.value !== undefined) {
        setControlState(control.id, { phase: 'idle', currentValue: String(res.value) });
      } else {
        setControlState(control.id, { phase: 'error', message: localTrainerServiceFailureMessage() });
      }
    } catch (e) {
      console.error('[TrainerControlPanel] read failed:', userSafeErrorDetail(e));
      setControlState(control.id, { phase: 'error', message: localTrainerServiceFailureMessage() });
    }
  }, [electronAPI, setControlState, resolveControl]);

  const handlePropose = useCallback(async (control: TrainerControl, newValue: string) => {
    const resolved = resolveControl(control);
    if (!electronAPI || !resolved.saveField) return;
    const current = controlStates[control.id]?.currentValue;
    if (!current) {
      setControlState(control.id, { phase: 'error', message: 'Read the current value first.' });
      return;
    }
    setControlState(control.id, { phase: 'proposing', message: undefined });
    try {
      const res = await electronAPI.trainerHostProposeWrite({
        gameId: resolved.saveField.gameId,
        filePath: resolved.saveField.filePath,
        field: resolved.saveField.fieldPath,
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
        setControlState(control.id, { phase: 'error', message: operationFailedBeforeWriteMessage() });
      }
    } catch (e) {
      console.error('[TrainerControlPanel] propose failed:', userSafeErrorDetail(e));
      setControlState(control.id, { phase: 'error', message: operationFailedBeforeWriteMessage() });
    }
  }, [electronAPI, controlStates, setControlState, resolveControl]);

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
        setControlState(control.id, { phase: 'error', message: operationFailedBeforeWriteMessage() });
      }
    } catch (e) {
      console.error('[TrainerControlPanel] write failed:', userSafeErrorDetail(e));
      setControlState(control.id, { phase: 'error', message: operationFailedBeforeWriteMessage() });
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
    const resolved = resolveControl(control);
    if (!electronAPI || !resolved.saveField || !cs?.backupPath) return;
    setControlState(control.id, { phase: 'rolling_back', message: undefined });
    try {
      const res = await electronAPI.trainerHostRollback({
        gameId: resolved.saveField.gameId,
        filePath: resolved.saveField.filePath,
        backupPath: cs.backupPath,
        field: resolved.saveField.fieldPath,
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
        setControlState(control.id, { phase: 'error', message: operationFailedBeforeWriteMessage() });
      }
    } catch (e) {
      console.error('[TrainerControlPanel] rollback failed:', userSafeErrorDetail(e));
      setControlState(control.id, { phase: 'error', message: operationFailedBeforeWriteMessage() });
    }
  }, [electronAPI, controlStates, setControlState, resolveControl]);

  const grouped = useMemo(() => groupControls(controls), [controls]);
  const writableCount = controls.filter(isControlExecutable).length;

  if (!electronAPI) {
    return (
      <div className="trainer-control-panel trainer-no-api">
        <div className="no-api-box glass">
          <h3>Read-Only Preview</h3>
          <p>Solith must run inside Electron to use trainer controls.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="trainer-control-panel content-panel" data-testid="trainer-control-panel">
      <PageModuleHeader
        artwork="saveTools"
        title={panelTitle ?? 'Trainer Controls'}
        description="Save-backed trainer controls loaded from verified game profiles."
        actions={
          <div className="save-editor-toolbar">
            {!hostRunning ? (
              <button className="tcr-btn tcr-btn-host" onClick={handleStartHost} disabled={hostBusy} data-testid="start-host-btn">
                {hostBusy ? 'Starting…' : 'Start Host'}
              </button>
            ) : (
              <button className="tcr-btn tcr-btn-host-stop" onClick={handleStopHost} disabled={hostBusy} data-testid="stop-host-btn">
                {hostBusy ? 'Stopping…' : 'Stop Host'}
              </button>
            )}
          </div>
        }
      />

      <div className="tcp-summary-strip glass" data-testid="trainer-summary-strip">
        <span><strong>Profile</strong> {controlsProp ? 'Catalog' : 'Stardew Valley'}</span>
        <span><strong>Fields</strong> {controls.length}</span>
        <span><strong>Writable</strong> {writableCount}</span>
        <span><strong>Backup</strong> Ready</span>
        <span><strong>TrainerHost</strong> {hostRunning ? 'Running' : 'Stopped'}</span>
      </div>
      {saveDirectoryHint && onSaveFilePathChange && (
        <div className="tcp-save-file-bar" data-testid="catalog-save-file-bar">
          <label htmlFor="catalog-save-file-path">
            Save file path
            <span className="tcp-save-hint">Expected near: {saveDirectoryHint}</span>
          </label>
          <div className="tcp-save-file-row">
            <input
              id="catalog-save-file-path"
              type="text"
              value={saveFilePath}
              onChange={(e) => onSaveFilePathChange(e.target.value)}
              placeholder="C:\Users\you\AppData\Roaming\Game\Saves\slot\save.xml"
            />
            {onApproveSavePath && (
              <button type="button" className="tcr-btn" onClick={() => void onApproveSavePath()} disabled={!saveFilePath.trim()}>
                Approve path
              </button>
            )}
          </div>
        </div>
      )}
      <div className="tcp-host-bar">
        <span className="tcp-local-only-copy" data-testid="trainer-local-only-copy">
          {LOCAL_ONLY_SAFETY_MESSAGE}
        </span>
        {hostMessage && (
          <span className="tcp-host-message" data-testid="host-message">
            {hostMessage}
          </span>
        )}
      </div>

      {grouped.map((section) => (
        <section key={section.title} className="tcp-category-section" aria-label={section.title}>
          <h3 className="tcp-category-title">{section.title}</h3>
          <div className="tcp-controls-list" data-testid="controls-list">
            {section.items.map((control) => {
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
                      Read current
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
        </section>
      ))}
    </div>
  );
};

export default TrainerControlPanel;
// buildControls is already exported near the top of the file (line 35)
