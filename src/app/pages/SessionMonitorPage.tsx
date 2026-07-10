import React, { useState, useEffect, useCallback, useRef } from 'react';

type LifecycleState =
  | 'disabled' | 'idle' | 'game_not_running' | 'game_running' | 'observing'
  | 'external_session_observed' | 'resourceforge_session_connected'
  | 'session_ended_game_running' | 'game_exited' | 'stale_evidence'
  | 'error' | 'stopped';

interface MonitorStatus {
  state: LifecycleState;
  snapshot: {
    state: LifecycleState;
    confidence: string;
    gameIdentity: { pid: number; name: string; startTime: string } | null;
    externalSessionActive: boolean;
    evidenceSummary: string;
    observedAt: string;
  } | null;
  config: { gameId: string; executableName: string } | null;
  isRunning: boolean;
  startedAt: string | null;
  timelineEntryCount: number;
}

interface StartFormValues {
  executableName: string;
  markerFilePath: string;
}

const STATE_LABELS: Record<LifecycleState, string> = {
  disabled: 'Feature Disabled',
  idle: 'Idle',
  game_not_running: 'Game Not Running',
  game_running: 'Game Running',
  observing: 'Observing (Partial Evidence)',
  external_session_observed: 'External Session Detected',
  resourceforge_session_connected: 'Solith Session Connected',
  session_ended_game_running: 'Session Ended — Game Still Running',
  game_exited: 'Game Exited',
  stale_evidence: 'Stale Evidence',
  error: 'Error',
  stopped: 'Stopped',
};

const STATE_CLASSES: Record<LifecycleState, string> = {
  disabled: 'v2-state-neutral',
  idle: 'v2-state-neutral',
  game_not_running: 'v2-state-neutral',
  game_running: 'v2-state-active',
  observing: 'v2-state-active',
  external_session_observed: 'v2-state-session',
  resourceforge_session_connected: 'v2-state-session',
  session_ended_game_running: 'v2-state-warn',
  game_exited: 'v2-state-neutral',
  stale_evidence: 'v2-state-warn',
  error: 'v2-state-error',
  stopped: 'v2-state-neutral',
};

const POLL_INTERVAL_MS = 3000;

