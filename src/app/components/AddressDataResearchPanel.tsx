import React, { useCallback, useState } from 'react';
import type { SessionSnapshot } from '../../core/live-memory/research/session-snapshot.js';
import type { PointerCandidateReport } from '../../core/live-memory/research/pointer-candidate-analysis.js';

const VIEW_TYPES = ['int32', 'uint32', 'float', 'double', 'int64', 'byte', 'string'] as const;

export interface AddressDataResearchPanelProps {
  attached: boolean;
  processName?: string;
  pid?: number | null;
}

/**
 * Phase 9 — read-only address / hex / pointer / snapshot tools.
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
  const [lastSnapshot, setLastSnapshot] = useState<SessionSnapshot | null>(null);
  const [diffSummary, setDiffSummary] = useState('');

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

  const handleSaveSnapshot = () =>
    run(async () => {
      const watchlist = viewEntries
        .filter((e) => e.readable)
        .map((e) => ({
          address: e.address,
          type: e.type,
          lastValue: e.value,
        }));
      const snapshot: SessionSnapshot = {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        pid: pid ?? 0,
        processName,
        watchlist,
        matchSetIds: pointerReport ? [`ptr:${pointerReport.targetAddress}`] : [],
        notes: 'Phase 9 research panel',
        pointerTarget: address.trim(),
      };
      const result = await api!.researchSnapshotSave!({ snapshot });
      if (!result.success) {
        setMessage(result.error ?? 'snapshot save failed');
        return;
      }
      if (lastSnapshot && result.snapshot) {
        const diff = await api!.researchSnapshotDiff!({ old: lastSnapshot, new: result.snapshot });
        if (diff.success && diff.diff) {
          setDiffSummary(
            `diff +${diff.diff.added.length} / -${diff.diff.removed.length} / ~${diff.diff.changed.length}`,
          );
        }
      }
      setLastSnapshot(result.snapshot ?? snapshot);
      setMessage(`Snapshot saved: ${result.filePath ?? 'ok'}`);
    });

  return (
    <section className="v2-monitor-section" aria-label="Phase 9 address and data research">
      <h3>Address &amp; Data Research (read-only)</h3>
      <p className="v2-meta">
        Phase 9 tools — RPM inspect only. No writes. Pointer analysis may take minutes on large heaps.
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
        <button className="btn-secondary" type="button" onClick={handleSaveSnapshot} disabled={!attached || busy}>
          Save snapshot
        </button>
      </div>
      {message && (
        <p className="v2-message" role="status">
          {message}
          {diffSummary ? ` · ${diffSummary}` : ''}
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
              </code>
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default AddressDataResearchPanel;
