import React, { useEffect, useRef, useState } from 'react';

export interface AdaptiveScanPanelProps {
  attached: boolean;
}

const DATA_TYPES = ['int32', 'uint32', 'float', 'double', 'int64', 'byte'] as const;
type ScanDataType = (typeof DATA_TYPES)[number];

interface ScanPlanDto {
  strategy: string;
  reasons: string[];
  regionOrder: string;
  maxRegionBytes: number;
  maxTotalBytes: number;
  maxMatches: number;
}

interface ScanTelemetryDto {
  strategy: string;
  regionsConsidered: number;
  regionsScanned: number;
  regionsSkipped: number;
  eligibleBytes: number;
  scannedBytes: number;
  elapsedMillis: number;
  resultCount: number;
  coverage: string;
  partialReads: number;
  failedReads: number;
  cancelled: boolean;
  recordedAt: number;
}

const SCAN_POLL_INTERVAL_MS = 150;

/**
 * P2-10 — Adaptive Scan Planner surface inside Advanced Scan Mode (§26).
 * Shows the planner's chosen strategy, the structured reasons behind it, and
 * the real measured telemetry each scan produced — a "Reference" run is the
 * deterministic baseline (§9) to compare against. Uses the same cancellable
 * start/poll transport (`liveMemoryAdaptiveScanStart`/`liveMemoryScanPoll`/
 * `liveMemoryScanCancel`) `PointerMapPanel` already established for
 * long-running scans — no parallel cancellation mechanism.
 */