const SessionMonitorPage: React.FC = () => {
  const apiAvailable = typeof window !== 'undefined' && !!(window as any).electronAPI;

  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [startForm, setStartForm] = useState<StartFormValues>({
    executableName: '',
    markerFilePath: '',
  });
  const [message, setMessage] = useState<string>('');
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check feature flag on mount
  useEffect(() => {
    if (!apiAvailable) {
      setFeatureEnabled(false);
      return;
    }
    (window as any).electronAPI.getSettings().then((s: any) => {
      setFeatureEnabled(!!s?.v2SessionMonitorEnabled);
    }).catch(() => setFeatureEnabled(false));
  }, [apiAvailable]);

  // Poll monitor state while it's running
  const fetchStatus = useCallback(async () => {
    if (!apiAvailable) return;
    try {
      const s = await (window as any).electronAPI.v2MonitorGetState();
      setStatus(s);
    } catch {
      // ignore poll failures
    }
  }, [apiAvailable]);

  useEffect(() => {
    if (!apiAvailable || featureEnabled === null) return;
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [apiAvailable, featureEnabled, fetchStatus]);

  const handleStart = async () => {
    if (!apiAvailable || !startForm.executableName.trim()) return;
    setIsStarting(true);
    setMessage('');
    try {
      const payload: any = {
        gameId: 'demo-game-quest-id-000000000000',
        executableName: startForm.executableName.trim(),
      };
      if (startForm.markerFilePath.trim()) {
        payload.markerFilePath = startForm.markerFilePath.trim();
      }
      const result = await (window as any).electronAPI.v2MonitorStart(payload);
      if (result?.success) {
        setMessage('Monitoring started.');
        await fetchStatus();
      } else {
        setMessage(`Failed to start: ${result?.error ?? 'Unknown error'}`);
      }
    } catch (e) {
      setMessage(`Error: ${String(e)}`);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    if (!apiAvailable) return;
    try {
      await (window as any).electronAPI.v2MonitorStop();
      setMessage('Monitoring stopped.');
      await fetchStatus();
    } catch (e) {
      setMessage(`Error: ${String(e)}`);
    }
  };

  const handleClearTimeline = async () => {
    if (!apiAvailable) return;
    await (window as any).electronAPI.v2MonitorClearTimeline();
    setMessage('Timeline cleared.');
    await fetchStatus();
  };

  const handleExportDiagnostics = async () => {
    if (!apiAvailable) return;
    try {
      const data = await (window as any).electronAPI.v2MonitorExportDiagnostics();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resourceforge-v2-diagnostics-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(`Export failed: ${String(e)}`);
    }
  };

  if (!apiAvailable) {
    return (
      <div className="v2-monitor-page">
        <div className="v2-monitor-header">
          <h2>Session Lifecycle Monitor <span className="v2-badge">V2 Preview</span></h2>
          <p className="v2-safety-notice">Read-only session monitoring · No game modifications are performed</p>
        </div>
        <div className="v2-monitor-disabled">
          <p>Electron API not available (browser mode).</p>
        </div>
      </div>
    );
  }

  if (featureEnabled === false) {
    return (
      <div className="v2-monitor-page">
        <div className="v2-monitor-header">
          <h2>Session Lifecycle Monitor <span className="v2-badge">V2 Preview</span></h2>
          <p className="v2-safety-notice">Read-only session monitoring · No game modifications are performed</p>
        </div>
        <div className="v2-monitor-disabled">
          <p><strong>This feature is disabled.</strong></p>
          <p>
            To enable it, set <code>v2SessionMonitorEnabled</code> to <code>true</code> in
            Solith settings. It is disabled by default.
          </p>
          <p className="v2-safety-notice">
            When enabled, this panel observes publicly available system metadata (process list,
            local TCP connections, configured session-marker files). It takes no actions and
            does not modify any file or process.
          </p>
        </div>
      </div>
    );
  }

  const currentState: LifecycleState = status?.state ?? 'idle';
  const isRunning = status?.isRunning ?? false;
  const snap = status?.snapshot ?? null;

  return (
    <div className="v2-monitor-page">
      <div className="v2-monitor-header">
        <h2>Session Lifecycle Monitor <span className="v2-badge">V2 Preview</span></h2>
        <p className="v2-safety-notice">
          Read-only session monitoring · No game modifications are performed
        </p>
      </div>

      {/* ── State ── */}
      <section className="v2-monitor-section" aria-label="Current lifecycle state">
        <h3>Lifecycle State</h3>
        <div className={`v2-state-pill ${STATE_CLASSES[currentState]}`} role="status" aria-live="polite">
          {STATE_LABELS[currentState]}
        </div>
        {snap && (
          <>
            <p className="v2-evidence-summary">{snap.evidenceSummary}</p>
            <p className="v2-meta">Confidence: {snap.confidence} · Observed: {new Date(snap.observedAt).toLocaleTimeString()}</p>
          </>
        )}
        {/* Session-ended notification */}
        {currentState === 'session_ended_game_running' && (
          <div className="v2-session-ended-notice" role="alert">
            The observed trainer session ended. The game is still running.
          </div>
        )}
      </section>

      {/* ── Game Process ── */}
      <section className="v2-monitor-section" aria-label="Game process status">
        <h3>Game Process</h3>
        {snap?.gameIdentity ? (
          <dl className="v2-detail-list">
            <dt>Name</dt><dd>{snap.gameIdentity.name}</dd>
            <dt>PID</dt><dd>{snap.gameIdentity.pid}</dd>
            <dt>Started</dt><dd>{new Date(snap.gameIdentity.startTime).toLocaleString()}</dd>
          </dl>
        ) : (
          <p className="v2-meta">No game process detected</p>
        )}
      </section>

      {/* ── External Session ── */}
      <section className="v2-monitor-section" aria-label="External session status">
        <h3>External Session</h3>
        <p className={snap?.externalSessionActive ? 'v2-state-session' : 'v2-meta'}>
          {snap?.externalSessionActive
            ? 'External trainer session detected (not Solith-owned)'
            : 'No external session detected'}
        </p>
        <p className="v2-meta v2-external-note">
          Observed sessions belong to the external application that opened them.
          Solith does not own or control them.
        </p>
      </section>

      {/* ── Timeline ── */}
      <section className="v2-monitor-section" aria-label="Observation timeline">
        <h3>Timeline</h3>
        <p className="v2-meta">
          {status?.timelineEntryCount ?? 0} entries recorded
          {status?.startedAt ? ` · Started ${new Date(status.startedAt).toLocaleTimeString()}` : ''}
        </p>
      </section>

      {/* ── Controls ── */}
      <section className="v2-monitor-section" aria-label="Monitor controls">
        <h3>Controls</h3>

        {!isRunning && (
          <div className="v2-start-form">
            <label htmlFor="v2-exec-name">Executable name (e.g. guigubahuang.exe)</label>
            <input
              id="v2-exec-name"
              type="text"
              value={startForm.executableName}
              onChange={e => setStartForm(f => ({ ...f, executableName: e.target.value }))}
              placeholder="game.exe"
              aria-describedby="v2-exec-hint"
            />
            <p id="v2-exec-hint" className="v2-meta">
              Enter the exact game executable filename. No path required.
            </p>

            <label htmlFor="v2-marker-path">Session-marker file path (optional)</label>
            <input
              id="v2-marker-path"
              type="text"
              value={startForm.markerFilePath}
              onChange={e => setStartForm(f => ({ ...f, markerFilePath: e.target.value }))}
              placeholder="%APPDATA%\Wand\service-ports.json"
              aria-describedby="v2-marker-hint"
            />
            <p id="v2-marker-hint" className="v2-meta">
              Optional path to an external session-marker file to observe (read-only).
            </p>
          </div>
        )}

        <div className="v2-controls-row">
          {!isRunning ? (
            <button
              className="btn-primary"
              onClick={handleStart}
              disabled={isStarting || !startForm.executableName.trim()}
              aria-busy={isStarting}
            >
              {isStarting ? 'Starting…' : 'Start Monitoring'}
            </button>
          ) : (
            <button className="btn-danger" onClick={handleStop}>
              Stop Monitoring
            </button>
          )}

          <button className="btn-secondary" onClick={handleClearTimeline} disabled={!status}>
            Clear Timeline
          </button>

          <button className="btn-secondary" onClick={handleExportDiagnostics} disabled={!status}>
            Export Diagnostics
          </button>
        </div>

        {message && <p className="v2-message" role="status">{message}</p>}
      </section>

      {/* ── Safety ── */}
      <section className="v2-monitor-section v2-safety-section" aria-label="Safety information">
        <p className="v2-safety-notice">
          <strong>Safety:</strong> This panel observes publicly available system metadata only.
          It does not read process memory, inject code, send commands to the game or any external
          application, or modify any file outside Solith's own data directory.
          No game modifications are performed.
        </p>
      </section>
    </div>
  );
};

export default SessionMonitorPage;
