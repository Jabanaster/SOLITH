import React, { useCallback, useState } from 'react';
import type { TypedInterpretationsByWidth, TypedMemoryView } from '../../core/live-memory/typed-memory-view.js';

export interface TypedMemoryViewPanelProps {
  attached: boolean;
  processName?: string;
  pid?: number | null;
}

const WIDTHS: (1 | 2 | 4 | 8)[] = [1, 2, 4, 8];

/**
 * Phase 2 P2-6 — typed memory-view expansion: read a small, bounded window
 * and show every plausible interpretation at every supported width side by
 * side (interpretation, not semantic inference — same discipline as P2-5's
 * StructureDiscoveryPanel, which this mirrors). Integrates into the same
 * Live Memory tooling area, no second app.
 */
export const TypedMemoryViewPanel: React.FC<TypedMemoryViewPanelProps> = ({ attached, processName = 'unknown', pid = null }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [address, setAddress] = useState('0x0');
  const [length, setLength] = useState<1 | 2 | 4 | 8>(8);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [view, setView] = useState<TypedMemoryView | null>(null);
  const [editedRawHex, setEditedRawHex] = useState('');
  const [reinterpreted, setReinterpreted] = useState<TypedInterpretationsByWidth | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!attached || !api) {
        setMessage('Attach a process first (read-only typed view).');
        return;
      }
      setBusy(true);
      setMessage('');
      try {
        await fn();
      } catch (e) {
        setMessage(String(e));
      } finally {
        setBusy(false);
      }
    },
    [attached, api],
  );

  const handleRead = () =>
    run(async () => {
      const result = await api!.typedViewRead!({ address: address.trim(), length });
      if (!result.success || !result.view) {
        setMessage(result.error ?? 'typed-view:read failed');
        return;
      }
      setView(result.view);
      setEditedRawHex(result.view.rawHex ?? '');
      setReinterpreted(null);
      setMessage(
        result.view.readState === 'complete'
          ? `Read ${result.view.actualLength} byte(s)`
          : `Failed: ${result.view.reason ?? 'unreadable'}`,
      );
    });

  const handleRefresh = () =>
    run(async () => {
      if (!view) return;
      const result = await api!.typedViewRefresh!({ address, length });
      if (!result.success || !result.view) {
        setMessage(result.error ?? 'typed-view:refresh failed');
        return;
      }
      setView(result.view);
      setEditedRawHex(result.view.rawHex ?? '');
      setReinterpreted(null);
      setMessage(`Refreshed — ${result.view.readState}`);
    });

  const handleReinterpret = () =>
    run(async () => {
      if (!editedRawHex) return;
      const result = await api!.typedViewReinterpret!({ rawHex: editedRawHex });
      if (!result.success || !result.interpretationsByWidth) {
        setMessage(result.error ?? 'typed-view:reinterpret failed');
        return;
      }
      setReinterpreted(result.interpretationsByWidth);
      setMessage('Reinterpreted from raw bytes — no memory re-read.');
    });

  const byWidth = reinterpreted ?? view?.interpretationsByWidth ?? {};

  return (
    <section className="v2-monitor-section" aria-label="Phase 2 P2-6 typed memory view">
      <h3>Typed Memory View (read-only)</h3>
      <p className="v2-meta">
        Same raw bytes shown as every supported type at once — interpretation, never semantic truth. Max 8 bytes per read.
      </p>
      <div className="v2-form-row">
        <label htmlFor="typed-addr">Address</label>
        <input id="typed-addr" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!attached || busy} spellCheck={false} />
        <label htmlFor="typed-length">Length</label>
        <select
          id="typed-length"
          value={length}
          onChange={(e) => setLength(Number(e.target.value) as 1 | 2 | 4 | 8)}
          disabled={!attached || busy}
        >
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>
      <div className="v2-form-row">
        <button className="btn-secondary" type="button" onClick={handleRead} disabled={!attached || busy}>
          Read Typed Value
        </button>
        <button className="btn-secondary" type="button" onClick={handleRefresh} disabled={!attached || busy || !view}>
          Refresh Typed Value
        </button>
        <button className="btn-secondary" type="button" onClick={handleReinterpret} disabled={busy || !editedRawHex}>
          Reinterpret Raw Bytes
        </button>
      </div>
      {message && (
        <p className="v2-message" role="status">
          {message}
        </p>
      )}
      {view && (
        <>
          <p className="v2-meta">
            <code>{view.addressHex}</code> · {view.actualLength} byte(s) · {processName}
            {pid ? ` (PID ${pid})` : ''} · module=<code>{view.moduleName ?? '—'}</code> · readState=<code>{view.readState}</code>
          </p>
          <div className="v2-form-row">
            <label htmlFor="typed-raw-edit">Raw bytes</label>
            <input
              id="typed-raw-edit"
              value={editedRawHex}
              onChange={(e) => setEditedRawHex(e.target.value)}
              spellCheck={false}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div aria-label="Typed interpretations" style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Width</th>
                  <th align="left">Type</th>
                  <th align="left">Value</th>
                </tr>
              </thead>
              <tbody>
                {WIDTHS.flatMap((w) =>
                  (byWidth[w] ?? []).map((interp, i) => (
                    <tr key={`${w}-${interp.kind}-${i}`}>
                      <td>{w}</td>
                      <td>{interp.kind}</td>
                      <td>
                        <code>{interp.value}</code>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};

export default TypedMemoryViewPanel;
