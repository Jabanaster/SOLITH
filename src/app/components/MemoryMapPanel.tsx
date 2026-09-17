import React, { useCallback, useState } from 'react';
import type { MemoryModuleSummary, MemoryRegionSummary } from '../../core/live-memory/research/memory-viewer.js';

export interface MemoryMapPanelProps {
  attached: boolean;
}

/**
 * Phase 2 P2-8 — memory map (region/module browser). Reuses the existing
 * research MemoryViewer enumeration (Phase 9) — this panel is the missing
 * UI/IPC surface, not a new engine.
 */
export const MemoryMapPanel: React.FC<MemoryMapPanelProps> = ({ attached }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [regions, setRegions] = useState<MemoryRegionSummary[] | null>(null);
  const [modules, setModules] = useState<MemoryModuleSummary[] | null>(null);
  const [writableOnly, setWritableOnly] = useState(false);

  const handleLoad = useCallback(async () => {
    if (!attached || !api) {
      setMessage('Attach a process first (read-only memory map).');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const [regionsResult, modulesResult] = await Promise.all([
        api.memoryMapListRegions!({ writableOnly }),
        api.memoryMapListModules!({}),
      ]);
      if (!regionsResult.success || !regionsResult.list) {
        setMessage(regionsResult.error ?? 'memory-map:list-regions failed');
        return;
      }
      if (!modulesResult.success || !modulesResult.list) {
        setMessage(modulesResult.error ?? 'memory-map:list-modules failed');
        return;
      }
      setRegions(regionsResult.list.regions);
      setModules(modulesResult.list.modules);
      setMessage(
        `${regionsResult.list.regions.length}/${regionsResult.list.totalAvailable} region(s)${regionsResult.list.truncated ? ' (truncated)' : ''}, ` +
          `${modulesResult.list.modules.length}/${modulesResult.list.totalAvailable} module(s)${modulesResult.list.truncated ? ' (truncated)' : ''}`,
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }, [attached, api, writableOnly]);

  return (
    <section className="v2-monitor-section" aria-label="Phase 2 P2-8 memory map">
      <h3>Memory Map (read-only)</h3>
      <p className="v2-meta">Real committed regions and loaded modules for the attached process.</p>
      <div className="v2-form-row">
        <label htmlFor="memmap-writable-only">
          <input
            id="memmap-writable-only"
            type="checkbox"
            checked={writableOnly}
            onChange={(e) => setWritableOnly(e.target.checked)}
            disabled={!attached || busy}
          />{' '}
          Writable regions only
        </label>
        <button className="btn-secondary" type="button" onClick={handleLoad} disabled={!attached || busy}>
          Load Memory Map
        </button>
      </div>
      {message && (
        <p className="v2-message" role="status">
          {message}
        </p>
      )}
      {modules && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table aria-label="Loaded modules" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Module</th>
                <th align="left">Base</th>
                <th align="left">Size</th>
                <th align="left">Path</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.baseAddress}>
                  <td>{m.name}</td>
                  <td>
                    <code>{m.baseAddress}</code>
                  </td>
                  <td>{m.size}</td>
                  <td>{m.path ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {regions && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table aria-label="Memory regions" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Base</th>
                <th align="left">Size</th>
                <th align="left">R</th>
                <th align="left">W</th>
                <th align="left">X</th>
                <th align="left">Type</th>
                <th align="left">Module</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r.baseAddress}>
                  <td>
                    <code>{r.baseAddress}</code>
                  </td>
                  <td>{r.size}</td>
                  <td>{r.readable === undefined ? '—' : String(r.readable)}</td>
                  <td>{String(r.writable)}</td>
                  <td>{r.executable === undefined ? '—' : String(r.executable)}</td>
                  <td>{r.regionType ?? '—'}</td>
                  <td>{r.moduleName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default MemoryMapPanel;
