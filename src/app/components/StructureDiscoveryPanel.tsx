import React, { useCallback, useMemo, useState } from 'react';
import type {
  DiscoveredField,
  DiscoveredStructure,
  StructureSnapshot,
  StructureSnapshotDiffResult,
} from '../../core/live-memory/structure-model.js';

export interface StructureDiscoveryPanelProps {
  attached: boolean;
  processName?: string;
  pid?: number | null;
}

type ReadRow =
  | { kind: 'field'; offset: number; field: DiscoveredField }
  | { kind: 'unknown'; offset: number; length: number };

function combineRows(structure: DiscoveredStructure): ReadRow[] {
  const rows: ReadRow[] = [
    ...structure.fields.map((field) => ({ kind: 'field' as const, offset: field.offset, field })),
    ...structure.unknownSpans.map((span) => ({ kind: 'unknown' as const, offset: span.offset, length: span.length })),
  ];
  rows.sort((a, b) => a.offset - b.offset);
  return rows;
}

/** Change state for a field's byte range, derived from the last snapshot diff — spec §17: never color-only, always a text state. */
function changeStateFor(diff: StructureSnapshotDiffResult | null, offset: number, width: number): string {
  if (!diff) return '—';
  const overlap = diff.changes.find((c) => offset < c.offset + Math.max(c.length, 1) && offset + width > c.offset);
  return overlap ? overlap.state : 'unchanged';
}

/**
 * Phase 2 P2-5 — bounded structure discovery: field table, field inspector,
 * snapshot capture/compare, refresh. Integrates into the existing Live
 * Memory tooling area, following AddressDataResearchPanel.tsx's read-only
 * research-panel convention — never a second standalone application.
 */
