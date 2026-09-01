import React, { useEffect, useState } from 'react';

type HistoryEntry = {
  id: number;
  version: number;
  appliedAt: string;
  recordCount: number;
  notice: string;
  status: 'applied' | 'rejected' | 'rolled-back';
  rejectReason?: string;
};

type StateShape = {
  currentVersion: number;
  lastSuccessAt: string | null;
  lastCheckAt: string | null;
  autoUpdateEnabled: boolean;
  bundledSnapshotOnly: boolean;
  artworkNetworkOptOut: boolean;
};

export const CatalogUpdatesSection: React.FC = () => {
  const [state, setState] = useState<StateShape | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const result = await window.electronAPI.catalogUpdatesStatus();
    if (result.success && result.state) {
      setState(result.state);
      setHistory(result.history ?? []);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setPreference = async (patch: Partial<StateShape>) => {
    setError('');
    const result = await window.electronAPI.catalogUpdatesSetPreference(patch);
    if (!result.success) {
      setError(result.error ?? 'Could not update the setting.');
      return;
    }
    await load();
  };

  const handleImport = async () => {
    setError('');
    setMessage('');
    const result = await window.electronAPI.catalogUpdatesImport();
    if (result.canceled) return;
    if (!result.success) {
      setError(result.result?.rejectReason ?? result.error ?? 'Import failed.');
      await load();
      return;
    }
    setMessage(`Catalog updated to version ${result.result?.version} — ${result.result?.recordCount} record(s) applied.`);
    await load();
  };

  const handleRollback = async () => {
    setError('');
    setMessage('');
    const result = await window.electronAPI.catalogUpdatesRollbackLast();
    if (!result.success) {
      setError(result.error ?? 'Rollback failed.');
      return;
    }
    setMessage(`Rolled back — ${result.restoredCount ?? 0} record(s) restored.`);
    await load();
  };

  if (!state) return <div className="settings-section" />;

  const latestApplied = history.find((h) => h.status === 'applied' && h.version === state.currentVersion);

  return (
    <div className="settings-section">
      <p className="settings-field-hint">
        The Trainer Library catalog can grow through small, cryptographically signed updates instead of a full app
        update. Solith always keeps its bundled offline catalog available — updates only add to it, and a bad update
        can be rolled back.
      </p>

      <div className="settings-field">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={state.autoUpdateEnabled}
            onChange={(e) => void setPreference({ autoUpdateEnabled: e.target.checked })}
          />
          Automatically check for catalog updates
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={state.bundledSnapshotOnly}
            onChange={(e) => void setPreference({ bundledSnapshotOnly: e.target.checked })}
          />
          Use bundled snapshot only (never apply signed catalog updates)
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={state.artworkNetworkOptOut}
            onChange={(e) => void setPreference({ artworkNetworkOptOut: e.target.checked })}
          />
          Opt out of artwork network fetches (separate from catalog updates)
        </label>
      </div>

      <div className="settings-field">
        <p className="settings-field-hint">
          Current catalog version: {state.currentVersion}
          {' — '}
          Last successful update: {state.lastSuccessAt ?? 'never'}
        </p>
      </div>

      <div className="settings-field settings-actions">
        <button type="button" onClick={() => void handleImport()}>
          Check now (import signed update…)
        </button>
        <button type="button" onClick={() => void handleRollback()} disabled={!latestApplied}>
          Roll back last update
        </button>
      </div>

      {message && <p className="settings-field-hint">{message}</p>}
      {error && <p className="settings-field-hint">{error}</p>}

      {history.length > 0 && (
        <div className="settings-field">
          <p className="settings-field__label">History</p>
          <table className="settings-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Applied</th>
                <th>Records</th>
                <th>Status</th>
                <th>Notice</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.version}</td>
                  <td>{h.appliedAt}</td>
                  <td>{h.recordCount}</td>
                  <td>{h.status}{h.rejectReason ? ` — ${h.rejectReason}` : ''}</td>
                  <td>{h.notice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CatalogUpdatesSection;
