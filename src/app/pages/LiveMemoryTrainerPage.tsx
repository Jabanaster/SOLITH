import React, { useState, useEffect, useCallback } from 'react';

interface ProcessEntry {
  pid: number;
  name: string;
}

interface GuardResult {
  allowed: boolean;
  reason: string;
}

interface AttachResult {
  success: boolean;
  guard?: GuardResult;
  error?: string;
}

interface WriteProposal {
  proposalId: string;
  target: { address: string; dataType: string };
  currentValue: number;
  requestedValue: number;
}

interface ScanMatchEntry {
  address: string;
  value: number;
}

interface FreezeStatusView {
  active: boolean;
  target: { address: { address: string; dataType: string }; value: number } | null;
  lastGuard: GuardResult | null;
  stopReason?: string;
  tickCount: number;
}

interface SavedControl {
  id: string;
  label: string;
  description: string;
  dataType: string;
  constraints?: { min?: number; max?: number };
}

const DATA_TYPES = ['int32', 'uint32', 'float', 'double', 'int64', 'byte'] as const;
const COMPARISON_KINDS = ['exact', 'changed', 'unchanged', 'increased', 'decreased'] as const;
const SCAN_RESULTS_DISPLAY_LIMIT = 200;

const LiveMemoryTrainerPage: React.FC = () => {
  const api = (window as any).electronAPI;
  const apiAvailable = typeof window !== 'undefined' && !!api;

  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);
  const [attached, setAttached] = useState(false);
  const [lastGuard, setLastGuard] = useState<GuardResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [address, setAddress] = useState('');
  const [dataType, setDataType] = useState<(typeof DATA_TYPES)[number]>('int32');
  const [requestedValue, setRequestedValue] = useState('');
  const [readValue, setReadValue] = useState<number | null>(null);
  const [pendingProposal, setPendingProposal] = useState<WriteProposal | null>(null);

  const [scanTargetValue, setScanTargetValue] = useState('');
  const [scanComparison, setScanComparison] = useState<(typeof COMPARISON_KINDS)[number]>('exact');
  const [scanNextValue, setScanNextValue] = useState('');
  const [scanMatches, setScanMatches] = useState<ScanMatchEntry[]>([]);
  const [scanInfo, setScanInfo] = useState('');
  const [hasScanned, setHasScanned] = useState(false);

  const [freezeValue, setFreezeValue] = useState('');
  const [freezeIntervalMs, setFreezeIntervalMs] = useState('200');
  const [freezeStatus, setFreezeStatus] = useState<FreezeStatusView | null>(null);

  const [savedControls, setSavedControls] = useState<SavedControl[]>([]);
  const [controlsChecked, setControlsChecked] = useState(false);

  useEffect(() => {
    if (!apiAvailable) {
      setFeatureEnabled(false);
      return;
    }
    api.getSettings().then((s: any) => {
      setFeatureEnabled(!!s?.v2LiveModeEnabled);
    }).catch(() => setFeatureEnabled(false));
  }, [apiAvailable, api]);

  const loadProcesses = useCallback(async () => {
    if (!apiAvailable) return;
    setBusy(true);
    try {
      const result = await api.liveMemoryListProcesses();
      if (result?.success) {
        setProcesses(result.processes ?? []);
        setMessage('');
      } else {
        setMessage(`Failed to list processes: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  }, [apiAvailable, api]);

  const handleAttach = async () => {
    if (!selectedPid) return;
    const proc = processes.find(p => p.pid === selectedPid);
    if (!proc) return;

    setBusy(true);
    setMessage('');
    try {
      const result: AttachResult = await api.liveMemoryAttach({
        pid: selectedPid,
        executableName: proc.name,
        userConfirmedOffline: true,
      });
      setLastGuard(result.guard ?? null);
      if (result.success) {
        setAttached(true);
        setMessage(`Attached to ${proc.name} (PID ${selectedPid}).`);
      } else {
        setMessage(`Attach blocked: ${result.guard?.reason ?? result.error ?? 'unknown reason'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDetach = async () => {
    setBusy(true);
    try {
      await api.liveMemoryDetach();
      setAttached(false);
      setPendingProposal(null);
      setReadValue(null);
      setSavedControls([]);
      setControlsChecked(false);
      setMessage('Detached.');
    } finally {
      setBusy(false);
    }
  };

  const handleRead = async () => {
    if (!address.trim()) return;
    setBusy(true);
    try {
      const result = await api.liveMemoryRead({ address: address.trim(), dataType });
      if (result?.success) {
        setReadValue(result.value);
        setMessage('');
      } else {
        setMessage(`Read failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePropose = async () => {
    if (!address.trim() || requestedValue.trim() === '') return;
    setBusy(true);
    try {
      const result = await api.liveMemoryProposeWrite({
        address: address.trim(),
        dataType,
        requestedValue: Number(requestedValue),
      });
      if (result?.success) {
        setPendingProposal(result.proposal);
        setMessage(`Proposed: ${result.proposal.currentValue} → ${result.proposal.requestedValue}. Review, then confirm.`);
      } else {
        setMessage(`Propose failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingProposal) return;
    setBusy(true);
    try {
      const result = await api.liveMemoryConfirmWrite({ proposalId: pendingProposal.proposalId });
      setLastGuard(result.guard ?? null);
      if (result.success) {
        setMessage(`Write applied: ${result.manifest.valueBefore} → ${result.manifest.valueAfter}.`);
        setPendingProposal(null);
        setReadValue(result.manifest.valueAfter);
      } else {
        setMessage(`Write blocked at confirm time: ${result.guard?.reason ?? result.error ?? 'unknown reason'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleScanFirst = async () => {
    if (scanTargetValue.trim() === '') return;
    setBusy(true);
    try {
      const result = await api.liveMemoryScanFirst({ dataType, targetValue: Number(scanTargetValue) });
      if (result?.success && result.result) {
        const matches: ScanMatchEntry[] = result.result.matches;
        setScanMatches(matches);
        setHasScanned(true);
        setScanInfo(
          `${matches.length} match(es) · ${result.result.regionsScanned} region(s) scanned · ` +
            `${(result.result.bytesScanned / (1024 * 1024)).toFixed(1)} MiB` +
            (result.result.truncated ? ' · scan truncated by safety limits, results are partial' : ''),
        );
        setMessage('');
      } else {
        setMessage(`First scan failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleScanNext = async () => {
    if (!hasScanned) return;
    setBusy(true);
    try {
      const comparison =
        scanComparison === 'exact' ? { kind: 'exact', value: Number(scanNextValue) } : { kind: scanComparison };
      const result = await api.liveMemoryScanNext({ dataType, comparison, previous: scanMatches });
      if (result?.success) {
        const matches: ScanMatchEntry[] = result.matches ?? [];
        setScanMatches(matches);
        setScanInfo(`${matches.length} match(es) remaining after narrowing`);
        setMessage('');
      } else {
        setMessage(`Next scan failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUseMatch = (match: ScanMatchEntry) => {
    setAddress(match.address);
    setReadValue(match.value);
    setMessage(`Loaded ${match.address} into the manual read/write section below — review and propose from there.`);
  };

  const refreshFreezeStatus = useCallback(async () => {
    if (!apiAvailable || !attached) return;
    const result = await api.liveMemoryFreezeStatus();
    if (result?.success) setFreezeStatus(result.status);
  }, [apiAvailable, attached, api]);

  useEffect(() => {
    if (!attached) return;
    const id = setInterval(() => { void refreshFreezeStatus(); }, 1000);
    return () => clearInterval(id);
  }, [attached, refreshFreezeStatus]);

  const handleStartFreeze = async () => {
    if (!address.trim() || freezeValue.trim() === '') return;
    setBusy(true);
    try {
      const result = await api.liveMemoryFreezeStart({
        address: address.trim(),
        dataType,
        value: Number(freezeValue),
        intervalMs: freezeIntervalMs.trim() ? Number(freezeIntervalMs) : undefined,
      });
      if (result?.success) {
        setMessage(`Freeze started on ${address.trim()}.`);
        await refreshFreezeStatus();
      } else {
        setMessage(`Freeze failed to start: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleStopFreeze = async () => {
    setBusy(true);
    try {
      const result = await api.liveMemoryFreezeStop();
      if (result?.success) {
        setFreezeStatus(result.status);
        setMessage('Freeze stopped.');
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!attached || controlsChecked) return;
    setControlsChecked(true);
    api.liveMemoryListControls().then((result: any) => {
      if (result?.success) setSavedControls(result.controls ?? []);
    });
  }, [attached, controlsChecked, api]);

  const handleUseControl = async (control: SavedControl) => {
    setBusy(true);
    try {
      const result = await api.liveMemoryResolveControl({ controlId: control.id });
      if (result?.success && result.address) {
        setAddress(result.address.address);
        setDataType(result.address.dataType as (typeof DATA_TYPES)[number]);
        setReadValue(result.currentValue ?? null);
        setMessage(`Loaded "${control.label}" (current value: ${result.currentValue}) into the manual read/write section below.`);
      } else {
        setMessage(`Could not resolve "${control.label}": ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!apiAvailable) {
    return (
      <div className="v2-monitor-page">
        <div className="v2-monitor-header">
          <h2>Live Memory Trainer <span className="v2-badge">V2 Preview</span></h2>
        </div>
        <div className="v2-monitor-disabled"><p>Electron API not available (browser mode).</p></div>
      </div>
    );
  }

  if (featureEnabled === false) {
    return (
      <div className="v2-monitor-page">
        <div className="v2-monitor-header">
          <h2>Live Memory Trainer <span className="v2-badge">V2 Preview</span></h2>
          <p className="v2-safety-notice">Disabled by default · Single-player/offline only · No injection</p>
        </div>
        <div className="v2-monitor-disabled">
          <p><strong>This feature is disabled.</strong></p>
          <p>
            To enable it, set <code>v2LiveModeEnabled</code> to <code>true</code> in Solith
            settings. It is disabled by default.
          </p>
          <p className="v2-safety-notice">
            When enabled, this reads and writes a target process's memory using standard
            ReadProcessMemory/WriteProcessMemory only — no DLL injection, no kernel drivers,
            no anti-cheat interaction. Every attach and every write requires you to confirm the
            session is single-player/offline, and is automatically blocked if the target process
            has active non-loopback network connections, even if you confirmed offline play.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-monitor-page">
      <div className="v2-monitor-header">
        <h2>Live Memory Trainer <span className="v2-badge">V2 Preview</span></h2>
        <p className="v2-safety-notice">
          Single-player/offline only · Standard ReadProcessMemory/WriteProcessMemory only · No injection
        </p>
      </div>

      <section className="v2-monitor-section" aria-label="Process selection">
        <h3>Target Process</h3>
        <div className="v2-controls-row">
          <button className="btn-secondary" onClick={loadProcesses} disabled={busy || attached}>
            Refresh Process List
          </button>
        </div>
        {processes.length > 0 && (
          <select
            aria-label="Select target process"
            value={selectedPid ?? ''}
            onChange={e => setSelectedPid(e.target.value ? Number(e.target.value) : null)}
            disabled={attached}
          >
            <option value="">Select a process…</option>
            {processes.map(p => (
              <option key={p.pid} value={p.pid}>{p.name} (PID {p.pid})</option>
            ))}
          </select>
        )}

        <label>
          <input
            type="checkbox"
            checked={userConfirmedOffline}
            onChange={e => setUserConfirmedOffline(e.target.checked)}
            disabled={attached}
          />
          {' '}I confirm this process is running single-player/offline, not connected to an online match.
        </label>

        <div className="v2-controls-row">
          {!attached ? (
            <button
              className="btn-primary"
              onClick={handleAttach}
              disabled={busy || !selectedPid || !userConfirmedOffline}
            >
              Attach
            </button>
          ) : (
            <button className="btn-danger" onClick={handleDetach} disabled={busy}>
              Detach
            </button>
          )}
        </div>

        {lastGuard && (
          <p className={lastGuard.allowed ? 'v2-meta' : 'v2-session-ended-notice'} role="status">
            Guard: {lastGuard.reason}
          </p>
        )}
      </section>

      {attached && savedControls.length > 0 && (
        <section className="v2-monitor-section" aria-label="Saved controls">
          <h3>Saved Controls</h3>
          <p className="v2-meta">
            Restart-stable controls discovered and verified for this game (module + pointer-chain
            offsets, not a raw session-specific address). Loading one fills in the manual
            read/write section below with its live-resolved address — you still review and confirm
            the write yourself.
          </p>
          <ul className="v2-scan-results" aria-label="Saved control list">
            {savedControls.map(c => (
              <li key={c.id}>
                <strong>{c.label}</strong> — {c.description}{' '}
                <button className="btn-secondary" onClick={() => handleUseControl(c)} disabled={busy}>
                  Load
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {attached && (
        <section className="v2-monitor-section" aria-label="Manual memory read/write">
          <h3>Manual Read/Write</h3>

          <label htmlFor="lm-address">Address (decimal or 0x-hex)</label>
          <input id="lm-address" type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="0x1a2b3c4d" />

          <label htmlFor="lm-datatype">Data type</label>
          <select id="lm-datatype" value={dataType} onChange={e => setDataType(e.target.value as (typeof DATA_TYPES)[number])}>
            {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <div className="v2-controls-row">
            <button className="btn-secondary" onClick={handleRead} disabled={busy || !address.trim()}>Read</button>
          </div>
          {readValue !== null && <p className="v2-meta">Current value: {readValue}</p>}

          <label htmlFor="lm-newvalue">New value</label>
          <input id="lm-newvalue" type="number" value={requestedValue} onChange={e => setRequestedValue(e.target.value)} />

          <div className="v2-controls-row">
            <button className="btn-secondary" onClick={handlePropose} disabled={busy || !address.trim() || requestedValue.trim() === ''}>
              Propose Write
            </button>
            {pendingProposal && (
              <button className="btn-primary" onClick={handleConfirm} disabled={busy}>
                Confirm &amp; Apply
              </button>
            )}
          </div>
        </section>
      )}

      {attached && (
        <section className="v2-monitor-section" aria-label="Memory scan (find value)">
          <h3>Scan for a Value (read-only)</h3>
          <p className="v2-meta">
            Finds addresses currently holding a value you tell it — e.g. your current in-game gold or
            health. Nothing is written during a scan. Use the comparison scan to narrow down after the
            value changes in-game, the same way Cheat Engine's scan workflow works.
          </p>

          <label htmlFor="lm-scan-first-value">First scan: exact value</label>
          <div className="v2-controls-row">
            <input
              id="lm-scan-first-value"
              type="number"
              value={scanTargetValue}
              onChange={e => setScanTargetValue(e.target.value)}
              placeholder="e.g. 100"
            />
            <button className="btn-secondary" onClick={handleScanFirst} disabled={busy || scanTargetValue.trim() === ''}>
              First Scan
            </button>
          </div>

          {hasScanned && (
            <>
              <label htmlFor="lm-scan-comparison">Next scan</label>
              <div className="v2-controls-row">
                <select
                  id="lm-scan-comparison"
                  value={scanComparison}
                  onChange={e => setScanComparison(e.target.value as (typeof COMPARISON_KINDS)[number])}
                >
                  {COMPARISON_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                {scanComparison === 'exact' && (
                  <input
                    type="number"
                    value={scanNextValue}
                    onChange={e => setScanNextValue(e.target.value)}
                    placeholder="new value"
                    aria-label="Next scan exact value"
                  />
                )}
                <button className="btn-secondary" onClick={handleScanNext} disabled={busy}>
                  Next Scan
                </button>
              </div>
            </>
          )}

          {scanInfo && <p className="v2-meta">{scanInfo}</p>}

          {scanMatches.length > 0 && (
            <ul className="v2-scan-results" aria-label="Scan results">
              {scanMatches.slice(0, SCAN_RESULTS_DISPLAY_LIMIT).map(m => (
                <li key={m.address}>
                  <code>{m.address}</code> = {m.value}{' '}
                  <button className="btn-secondary" onClick={() => handleUseMatch(m)} disabled={busy}>
                    Use this address
                  </button>
                </li>
              ))}
              {scanMatches.length > SCAN_RESULTS_DISPLAY_LIMIT && (
                <li className="v2-meta">…and {scanMatches.length - SCAN_RESULTS_DISPLAY_LIMIT} more (narrow further to see all)</li>
              )}
            </ul>
          )}
        </section>
      )}

      {attached && (
        <section className="v2-monitor-section" aria-label="Freeze value">
          <h3>Freeze Value (Infinite Health / Infinite Ammo style toggle)</h3>
          <p className="v2-meta">
            Continuously re-writes a value on an interval. The online-session guard is rechecked every
            tick — if it fails at any point, the freeze stops itself rather than continuing to write.
          </p>

          <label htmlFor="lm-freeze-value">Value to hold at the address above</label>
          <div className="v2-controls-row">
            <input
              id="lm-freeze-value"
              type="number"
              value={freezeValue}
              onChange={e => setFreezeValue(e.target.value)}
              disabled={!!freezeStatus?.active}
            />
            <input
              type="number"
              aria-label="Freeze interval in milliseconds"
              value={freezeIntervalMs}
              onChange={e => setFreezeIntervalMs(e.target.value)}
              disabled={!!freezeStatus?.active}
              title="Interval in milliseconds"
            />
            {!freezeStatus?.active ? (
              <button
                className="btn-primary"
                onClick={handleStartFreeze}
                disabled={busy || !address.trim() || freezeValue.trim() === ''}
              >
                Start Freeze
              </button>
            ) : (
              <button className="btn-danger" onClick={handleStopFreeze} disabled={busy}>
                Stop Freeze
              </button>
            )}
          </div>

          {freezeStatus && (
            <p className={freezeStatus.active ? 'v2-meta' : 'v2-session-ended-notice'} role="status">
              {freezeStatus.active
                ? `Active · ${freezeStatus.tickCount} tick(s) written · target ${freezeStatus.target?.address.address}`
                : `Inactive${freezeStatus.stopReason ? ` · stopped: ${freezeStatus.stopReason}` : ''}`}
              {freezeStatus.lastGuard && !freezeStatus.lastGuard.allowed ? ` · guard: ${freezeStatus.lastGuard.reason}` : ''}
            </p>
          )}
        </section>
      )}

      {message && <p className="v2-message" role="status">{message}</p>}

      <section className="v2-monitor-section v2-safety-section" aria-label="Safety information">
        <p className="v2-safety-notice">
          <strong>Safety:</strong> Attach and every write recheck that this session is confirmed
          single-player/offline and that the target process has no active non-loopback network
          connections. If either check fails, the operation is blocked — confirmation alone is
          never sufficient. No DLL injection, no kernel drivers, no anti-cheat interaction.
        </p>
      </section>
    </div>
  );
};

export default LiveMemoryTrainerPage;