const AdaptiveScanPanel: React.FC<AdaptiveScanPanelProps> = ({ attached }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [dataType, setDataType] = useState<ScanDataType>('int32');
  const [targetValue, setTargetValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanActive, setScanActive] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState<ScanPlanDto | null>(null);
  const [telemetry, setTelemetry] = useState<ScanTelemetryDto | null>(null);
  const [matches, setMatches] = useState<Array<{ address: string; value: number }>>([]);
  const [history, setHistory] = useState<ScanTelemetryDto[]>([]);

  const mountedRef = useRef(true);
  const activeOperationIdRef = useRef<string | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const inFlight = activeOperationIdRef.current;
      if (inFlight && api) void api.liveMemoryScanCancel({ operationId: inFlight });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshHistory = async () => {
    if (!api) return;
    const result = await api.liveMemoryAdaptiveScanTelemetryGet();
    if (mountedRef.current && result?.success && result.history) setHistory(result.history);
  };

  const run = async (mode: 'adaptive' | 'reference') => {
    if (!api) return;
    const numericValue = Number(targetValue);
    if (targetValue.trim() === '' || Number.isNaN(numericValue)) {
      setMessage('Enter a value to scan for.');
      return;
    }
    setBusy(true);
    setScanActive(true);
    setMessage(mode === 'adaptive' ? 'Planning adaptive scan…' : 'Running reference scan…');
    setPlan(null);
    setTelemetry(null);
    setMatches([]);
    try {
      const started = await api.liveMemoryAdaptiveScanStart({ dataType, targetValue: numericValue, mode });
      if (!started?.success || !started.operationId) {
        setMessage(`Scan failed: ${started?.error ?? 'unknown error'}`);
        setBusy(false);
        setScanActive(false);
        return;
      }
      activeOperationIdRef.current = started.operationId;
      setOperationId(started.operationId);
      await pollScanOperation(started.operationId);
    } catch (err) {
      if (mountedRef.current) setMessage(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
      setScanActive(false);
    }
  };

  const pollScanOperation = async (id: string) => {
    for (;;) {
      if (!api) return;
      const status = await api.liveMemoryScanPoll({ operationId: id });
      if (!mountedRef.current) return; // unmount cleanup already cancelled the operation
      if (!status?.success) {
        setMessage(`Scan poll failed: ${status?.error ?? 'unknown error'}`);
        break;
      }
      if (status.status === 'pending') {
        await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_INTERVAL_MS));
        continue;
      }
      if (status.status === 'not_found') {
        setMessage('Scan operation not found — it may have been superseded.');
        break;
      }
      if (status.status === 'error') {
        setMessage(`Scan error: ${status.error ?? 'unknown error'}`);
        break;
      }
      // 'complete' or 'cancelled' — both are real terminal states.
      const result = status.result;
      if (result?.plan) setPlan(result.plan as ScanPlanDto);
      if (result?.telemetry) setTelemetry(result.telemetry as ScanTelemetryDto);
      if (result?.matches) setMatches(result.matches);
      setMessage(
        status.status === 'cancelled'
          ? `Cancelled — ${result?.matches?.length ?? 0} match(es) found before stopping.`
          : `Found ${result?.matches?.length ?? 0} match(es). Coverage: ${result?.completeness ? JSON.stringify(result.completeness) : 'unknown'}.`,
      );
      await refreshHistory();
      break;
    }
    if (mountedRef.current) {
      setBusy(false);
      setScanActive(false);
      setOperationId(null);
    }
    activeOperationIdRef.current = null;
  };

  const cancel = async () => {
    if (!api || !operationId) return;
    setMessage('Cancelling…');
    await api.liveMemoryScanCancel({ operationId });
    // The poll loop already in flight observes the resulting terminal state.
  };

  if (!attached) return null;

  return (
    <section className="v2-monitor-section" aria-label="Adaptive scan planner">
      <h3>Adaptive Scan Planner</h3>
      <p className="v2-meta">
        Measures the attached process's real memory layout (and, after the first scan, its own prior
        results) to choose a scan strategy automatically — no manual region/order tuning needed.
        "Reference" always runs the deterministic full scan, for comparison.
      </p>

      <div className="v2-controls-row">
        <label htmlFor="p210-datatype">Type</label>
        <select id="p210-datatype" value={dataType} onChange={(e) => setDataType(e.target.value as ScanDataType)} disabled={scanActive}>
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label htmlFor="p210-value">Value</label>
        <input
          id="p210-value"
          type="number"
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
          placeholder="e.g. 100"
          disabled={scanActive}
        />
        <button className="btn-secondary" onClick={() => run('adaptive')} disabled={busy || targetValue.trim() === ''}>
          Adaptive Scan
        </button>
        <button className="btn-secondary" onClick={() => run('reference')} disabled={busy || targetValue.trim() === ''}>
          Reference Scan
        </button>
        {scanActive && (
          <button className="btn-secondary" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>

      {message && <p className="v2-meta">{message}</p>}

      {plan && (
        <div className="v2-meta" aria-label="Adaptive scan plan">
          <strong>Strategy:</strong> {plan.strategy} (region order: {plan.regionOrder})
          <br />
          <strong>Reasons:</strong> {plan.reasons.join(', ')}
        </div>
      )}

      {telemetry && (
        <div className="v2-meta" aria-label="Adaptive scan telemetry">
          <strong>Measured:</strong> {telemetry.regionsScanned}/{telemetry.regionsConsidered} regions,{' '}
          {telemetry.scannedBytes.toLocaleString()} bytes, {telemetry.elapsedMillis}ms, {telemetry.resultCount} result(s),
          coverage: {telemetry.coverage}
          {telemetry.partialReads > 0 || telemetry.failedReads > 0
            ? ` (${telemetry.partialReads} partial, ${telemetry.failedReads} failed reads)`
            : ''}
        </div>
      )}

      {matches.length > 0 && (
        <ul className="v2-scan-results" aria-label="Adaptive scan results">
          {matches.slice(0, 50).map((m) => (
            <li key={m.address}>
              <code>{m.address}</code> = {m.value}
            </li>
          ))}
          {matches.length > 50 && <li className="v2-meta">…and {matches.length - 50} more</li>}
        </ul>
      )}

      {history.length > 1 && (
        <details aria-label="Adaptive scan telemetry history">
          <summary>Scan history (this attach) — {history.length} scan(s)</summary>
          <ul className="v2-scan-results">
            {history.map((entry) => (
              <li key={entry.recordedAt}>
                <code>{entry.strategy}</code> — {entry.resultCount} result(s), {entry.elapsedMillis}ms, coverage: {entry.coverage}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

export default AdaptiveScanPanel;
