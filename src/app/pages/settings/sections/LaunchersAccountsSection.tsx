import React, { useEffect, useState } from 'react';

type LauncherRow = {
  id: string;
  label: string;
  detected: boolean;
  gamesFound: number;
  connectionSupported: boolean;
};

const LAUNCHER_DEFS: Array<{ id: string; label: string; platformKey?: string; connectionSupported: boolean }> = [
  { id: 'steam', label: 'Steam', platformKey: 'steam', connectionSupported: false },
  { id: 'gog', label: 'GOG', platformKey: 'gog', connectionSupported: false },
  { id: 'epic', label: 'Epic Games Store', platformKey: 'epic', connectionSupported: false },
  { id: 'xbox', label: 'Xbox / Microsoft Store', platformKey: 'xbox', connectionSupported: false },
  { id: 'ubisoft', label: 'Ubisoft Connect', connectionSupported: false },
  { id: 'ea', label: 'EA app', connectionSupported: false },
  { id: 'battlenet', label: 'Battle.net', connectionSupported: false },
  { id: 'standalone', label: 'Standalone', platformKey: 'manual', connectionSupported: false },
];

export const LaunchersAccountsSection: React.FC = () => {
  const [rows, setRows] = useState<LauncherRow[] | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    void loadState();
  }, []);

  const loadState = async () => {
    try {
      const result = await window.electronAPI.installDiscoveryList();
      if (!result.success) {
        setError(result.error ?? 'Could not load launcher state.');
        return;
      }
      const games = result.games ?? [];
      const counts = new Map<string, number>();
      let latest: string | null = null;
      for (const game of games) {
        counts.set(game.platform, (counts.get(game.platform) ?? 0) + 1);
        if (!latest || game.lastSeenAt > latest) latest = game.lastSeenAt;
      }
      setLastScanned(latest);
      setRows(
        LAUNCHER_DEFS.map((def) => ({
          id: def.id,
          label: def.label,
          detected: def.platformKey ? (counts.get(def.platformKey) ?? 0) > 0 : false,
          gamesFound: def.platformKey ? counts.get(def.platformKey) ?? 0 : 0,
          connectionSupported: def.connectionSupported,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load launcher state.');
    }
  };

  return (
    <div className="settings-section">
      <p className="settings-field-hint">
        Solith never asks for launcher account passwords. Detection is local-only, based on install folders and manifests
        already on this machine.
      </p>
      {error && <p className="settings-field-hint">{error}</p>}
      <table className="settings-table">
        <thead>
          <tr>
            <th>Launcher</th>
            <th>Detected</th>
            <th>Connected</th>
            <th>Games found</th>
            <th>Last scanned</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? LAUNCHER_DEFS.map((def) => ({ id: def.id, label: def.label, detected: false, gamesFound: 0, connectionSupported: def.connectionSupported }))).map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              <td>{row.detected ? 'Detected locally' : 'Not detected'}</td>
              <td>{row.connectionSupported ? 'Account connection not implemented' : 'Account connection not supported'}</td>
              <td>{row.gamesFound}</td>
              <td>{row.detected ? (lastScanned ?? 'Unknown') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="settings-field">
        <p className="settings-field-hint">
          Privacy: launcher detection only reads local install manifests (Steam library folders, Epic manifests, GOG
          fixtures). No network requests are made to any launcher's servers.
        </p>
      </div>
    </div>
  );
};

export default LaunchersAccountsSection;
