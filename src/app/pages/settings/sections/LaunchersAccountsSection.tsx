import React, { useEffect, useState } from 'react';

type LauncherRow = {
  id: string;
  label: string;
  detected: boolean;
  manuallyKnown: boolean;
  gamesFound: number;
  connectionSupported: boolean;
  hasScanner: boolean;
};

const LAUNCHER_DEFS: Array<{ id: string; label: string; platformKey?: string; connectionSupported: boolean; hasScanner: boolean }> = [
  { id: 'steam', label: 'Steam', platformKey: 'steam', connectionSupported: false, hasScanner: true },
  { id: 'gog', label: 'GOG', platformKey: 'gog', connectionSupported: false, hasScanner: true },
  { id: 'epic', label: 'Epic Games Store', platformKey: 'epic', connectionSupported: false, hasScanner: true },
  { id: 'xbox', label: 'Xbox / Microsoft Store', platformKey: 'xbox', connectionSupported: false, hasScanner: true },
  { id: 'ubisoft', label: 'Ubisoft Connect', platformKey: 'ubisoft', connectionSupported: false, hasScanner: false },
  { id: 'ea', label: 'EA app', platformKey: 'ea', connectionSupported: false, hasScanner: false },
  { id: 'battlenet', label: 'Battle.net', platformKey: 'battlenet', connectionSupported: false, hasScanner: false },
  { id: 'standalone', label: 'Standalone', platformKey: 'manual', connectionSupported: false, hasScanner: false },
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
      const [discoveryResult, libraryResult] = await Promise.all([
        window.electronAPI.installDiscoveryList(),
        window.electronAPI.listGameLibrary({ view: 'all' }),
      ]);
      if (!discoveryResult.success) {
        setError(discoveryResult.error ?? 'Could not load launcher state.');
        return;
      }
      const scannedGames = discoveryResult.games ?? [];
      const scannedCounts = new Map<string, number>();
      let latest: string | null = null;
      for (const game of scannedGames) {
        scannedCounts.set(game.platform, (scannedCounts.get(game.platform) ?? 0) + 1);
        if (!latest || game.lastSeenAt > latest) latest = game.lastSeenAt;
      }
      setLastScanned(latest);

      // Real known-installation counts per launcher, including manually-added records —
      // this is what makes Ubisoft/EA/Battle.net "Games found" truthful even though no
      // scanner exists for them yet (Step 10).
      const knownCounts = new Map<string, number>();
      if (libraryResult.success) {
        for (const record of libraryResult.records ?? []) {
          for (const installation of record.installations) {
            if (!installation.active) continue;
            knownCounts.set(installation.launcher, (knownCounts.get(installation.launcher) ?? 0) + 1);
          }
        }
      }

      setRows(
        LAUNCHER_DEFS.map((def) => {
          const scannedCount = def.platformKey ? scannedCounts.get(def.platformKey) ?? 0 : 0;
          const knownCount = def.platformKey ? knownCounts.get(def.platformKey) ?? 0 : 0;
          return {
            id: def.id,
            label: def.label,
            detected: def.hasScanner && scannedCount > 0,
            manuallyKnown: !def.hasScanner && knownCount > 0,
            gamesFound: Math.max(scannedCount, knownCount),
            connectionSupported: def.connectionSupported,
            hasScanner: def.hasScanner,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load launcher state.');
    }
  };

  const detectionLabel = (row: LauncherRow): string => {
    if (row.detected) return 'Detected locally';
    if (row.manuallyKnown) return 'Known (manually added)';
    return 'Not detected';
  };

  const lastScannedLabel = (row: LauncherRow): string => {
    if (!row.hasScanner) return 'Not applicable — no scanner exists';
    return row.detected ? (lastScanned ?? 'Unknown') : '—';
  };

  return (
    <div className="settings-section">
      <p className="settings-field-hint">
        Solith never asks for launcher account passwords. Detection is local-only, based on install folders and manifests
        already on this machine. Ubisoft Connect, EA app, and Battle.net have no local scanner yet — games on those
        launchers are only known when you add them manually.
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
          {(rows ?? LAUNCHER_DEFS.map((def) => ({ id: def.id, label: def.label, detected: false, manuallyKnown: false, gamesFound: 0, connectionSupported: def.connectionSupported, hasScanner: def.hasScanner }))).map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              <td>{detectionLabel(row)}</td>
              <td>{row.connectionSupported ? 'Account connection not implemented' : 'Account connection not supported'}</td>
              <td>{row.gamesFound}</td>
              <td>{lastScannedLabel(row)}</td>
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
