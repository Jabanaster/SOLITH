import React, { useCallback, useState } from 'react';
import type { WatchItem } from '../../core/live-memory/watchlist-model.js';

export interface WatchlistPanelProps {
  attached: boolean;
}

/** Phase 2 P2-8 — watchlists (ROADMAP.md assigns this to P2-8, not P2-7). Address source, typed value, change state — user labels only, never inferred. */
export const WatchlistPanel: React.FC<WatchlistPanelProps> = ({ attached }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [address, setAddress] = useState('0x0');
  const [width, setWidth] = useState<1 | 2 | 4 | 8>(4);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [watches, setWatches] = useState<WatchItem[]>([]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!attached || !api) {
        setMessage('Attach a process first (read-only watchlist).');
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

  const handleAdd = () =>
    run(async () => {
      const result = await api!.watchlistAdd!({
        source: { kind: 'absolute', address: address.trim() },
        width,
        label: label.trim() || null,
      });
      if (!result.success || !result.watch) {
        setMessage(result.error ?? 'watchlist:add failed');
        return;
      }
      setWatches((prev) => [...prev, result.watch!]);
      setMessage(`Added watch ${result.watch.id}`);
    });

  const handleRefreshAll = () =>
    run(async () => {
      const result = await api!.watchlistRefreshAll!();
      if (!result.success || !result.watches) {
        setMessage(result.error ?? 'watchlist:refresh-all failed');
        return;
      }
      setWatches(result.watches);
      setMessage(`Refreshed ${result.watches.length} watch(es)`);
    });

  const handleRemove = (watchId: string) =>
    run(async () => {
      const result = await api!.watchlistRemove!({ watchId });
      if (!result.success) {
        setMessage(result.error ?? 'watchlist:remove failed');
        return;
      }
      setWatches((prev) => prev.filter((w) => w.id !== watchId));
    });

  return (
    <section className="v2-monitor-section" aria-label="Phase 2 P2-8 watchlist">
      <h3>Watchlist (read-only)</h3>
      <p className="v2-meta">Address source, typed value, and change state — labels are always user-supplied, never inferred.</p>
      <div className="v2-form-row">
        <label htmlFor="watch-addr">Address</label>
        <input id="watch-addr" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!attached || busy} spellCheck={false} />
        <label htmlFor="watch-width">Width</label>
        <select id="watch-width" value={width} onChange={(e) => setWidth(Number(e.target.value) as 1 | 2 | 4 | 8)} disabled={!attached || busy}>
          {[1, 2, 4, 8].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <label htmlFor="watch-label">Label</label>
        <input id="watch-label" value={label} onChange={(e) => setLabel(e.target.value)} disabled={!attached || busy} placeholder="optional" />
      </div>
      <div className="v2-form-row">
        <button className="btn-secondary" type="button" onClick={handleAdd} disabled={!attached || busy}>
          Add Watch
        </button>
        <button className="btn-secondary" type="button" onClick={handleRefreshAll} disabled={!attached || busy || watches.length === 0}>
          Refresh All
        </button>
      </div>
      {message && (
        <p className="v2-message" role="status">
          {message}
        </p>
      )}
      {watches.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table aria-label="Watch items" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Label</th>
                <th align="left">Address</th>
                <th align="left">Resolve state</th>
                <th align="left">Read state</th>
                <th align="left">Value</th>
                <th align="left">Change state</th>
                <th align="left" />
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => (
                <tr key={w.id}>
                  <td>{w.label ?? '—'}</td>
                  <td>
                    <code>{w.resolvedAddressHex ?? '—'}</code>
                  </td>
                  <td>{w.resolveState}</td>
                  <td>{w.currentValue?.readState ?? '—'}</td>
                  <td>{w.currentValue?.rawHex ?? '—'}</td>
                  <td>{w.changeState}</td>
                  <td>
                    <button className="btn-secondary" type="button" onClick={() => handleRemove(w.id)} disabled={busy}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default WatchlistPanel;
