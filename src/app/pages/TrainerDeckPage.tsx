import React, { useCallback, useEffect, useState } from 'react';
import styles from './TrainerDeckPage.module.css';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { RepairChecklist } from '../components/RepairChecklist.js';
import { GameSpecificCheatMenu } from '../components/GameSpecificCheatMenu.js';
import { initializeCheatSystem, getGameConfig, registerGame } from '../../core/cheat-system/index.js';
import type { GameConfig } from '../../core/cheat-system/types.js';
import TrainerControlPanel from './TrainerControlPanel.js';
import type { TrainerControl } from '../../core/trainer-host/trainer-control-schema.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import type { TrainerDeckRow } from '../../core/trainer-deck/build-deck-rows.js';
import { downloadTextFile } from '../utils/download-text-file.js';

type HealthStatus = 'working' | 'stale' | 'unknown' | 'metadata_only' | 'quarantined';

function healthLabel(status: HealthStatus): string {
  switch (status) {
    case 'working':
      return 'Working';
    case 'stale':
      return 'Stale — re-verify';
    case 'quarantined':
      return 'Quarantined';
    case 'metadata_only':
      return 'Metadata only';
    default:
      return 'Unknown';
  }
}

function healthClass(status: HealthStatus): string {
  switch (status) {
    case 'working':
      return styles.healthWorking;
    case 'stale':
    case 'quarantined':
      return styles.healthStale;
    default:
      return styles.healthUnknown;
  }
}