export const StructureDiscoveryPanel: React.FC<StructureDiscoveryPanelProps> = ({ attached, processName = 'unknown', pid = null }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [label, setLabel] = useState('structure');
  const [address, setAddress] = useState('0x0');
  const [length, setLength] = useState(256);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [structure, setStructure] = useState<DiscoveredStructure | null>(null);
  const [selectedOffset, setSelectedOffset] = useState<number | null>(null);
  const [snapshotA, setSnapshotA] = useState<StructureSnapshot | null>(null);
  const [snapshotB, setSnapshotB] = useState<StructureSnapshot | null>(null);
  const [diff, setDiff] = useState<StructureSnapshotDiffResult | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!attached || !api) {
        setMessage('Attach a process first (read-only structure discovery).');
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

  const handleDiscover = () =>
    run(async () => {
      const result = await api!.structureDiscover!({ label: label.trim() || 'structure', baseAddress: address.trim(), length });
      if (!result.success || !result.structure) {
        setMessage(result.error ?? 'structure:discover failed');
        return;
      }
      setStructure(result.structure);
      setSelectedOffset(null);
      setSnapshotA(null);
      setSnapshotB(null);
      setDiff(null);
      const s = result.structure;
      setMessage(
        `Discovered ${s.fields.length} field(s), ${s.unknownSpans.length} unknown span(s) — ${s.completeness.state}${s.truncated ? ' (truncated to max)' : ''}`,
      );
    });

  const handleRefresh = () =>
    run(async () => {
      if (!structure) return;
      const result = await api!.structureRefresh!({ structureId: structure.id });
      if (!result.success || !result.structure) {
        setMessage(result.error ?? 'structure:refresh failed');
        return;
      }
      setStructure(result.structure);
      setMessage(`Refreshed — ${result.structure.completeness.state}`);
    });

  const handleSnapshotA = () =>
    run(async () => {
      if (!structure) return;
      const result = await api!.structureCaptureSnapshot!({ structureId: structure.id });
      if (!result.success || !result.snapshot) {
        setMessage(result.error ?? 'snapshot A capture failed');
        return;
      }
      setSnapshotA(result.snapshot);
      setDiff(null);
      setMessage(`Snapshot A captured (${result.snapshot.completeness.state})`);
    });

  const handleSnapshotB = () =>
    run(async () => {
      if (!structure) return;
      const result = await api!.structureCaptureSnapshot!({ structureId: structure.id });
      if (!result.success || !result.snapshot) {
        setMessage(result.error ?? 'snapshot B capture failed');
        return;
      }
      setSnapshotB(result.snapshot);
      if (snapshotA) {
        const diffResult = await api!.structureCompareSnapshots!({ snapshotAId: snapshotA.id, snapshotBId: result.snapshot.id });
        if (diffResult.success && diffResult.diff) {
          setDiff(diffResult.diff);
          setMessage(`Compared — ${diffResult.diff.changes.length} changed range(s)`);
          return;
        }
      }
      setMessage('Snapshot B captured — capture Snapshot A first to compare.');
    });

  const rows = useMemo(() => (structure ? combineRows(structure) : []), [structure]);
  const selectedField = useMemo(
    () => (selectedOffset === null ? null : structure?.fields.find((f) => f.offset === selectedOffset) ?? null),
    [structure, selectedOffset],
  );

  return (
    <section className="v2-monitor-section" aria-label="Phase 2 P2-5 structure discovery">
      <h3>Structure Discovery (read-only)</h3>
      <p className="v2-meta">
        Bounded byte-region field breakdown — candidate types, never proven semantics. Max 4096 bytes per window.
      </p>
      <div className="v2-form-row">
        <label htmlFor="struct-label">Label</label>
        <input id="struct-label" value={label} onChange={(e) => setLabel(e.target.value)} disabled={!attached || busy} />
        <label htmlFor="struct-addr">Base address</label>
        <input
          id="struct-addr"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={!attached || busy}
          spellCheck={false}
        />
        <label htmlFor="struct-length">Length</label>
        <input
          id="struct-length"
          type="number"
          min={1}
          max={4096}
          value={length}
          onChange={(e) => setLength(Number(e.target.value) || 256)}
          disabled={!attached || busy}
        />
      </div>
      <div className="v2-form-row">
        <button className="btn-secondary" type="button" onClick={handleDiscover} disabled={!attached || busy}>
          Discover Structure
        </button>
        <button className="btn-secondary" type="button" onClick={handleRefresh} disabled={!attached || busy || !structure}>
          Refresh Structure
        </button>
        <button className="btn-secondary" type="button" onClick={handleSnapshotA} disabled={!attached || busy || !structure}>
          Snapshot A
        </button>
        <button className="btn-secondary" type="button" onClick={handleSnapshotB} disabled={!attached || busy || !structure}>
          Snapshot B · Compare
        </button>
      </div>
      {message && (
        <p className="v2-message" role="status">
          {message}
        </p>
      )}
      {structure && (
        <>
          <p className="v2-meta">
            {structure.label} @ <code>{structure.baseAddressHex}</code> · {structure.length} bytes · {processName}
            {pid ? ` (PID ${pid})` : ''} · completeness=<code>{structure.completeness.state}</code>
            {structure.completeness.state === 'failed' ? `: ${structure.completeness.reason}` : ''}
          </p>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table aria-label="Structure fields" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Offset</th>
                  <th align="left">Address</th>
                  <th align="left">Size</th>
                  <th align="left">Raw</th>
                  <th align="left">Candidate types</th>
                  <th align="left">Current value(s)</th>
                  <th align="left">Change state</th>
                  <th align="left">Pointer target</th>
                  <th align="left">Read state</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  if (row.kind === 'unknown') {
                    return (
                      <tr key={`unk-${row.offset}`} style={{ color: 'var(--warn-color, #a15c00)' }}>
                        <td>0x{row.offset.toString(16)}</td>
                        <td>
                          <code>{structure.baseAddressHex}+0x{row.offset.toString(16)}</code>
                        </td>
                        <td>{row.length}</td>
                        <td colSpan={4}>UNREADABLE SPAN</td>
                        <td>—</td>
                        <td>unreadable</td>
                      </tr>
                    );
                  }
                  const f = row.field;
                  const pointerTarget = f.evidence.pointerCandidate.classified
                    ? `${f.evidence.pointerCandidate.destinationAddress}${f.evidence.pointerCandidate.destinationModuleName ? ` (${f.evidence.pointerCandidate.destinationModuleName})` : ''}`
                    : '—';
                  return (
                    <tr
                      key={`f-${f.offset}`}
                      onClick={() => setSelectedOffset(f.offset)}
                      style={{ cursor: 'pointer', background: selectedOffset === f.offset ? 'var(--row-selected, rgba(100,150,255,0.12))' : undefined }}
                    >
                      <td>0x{f.offset.toString(16)}{f.aligned ? '' : ' *'}</td>
                      <td>
                        <code>{structure.baseAddressHex}+0x{f.offset.toString(16)}</code>
                      </td>
                      <td>{f.width}</td>
                      <td>
                        <code>{f.rawHex}</code>
                      </td>
                      <td>{f.interpretations.map((i) => i.kind).join(', ')}</td>
                      <td>{f.interpretations.map((i) => i.value).join(' / ')}</td>
                      <td>{changeStateFor(diff, f.offset, f.width)}</td>
                      <td>{pointerTarget}</td>
                      <td>readable ({f.confidence})</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && <p className="v2-meta">* = unaligned field. Click a row to inspect.</p>}
        </>
      )}
      {selectedField && (
        <div aria-label="Field inspector" style={{ marginTop: 12 }}>
          <h4>Field Inspector — offset 0x{selectedField.offset.toString(16)}</h4>
          <ul>
            <li>Raw bytes: <code>{selectedField.rawHex}</code></li>
            <li>Width: {selectedField.width} · Aligned: {String(selectedField.aligned)} · Confidence: {selectedField.confidence}</li>
            <li>
              Interpretations:{' '}
              {selectedField.interpretations.map((i) => (
                <code key={i.kind} style={{ marginRight: 8 }}>
                  {i.kind}={i.value}
                </code>
              ))}
            </li>
            <li>
              Pointer evidence:{' '}
              {selectedField.evidence.pointerCandidate.classified
                ? `${selectedField.evidence.pointerCandidate.destinationAddress} (${selectedField.evidence.pointerCandidate.destinationRegion}${selectedField.evidence.pointerCandidate.destinationModuleName ? `, ${selectedField.evidence.pointerCandidate.destinationModuleName}` : ''})`
                : 'none'}
            </li>
            <li>
              String evidence:{' '}
              {selectedField.evidence.stringCandidate.classified
                ? `"${selectedField.evidence.stringCandidate.text}" (${selectedField.evidence.stringCandidate.encoding}, ratio=${selectedField.evidence.stringCandidate.printableRatio.toFixed(2)})`
                : 'none'}
            </li>
            <li>Change state (last diff): {changeStateFor(diff, selectedField.offset, selectedField.width)}</li>
          </ul>
        </div>
      )}
      {diff && (
        <div aria-label="Snapshot diff" style={{ marginTop: 12 }}>
          <h4>Snapshot Diff</h4>
          <p className="v2-meta">
            A={snapshotA?.capturedAt ?? '—'} · B={snapshotB?.capturedAt ?? '—'}
          </p>
          <ul>
            {diff.changes.slice(0, 40).map((c, i) => (
              <li key={`${c.offset}-${i}`}>
                <code>0x{c.offset.toString(16)}</code> (+{c.length}): <strong>{c.state}</strong>{' '}
                {c.oldRawHex ?? '—'} → {c.newRawHex ?? '—'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default StructureDiscoveryPanel;
