import React, { useCallback, useEffect, useState } from 'react';
import type { SessionSnapshot, SessionSnapshotDiff } from '../../core/live-memory/research/session-snapshot.js';
import type { PointerCandidateReport } from '../../core/live-memory/research/pointer-candidate-analysis.js';
import {
  RESEARCH_PROMOTE_SEED_KEY,
  type ResearchPromoteSeed,
} from '../../core/live-memory/ct-promote.js';

const VIEW_TYPES = ['int32', 'uint32', 'float', 'double', 'int64', 'byte', 'string'] as const;

export interface AddressDataResearchPanelProps {
  attached: boolean;
  processName?: string;
  pid?: number | null;
}

/**
 * Phase 9 + Phase 3 — read-only address / hex / pointer table / snapshot What-Changed.
 * Requires an attached live-memory session. Never proposes writes.
 */
export const AddressDataResearchPanel: React.FC<AddressDataResearchPanelProps> = ({
  attached,
  processName = 'unknown',
  pid = null,
}) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [address, setAddress] = useState('0x0');
  const [hexSize, setHexSize] = useState(256);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [viewEntries, setViewEntries] = useState<
    Array<{ address: string; type: string; value: number | string | null; readable: boolean }>
  >([]);
  const [hexRows, setHexRows] = useState<Array<{ offset: number; hex: string; ascii: string }>>([]);
  const [pointerReport, setPointerReport] = useState<PointerCandidateReport | null>(null);
  const [snapshotA, setSnapshotA] = useState<SessionSnapshot | null>(null);
  const [snapshotB, setSnapshotB] = useState<SessionSnapshot | null>(null);
  const [whatChanged, setWhatChanged] = useState<SessionSnapshotDiff | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESEARCH_PROMOTE_SEED_KEY);
      if (!raw) return;
      const seed = JSON.parse(raw) as ResearchPromoteSeed;
      if (seed.addressHint) setAddress(seed.addressHint);
      else if (seed.baseOffset && seed.moduleName) {
        setAddress(`${seed.moduleName}+${seed.baseOffset}`);
      }
      if (seed.label) setMessage(`Seeded from promote: ${seed.label}`);
      localStorage.removeItem(RESEARCH_PROMOTE_SEED_KEY);
    } catch {
      // ignore bad seed
    }
  }, []);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!attached || !api) {
        setMessage('Attach a process first (read-only research).');
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

  const handleView = () =>
    run(async () => {
      const result = await api!.researchView!({
        address: address.trim(),
        types: [...VIEW_TYPES],
      });
      if (!result.success) {
        setMessage(result.error ?? 'research:view failed');
        return;
      }
      setViewEntries(result.entries ?? []);
      setMessage(`Viewed ${result.entries?.length ?? 0} type(s) at ${address}`);
    });

  const handleHex = () =>
    run(async () => {
      const result = await api!.researchHex!({ address: address.trim(), size: hexSize });
      if (!result.success || !result.window) {
        setMessage(result.error ?? 'research:hex failed');
        return;
      }
      setHexRows(result.window.hexRows);
      setMessage(
        result.window.readable
          ? `Hex ${result.window.size} bytes${result.window.truncated ? ' (truncated)' : ''}`
          : result.window.error ?? 'unreadable',
      );
    });

  const handlePointer = () =>
    run(async () => {
      const result = await api!.researchPointerAnalyze!({ address: address.trim() });
      if (!result.success || !result.report) {
        setMessage(result.error ?? 'research:pointer-analyze failed');
        return;
      }
      setPointerReport(result.report);
      setMessage(
        `Pointer report: ${result.report.candidateCount} candidates, moduleRootOk=${result.report.moduleRootOk}, confidence=${result.report.confidenceScore}`,
      );
    });

  const buildSnapshotFromView = (label: string): SessionSnapshot => {
    const watchlist = viewEntries
      .filter((e) => e.readable)
      .map((e) => ({
        address: e.address,
        type: e.type,
        lastValue: e.value,
        label,
      }));
    return {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      pid: pid ?? 0,
      processName,
      watchlist,
      matchSetIds: pointerReport ? [`ptr:${pointerReport.targetAddress}`] : [],
      notes: label,
      pointerTarget: address.trim(),
    };
  };

  const handleSnapshotA = () =>
    run(async () => {
      const snapshot = buildSnapshotFromView('Snapshot A');
      const result = await api!.researchSnapshotSave!({ snapshot, label: 'A' });
      if (!result.success) {
        setMessage(result.error ?? 'snapshot A save failed');
        return;
      }
      setSnapshotA(result.snapshot ?? snapshot);
      setWhatChanged(null);
      setMessage(`Snapshot A saved (${(result.snapshot ?? snapshot).watchlist.length} watches)`);
    });

  const handleSnapshotB = () =>
    run(async () => {
      const snapshot = buildSnapshotFromView('Snapshot B');
      const result = await api!.researchSnapshotSave!({ snapshot, label: 'B' });
      if (!result.success) {
        setMessage(result.error ?? 'snapshot B save failed');
        return;
      }
      const saved = result.snapshot ?? snapshot;
      setSnapshotB(saved);
      if (snapshotA) {
        const diff = await api!.researchSnapshotDiff!({ old: snapshotA, new: saved });
        if (diff.success && diff.diff) {
          setWhatChanged(diff.diff);
          setMessage(
            `What Changed? +${diff.diff.added.length} / -${diff.diff.removed.length} / ~${diff.diff.changed.length}`,
          );
          return;
        }
      }
      setMessage('Snapshot B saved — capture Snapshot A first to diff.');
    });

  const handlePromoteBestPath = () => {
    if (!pointerReport?.bestPath) {
      setMessage('Run pointer analyze first.');
      return;
    }
    const seed: ResearchPromoteSeed = {
      moduleName: pointerReport.bestPath.moduleName,
      baseOffset: pointerReport.bestPath.moduleOffset,
      pointerChain: pointerReport.bestPath.offsets,
      label: 'best-pointer-path',
      liveResolution: pointerReport.moduleRootOk ? 'resolvable' : 'incomplete',
    };
    localStorage.setItem(RESEARCH_PROMOTE_SEED_KEY, JSON.stringify(seed));
    setMessage('Best path promoted to live-watch seed (local). Open Live Toggle Cards after re-import if needed.');
  };

  return (
    <section className="v2-monitor-section" aria-label="Phase 9 address and data research">
      <h3>Address &amp; Data Research (read-only)</h3>
      <p className="v2-meta">
        Phase 9/3 tools — RPM inspect only. No writes. Pointer analysis may take minutes on large heaps.
      </p>
      <div className="v2-form-row">
        <label htmlFor="research-addr">Address</label>
        <input
          id="research-addr"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={!attached || busy}
          spellCheck={false}
        />
        <label htmlFor="research-hex-size">Hex size</label>
        <input
          id="research-hex-size"
          type="number"
          min={16}
          max={4096}
          value={hexSize}
          onChange={(e) => setHexSize(Number(e.target.value) || 256)}
          disabled={!attached || busy}
        />
      </div>
      <div className="v2-form-row">
        <button className="btn-secondary" type="button" onClick={handleView} disabled={!attached || busy}>
          Typed view
        </button>
        <button className="btn-secondary" type="button" onClick={handleHex} disabled={!attached || busy}>
          Hex inspect
        </button>
        <button className="btn-secondary" type="button" onClick={handlePointer} disabled={!attached || busy}>
          Pointer analyze
        </button>
        <button className="btn-secondary" type="button" onClick={handleSnapshotA} disabled={!attached || busy}>
          Snapshot A
        </button>
        <button className="btn-secondary" type="button" onClick={handleSnapshotB} disabled={!attached || busy}>
          Snapshot B · What Changed?
        </button>
      </div>
      {message && (
        <p className="v2-message" role="status">
          {message}
        </p>
      )}
      {viewEntries.length > 0 && (
        <ul aria-label="Typed values">
          {viewEntries.map((e) => (
            <li key={`${e.address}-${e.type}`}>
              <code>{e.type}</code>: {e.readable ? String(e.value) : 'UNREADABLE'}
            </li>
          ))}
        </ul>
      )}
      {hexRows.length > 0 && (
        <pre aria-label="Hex window" style={{ maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
          {hexRows.map((r) => `${r.offset.toString(16).padStart(4, '0')}  ${r.hex.padEnd(47)}  ${r.ascii}`).join('\n')}
        </pre>
      )}
      {pointerReport && (
        <div aria-label="Pointer candidate report">
          <p className="v2-meta">
            confidence={pointerReport.confidenceScore} · moduleRootOk={pointerReport.moduleRootOk} /{' '}
            {pointerReport.candidateCount}
            {pointerReport.truncated ? ' · truncated' : ''}
          </p>
          {pointerReport.bestPath && (
            <p>
              Best:{' '}
              <code>
                {pointerReport.bestPath.moduleName}+{pointerReport.bestPath.moduleOffset} → [
                {pointerReport.bestPath.offsets.join(', ')}]
              </code>{' '}
              <button type="button" className="btn-secondary" onClick={handlePromoteBestPath}>
                Promote to Live Watch seed
              </button>
            </p>
          )}
          {pointerReport.ranked && pointerReport.ranked.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table aria-label="Pointer candidates" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th align="left">Score</th>
                    <th align="left">Depth</th>
                    <th align="left">Module</th>
                    <th align="left">Offset</th>
                    <th align="left">Chain</th>
                  </tr>
                </thead>
                <tbody>
                  {pointerReport.ranked.slice(0, 40).map((p, i) => (
                    <tr key={`${p.moduleName}-${p.moduleOffset}-${i}`}>
                      <td>{p.score}{p.moduleRoot ? ' · root' : ''}</td>
                      <td>{p.depth}</td>
                      <td>
                        <code>{p.moduleName}</code>
                      </td>
                      <td>
                        <code>{p.moduleOffset}</code>
                      </td>
                      <td>
                        <code>[{p.offsets.join(', ')}]</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {whatChanged && (
        <div aria-label="What changed diff" style={{ marginTop: 12 }}>
          <h4>What Changed?</h4>
          <p className="v2-meta">
            A={snapshotA?.timestamp ?? '—'} · B={snapshotB?.timestamp ?? '—'}
          </p>
          <ul>
            {whatChanged.changed.slice(0, 30).map((c) => (
              <li key={`chg-${c.address}-${c.type}`}>
                ~ <code>{c.address}</code> {c.type}: {String(c.old)} → {String(c.new)}
              </li>
            ))}
            {whatChanged.added.slice(0, 15).map((a) => (
              <li key={`add-${a.address}-${a.type}`}>
                + <code>{a.address}</code> {a.type}: {String(a.lastValue)}
              </li>
            ))}
            {whatChanged.removed.slice(0, 15).map((r) => (
              <li key={`rem-${r.address}-${r.type}`}>
                − <code>{r.address}</code> {r.type}: {String(r.lastValue)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default AddressDataResearchPanel;