export default function TrainerDeckPage({
  catalogGameId,
  displayName,
  onOpenLiveTrainer,
  onBack,
  detectedPid,
}: {
  catalogGameId: string;
  displayName?: string;
  onOpenLiveTrainer?: (catalogGameId: string) => void;
  onBack?: () => void;
  detectedPid?: number | null;
}) {
  const [entry, setEntry] = useState<TrainerCatalogEntry | null>(null);
  const [rows, setRows] = useState<TrainerDeckRow[]>([]);
  const [controls, setControls] = useState<TrainerControl[]>([]);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('unknown');
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [installedPath, setInstalledPath] = useState<string | null>(null);
  const [saveFilePath, setSaveFilePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [certifyResult, setCertifyResult] = useState<string | null>(null);
  const [cheatGame, setCheatGame] = useState<GameConfig | null>(null);
  const [offlineConfirmed, setOfflineConfirmed] = useState(false);

  const loadDeck = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      await window.electronAPI?.trainerCatalogSeed?.();
      await window.electronAPI?.trainerCatalogLoadGame?.({ catalogGameId });
      const result = await window.electronAPI?.trainerDeckGet?.({ catalogGameId });
      if (!result?.success) {
        setMessage(result?.error ?? 'Could not load trainer deck.');
        return;
      }
      setEntry((result.entry as TrainerCatalogEntry | undefined) ?? null);
      setRows((result.rows as TrainerDeckRow[]) ?? []);
      setControls((result.controls as TrainerControl[]) ?? []);
      const health = result.health as { status?: HealthStatus; staleReason?: string } | undefined;
      setHealthStatus(health?.status ?? 'unknown');
      setStaleReason(health?.staleReason ?? null);
      const installed = result.installed as { installPath?: string } | undefined;
      setInstalledPath(installed?.installPath ?? null);

      initializeCheatSystem();
      const local = getGameConfig(catalogGameId);
      if (local) {
        setCheatGame(local);
      } else {
        const loadResult = await window.electronAPI?.trainerCatalogLoadGame?.({ catalogGameId });
        if (loadResult?.success && loadResult.config) {
          registerGame(loadResult.config);
          setCheatGame(loadResult.config);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [catalogGameId]);

  useEffect(() => {
    void loadDeck();
    void window.electronAPI?.catalogProcessWatchActive?.({ active: true });
    return () => {
      void window.electronAPI?.catalogProcessWatchActive?.({ active: false });
    };
  }, [loadDeck]);

  const title = displayName ?? entry?.displayName ?? catalogGameId;
  const memoryRows = rows.filter((r) => r.kind === 'memory');
  const saveRows = rows.filter((r) => r.kind === 'save');

  const handleOpenInstallFolder = async () => {
    const result = await window.electronAPI?.installDiscoveryOpenPath?.({ catalogGameId });
    if (!result?.success) setMessage(result?.error ?? 'Could not open install folder.');
  };

  const handleCertifyL1 = async () => {
    const result = await window.electronAPI?.trainerCatalogCertifyL1?.({ catalogGameId });
    if (!result?.success && !result?.schemaValid) {
      setCertifyResult(result?.errors?.join(', ') ?? result?.error ?? 'L1 certify failed');
      return;
    }
    setCertifyResult(
      result?.success
        ? 'Offline L1 certify passed (schema, resolution, backup path).'
        : `L1 issues: ${result?.errors?.join(', ') ?? 'see logs'}`,
    );
    await window.electronAPI?.trainerHealthCheck?.({ catalogGameId });
    void loadDeck();
  };

  const handleExport = async () => {
    const result = await window.electronAPI?.trainerCatalogExportDefinition?.({ catalogGameId });
    if (result?.success && result.yaml && result.filename) {
      downloadTextFile(result.filename, result.yaml);
      setMessage(`Exported definition for ${title}.`);
    } else {
      setMessage(result?.error ?? 'Export failed.');
    }
  };

  const handleNotify = async () => {
    const result = await window.electronAPI?.catalogDemandNotify?.({ catalogGameId, kind: 'notify' });
    if (result?.success) {
      setMessage(`Notify recorded — ${result.demand?.notifyCount ?? 1} local request(s) for ${title}.`);
    }
  };

  const handleApproveSavePath = async () => {
    if (!saveFilePath.trim()) return;
    const result = await window.electronAPI?.trainerCatalogApproveSavePath?.({
      catalogGameId,
      saveFilePath: saveFilePath.trim(),
    });
    setMessage(result?.success ? 'Save path approved.' : result?.error ?? 'Approve failed.');
  };

  if (loading) {
    return <p className={styles.loading}>Loading trainer deck…</p>;
  }

  return (
    <div className={styles.page}>
      <PageModuleHeader
        artwork="trainerController"
        title={title}
        description="Trainer deck — cheats, certification, and repair workflow"
        actions={
          <div className={styles.headerActions}>
            {onBack && (
              <button type="button" className={styles.secondaryBtn} onClick={onBack}>
                ← Library
              </button>
            )}
            <button type="button" className={styles.secondaryBtn} onClick={() => void handleExport()}>
              Export YAML
            </button>
            {installedPath && (
              <button type="button" className={styles.secondaryBtn} onClick={() => void handleOpenInstallFolder()}>
                Open install folder
              </button>
            )}
          </div>
        }
      />

      <div className={`${styles.healthStrip} ${healthClass(healthStatus)}`} role="status">
        <span>{healthLabel(healthStatus)}</span>
        {staleReason && <span className={styles.healthReason}> · {staleReason}</span>}
        {detectedPid != null && <span className={styles.healthReason}> · PID {detectedPid} detected</span>}
        {entry && <span className={styles.healthReason}> · {entry.verificationStatus}</span>}
      </div>

      {message && <p className={styles.message}>{message}</p>}
      {certifyResult && <p className={styles.certify}>{certifyResult}</p>}

      {(healthStatus === 'stale' || healthStatus === 'quarantined') && (
        <div className={styles.staleBanner}>
          <p>Trainer may be outdated after a game patch. Run offline checks before live use.</p>
          <button type="button" className={styles.primaryBtn} onClick={() => void handleCertifyL1()}>
            Run offline L1 certify
          </button>
        </div>
      )}

      <div className={styles.toolbar}>
        {memoryRows.length > 0 && (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => onOpenLiveTrainer?.(catalogGameId)}
          >
            Open Live Trainer {detectedPid != null ? `(attach PID ${detectedPid})` : ''}
          </button>
        )}
        {entry?.verificationStatus !== 'verified' && (
          <button type="button" className={styles.secondaryBtn} onClick={() => void handleNotify()}>
            Notify when verified
          </button>
        )}
      </div>

      {memoryRows.length > 0 && cheatGame && (
        <section className={styles.section} aria-label="Live cheats">
          <h2>Live cheats</h2>
          {!offlineConfirmed && (
            <label className={styles.offlineConfirm}>
              <input type="checkbox" checked={offlineConfirmed} onChange={(e) => setOfflineConfirmed(e.target.checked)} />
              I confirm this is offline single-player only
            </label>
          )}
          {offlineConfirmed && (
            <GameSpecificCheatMenu game={cheatGame} userConfirmedOffline={offlineConfirmed} />
          )}
        </section>
      )}

      {memoryRows.length > 0 && !cheatGame && (
        <section className={styles.section} aria-label="Memory features">
          <h2>Memory features</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Cert</th>
                <th>Hotkey</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {memoryRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.category}</td>
                  <td>{row.certificationLevel}</td>
                  <td>{row.hotkeyHint ?? '—'}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {saveRows.length > 0 && controls.length > 0 && (
        <section className={styles.section} aria-label="Save controls">
          <h2>Save controls</h2>
          <TrainerControlPanel
            autoStart
            controls={controls}
            panelTitle={`${title} — Save Controls`}
            saveFilePath={saveFilePath}
            onSaveFilePathChange={setSaveFilePath}
            onApproveSavePath={() => void handleApproveSavePath()}
          />
        </section>
      )}

      {rows.length === 0 && (
        <p className={styles.empty}>No cheats in definition yet — sync community listings or import YAML/CT.</p>
      )}

      <RepairChecklist showLiveRitual={healthStatus === 'stale'} />
    </div>
  );
}
