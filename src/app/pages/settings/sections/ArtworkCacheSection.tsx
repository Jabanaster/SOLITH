import React, { useEffect, useRef, useState } from 'react';

type StatusState = {
  running: boolean;
  active: number;
  completed: number;
  total: number;
  paused: boolean;
  cancelled: boolean;
};

const IDLE_STATUS: StatusState = { running: false, active: 0, completed: 0, total: 0, paused: false, cancelled: false };
const POLL_INTERVAL_MS = 1000;

export const ArtworkCacheSection: React.FC = () => {
  const [status, setStatus] = useState<StatusState>(IDLE_STATUS);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollStatus = async () => {
    const result = await window.electronAPI.artworkCacheStatus();
    if (!result.success) return;
    const next: StatusState = {
      running: result.running ?? false,
      active: result.active ?? 0,
      completed: result.completed ?? 0,
      total: result.total ?? 0,
      paused: result.paused ?? false,
      cancelled: result.cancelled ?? false,
    };
    setStatus(next);
    if (!next.running) stopPolling();
  };

  useEffect(() => {
    void pollStatus();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(() => {
      void pollStatus();
    }, POLL_INTERVAL_MS);
  };

  const handleRefresh = async () => {
    setError('');
    setMessage('');
    const result = await window.electronAPI.artworkCacheRefresh();
    if (!result.success) {
      setError(result.error === 'already_running' ? 'A refresh is already in progress.' : (result.error ?? 'Refresh failed.'));
      return;
    }
    setMessage(`Refreshing artwork for ${result.queued ?? 0} item(s)…`);
    startPolling();
    void pollStatus();
  };

  const handleRetryMissing = async () => {
    setError('');
    setMessage('');
    const result = await window.electronAPI.artworkCacheRetryMissing();
    if (!result.success) {
      setError(result.error === 'already_running' ? 'A refresh is already in progress.' : (result.error ?? 'Retry failed.'));
      return;
    }
    setMessage(`Retrying ${result.queued ?? 0} missing artwork item(s)…`);
    startPolling();
    void pollStatus();
  };

  const handleCheckCatalogUpdates = async () => {
    setError('');
    setMessage('');
    setCatalogSyncing(true);
    try {
      const result = await window.electronAPI.trainerCatalogSyncRemote();
      if (!result?.success) {
        setError(result?.error ?? 'Catalog update check failed.');
        return;
      }
      setMessage('Catalog is up to date.');
    } finally {
      setCatalogSyncing(false);
    }
  };

  const handlePauseResume = async () => {
    if (status.paused) {
      await window.electronAPI.artworkCacheResume();
    } else {
      await window.electronAPI.artworkCachePause();
    }
    void pollStatus();
  };

  const handleCancel = async () => {
    await window.electronAPI.artworkCacheCancel();
    void pollStatus();
  };

  return (
    <div className="settings-section">
      <p className="settings-field-hint">
        Only Solith-owned, explicitly licensed, or artwork you provide yourself may be cached locally under Solith's
        own app data folder. Third-party artwork (for example, a store's own CDN images) is not persisted here —
        fallback artwork is used instead when a source's reuse rights are unverified. Nothing is ever uploaded, and
        refreshing never removes a previously cached image until its replacement is successfully downloaded.
      </p>

      <div className="settings-field settings-actions">
        <button type="button" onClick={() => void handleRefresh()} disabled={status.running}>
          Refresh artwork
        </button>
        <button type="button" onClick={() => void handleRetryMissing()} disabled={status.running}>
          Retry missing artwork
        </button>
        <button type="button" onClick={() => void handleCheckCatalogUpdates()} disabled={catalogSyncing}>
          Check for catalog updates
        </button>
      </div>

      {status.total > 0 && (
        <div className="settings-field">
          <p className="settings-field-hint">
            {status.completed} / {status.total} processed{status.paused ? ' — paused' : ''}
            {status.cancelled ? ' — cancelled' : ''}
          </p>
          {status.running && (
            <div className="settings-actions">
              <button type="button" onClick={() => void handlePauseResume()}>
                {status.paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" onClick={() => void handleCancel()}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {message && <p className="settings-field-hint">{message}</p>}
      {error && <p className="settings-field-hint">{error}</p>}
    </div>
  );
};

export default ArtworkCacheSection;
