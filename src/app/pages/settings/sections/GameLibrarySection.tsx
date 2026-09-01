import React, { useState } from 'react';

const GAME_LIBRARY_VIEW_KEY = 'solith-game-library-view';

function readDefaultView(): 'installed' | 'all' | 'owned' {
  try {
    const saved = localStorage.getItem(GAME_LIBRARY_VIEW_KEY);
    if (saved === 'installed' || saved === 'all' || saved === 'owned') return saved;
  } catch {
    // ignore — no localStorage access
  }
  return 'installed';
}

export const GameLibrarySection: React.FC = () => {
  const [defaultView, setDefaultView] = useState<'installed' | 'all' | 'owned'>(readDefaultView);
  const [rescanStatus, setRescanStatus] = useState<string>('');
  const [rescanning, setRescanning] = useState(false);

  const handleDefaultViewChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as 'installed' | 'all' | 'owned';
    setDefaultView(value);
    try {
      localStorage.setItem(GAME_LIBRARY_VIEW_KEY, value);
    } catch {
      // ignore — no localStorage access
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    setRescanStatus('');
    try {
      const result = await window.electronAPI.installDiscoveryScan();
      if (result.success) {
        setRescanStatus(`Rescanned. Discovered ${result.discovered ?? 0}, matched ${result.matched ?? 0}.`);
      } else {
        setRescanStatus(result.error ?? 'Rescan failed.');
      }
    } catch (err) {
      setRescanStatus(err instanceof Error ? err.message : 'Rescan failed.');
    } finally {
      setRescanning(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label htmlFor="game-library-default-view">Default view</label>
        <select id="game-library-default-view" value={defaultView} onChange={handleDefaultViewChange}>
          <option value="installed">Installed</option>
          <option value="all">All</option>
          <option value="owned">Owned</option>
        </select>
        <p className="settings-field-hint">Which tab the Game Library opens to. Installed is recommended.</p>
      </div>

      <div className="settings-field">
        <button type="button" className="btn-secondary" onClick={() => void handleRescan()} disabled={rescanning}>
          {rescanning ? 'Rescanning…' : 'Rescan installed games'}
        </button>
        {rescanStatus && <p className="settings-field-hint">{rescanStatus}</p>}
      </div>

      <div className="settings-field">
        <p className="settings-field-hint">
          To add a game manually or scan a specific folder, use the "Add Game Manually" action on the Game Library page.
        </p>
      </div>
    </div>
  );
};

export default GameLibrarySection;
