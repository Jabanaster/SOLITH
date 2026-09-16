import React, { useEffect, useRef, useState } from 'react';
import styles from './PointerMapPanel.module.css';
import { exportMemoryFeatureToYaml } from '../../core/definitions/export-definition.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import {
  completenessBadge,
  distinctModuleNames,
  filterPointerMapNodes,
  groupNodesByTarget,
  humanizeSnakeCase,
  isStaleReloadedNode,
  nodeStatusBadge,
  pointerMapDtoNodeChainSteps,
  sortPointerMapNodes,
  type PointerMapNodeSort,
  type PointerMapNodeStatus,
} from '../live-memory/pointer-map-ui.js';

export interface PointerMapPanelProps {
  attached: boolean;
  /** Used only as export provenance (mission §13 wires into the existing trainer-export path). */
  attachedExecutable?: string | null;
}

const EXPORT_DATA_TYPES = ['int32', 'uint32', 'float', 'double', 'int64', 'byte'] as const;
const STATUS_FILTER_OPTIONS: Array<PointerMapNodeStatus | 'all'> = [
  'all',
  'resolved',
  'unresolved',
  'module_missing',
  'read_failed',
  'process_exited',
];

function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
}

/** Badge span — mission §14: status is never communicated by color alone, the label text always carries the meaning. */
const Badge: React.FC<{ label: string; variant: 'safe' | 'caution' | 'risky' | 'blocked' }> = ({ label, variant }) => (
  <span className={`${styles.badge} ${styles[`badge-${variant}`]}`}>{label}</span>
);

const PointerMapPanel: React.FC<PointerMapPanelProps> = ({ attached, attachedExecutable = null }) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [maps, setMaps] = useState<PointerMapDto[]>([]);
  const [savedMaps, setSavedMaps] = useState<
    Array<{ mapId: string; name: string; nodeCount: number; gameId: string | null; createdAt: string; updatedAt: string }>
  >([]);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [newMapName, setNewMapName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [scanMaxDepth, setScanMaxDepth] = useState('3');
  const [scanMaxOffset, setScanMaxOffset] = useState('2048');
  // Default 16, not the scanner's own conservative default of 3 — real-process
  // testing (P2-2/P2-3 evidence) found the default routinely crowds a real
  // module-rooted path out among a real process's incidental pointer-shaped
  // bytes. Still a plain user-adjustable field, not a hidden override.
  const [scanMaxCandidatesPerLevel, setScanMaxCandidatesPerLevel] = useState('32');
  const [lastScanResult, setLastScanResult] = useState<PointerMapScanResultDto | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterTargetAddress, setFilterTargetAddress] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<PointerMapNodeStatus | 'all'>('all');
  const [filterModule, setFilterModule] = useState<string>('all');
  const [sortBy, setSortBy] = useState<PointerMapNodeSort>('order');
  const [exportDataType, setExportDataType] = useState<(typeof EXPORT_DATA_TYPES)[number]>('int32');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // P2-3.1 §5/§6 — real cancellation state. `scanOperationId` is the live
  // handle a Cancel click references; `scanActive` gates the Cancel
  // button's enabled state independently of `busy` (busy also covers every
  // other non-cancellable action in this panel).
  const [scanOperationId, setScanOperationId] = useState<string | null>(null);
  const [scanActive, setScanActive] = useState(false);
  // Guards against setState after unmount while a poll loop is in flight,
  // and lets the unmount cleanup below cancel any still-running backend
  // operation rather than leaving it to finish unobserved.
  const mountedRef = useRef(true);
  const activeOperationIdRef = useRef<string | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const inFlight = activeOperationIdRef.current;
      if (inFlight && api) void api.pointerMapScanCancel({ operationId: inFlight });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedMap = maps.find((m) => m.id === selectedMapId) ?? null;
  const selectedNode = selectedMap?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const loadMaps = async () => {
    if (!api) return;
    const result = await api.pointerMapList();
    if (result?.success && result.maps) {
      setMaps(result.maps);
      // Mission §10 — a map deleted or invalidated elsewhere must not leave a dangling selection.
      if (selectedMapId && !result.maps.some((m) => m.id === selectedMapId)) {
        setSelectedMapId(null);
        setSelectedNodeId(null);
      }
    } else if (!result?.success) {
      setMessage(`Failed to list pointer maps: ${result?.error ?? 'unknown error'}`);
    }
  };

  const loadSavedMaps = async () => {
    if (!api) return;
    const result = await api.pointerMapListSaved();
    if (result?.success && result.maps) setSavedMaps(result.maps);
  };

  useEffect(() => {
    void loadMaps();
    void loadSavedMaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached]);

  const handleCreateMap = async () => {
    if (!api || !newMapName.trim()) return;
    setBusy(true);
    try {
      const result = await api.pointerMapCreate({ name: newMapName.trim() });
      if (result?.success && result.map) {
        setNewMapName('');
        await loadMaps();
        setSelectedMapId(result.map.id);
        setLastScanResult(null);
        setMessage(`Created pointer map "${result.map.name}".`);
      } else {
        setMessage(`Failed to create pointer map: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSelectMap = (mapId: string) => {
    setSelectedMapId(mapId);
    setSelectedNodeId(null);
    setLastScanResult(null);
    setFilterTargetAddress('all');
    setFilterStatus('all');
    setFilterModule('all');
    const map = maps.find((m) => m.id === mapId);
    setRenameValue(map?.name ?? '');
  };

  const handleRenameMap = async () => {
    if (!api || !selectedMapId || !renameValue.trim()) return;
    setBusy(true);
    try {
      const result = await api.pointerMapRename({ mapId: selectedMapId, name: renameValue.trim() });
      if (result?.success) {
        await loadMaps();
        setMessage('Pointer map renamed.');
      } else {
        setMessage(`Rename failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteMap = async () => {
    if (!api || !selectedMap) return;
    const confirmed = window.confirm(`Delete pointer map "${selectedMap.name}"? This removes it from the active session. This cannot be undone.`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await api.pointerMapDelete({ mapId: selectedMap.id });
      if (result?.success) {
        setSelectedMapId(null);
        setSelectedNodeId(null);
        setLastScanResult(null);
        await loadMaps();
        setMessage(`Deleted pointer map "${selectedMap.name}".`);
      } else {
        setMessage(`Delete failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const SCAN_POLL_INTERVAL_MS = 200;

  /**
   * Real production cancellation (P2-3.1 §5/§6): starts the scan via
   * pointerMapScanStart (returns an operationId before any scanning has
   * happened), then polls pointerMapScanPoll until a terminal state —
   * exactly the same start/poll transport the byte-value scanner already
   * uses (liveMemoryScanFirstStart/liveMemoryScanPoll), reused rather than
   * a parallel mechanism. The scan itself (scanTargetsIntoMapCancellable)
   * genuinely runs in the background between polls, so Cancel reaches work
   * that is actually still executing, not a value already computed and
   * withheld from the renderer.
   */
  const handleScan = async () => {
    if (!api || !selectedMapId) return;
    const targets = targetInput
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (targets.length === 0) {
      setMessage('Enter at least one target address to scan.');
      return;
    }
    setBusy(true);
    setScanActive(true);
    setMessage('Scanning…');
    try {
      const bounds = {
        maxDepth: scanMaxDepth.trim() ? Number(scanMaxDepth) : undefined,
        maxOffsetPerLevel: scanMaxOffset.trim() ? Number(scanMaxOffset) : undefined,
        maxCandidatesPerLevel: scanMaxCandidatesPerLevel.trim() ? Number(scanMaxCandidatesPerLevel) : undefined,
      };
      const started = await api.pointerMapScanStart({ mapId: selectedMapId, targets, bounds });
      if (!started?.success || !started.operationId) {
        setMessage(`Scan failed: ${started?.error ?? 'unknown error'}`);
        setBusy(false);
        setScanActive(false);
        return;
      }
      activeOperationIdRef.current = started.operationId;
      setScanOperationId(started.operationId);
      await pollScanOperation(started.operationId);
    } catch (err) {
      if (mountedRef.current) setMessage(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
      setScanActive(false);
    }
  };

  const pollScanOperation = async (operationId: string) => {
    for (;;) {
      if (!api) return;
      const status = await api.pointerMapScanPoll({ operationId });
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
      if (status.result) {
        setLastScanResult(status.result);
        await loadMaps();
        const badge = completenessBadge(status.result.aggregateCompleteness);
        const suffix = status.result.resourceLimited ? ' — resource limit reached' : '';
        setMessage(
          status.status === 'cancelled'
            ? `Scan cancelled — ${status.result.targetsScanned}/${status.result.targetsRequested} target(s) reached, aggregate: ${badge.label}${suffix}.`
            : `Scanned ${status.result.targetsScanned}/${status.result.targetsRequested} target(s) — aggregate: ${badge.label}${suffix}.`,
        );
      } else {
        setMessage(status.status === 'cancelled' ? 'Scan cancelled before any target started.' : 'Scan finished with no result.');
      }
      break;
    }
    if (mountedRef.current) {
      setBusy(false);
      setScanActive(false);
      setScanOperationId(null);
    }
    activeOperationIdRef.current = null;
  };

  const handleCancelScan = async () => {
    if (!api || !scanOperationId) return;
    setMessage('Cancelling…');
    await api.pointerMapScanCancel({ operationId: scanOperationId });
    // The poll loop already in flight observes the resulting terminal state
    // and updates UI/busy/scanActive itself — this call only requests it.
  };

  const handleResolve = async () => {
    if (!api || !selectedMapId) return;
    setBusy(true);
    try {
      const result = await api.pointerMapResolve({ mapId: selectedMapId });
      if (result?.success) {
        await loadMaps();
        setMessage(`Resolved: ${result.resolvedCount ?? 0} succeeded, ${result.failedCount ?? 0} failed.`);
      } else {
        setMessage(`Resolve failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveNode = async (nodeId: string) => {
    if (!api || !selectedMapId) return;
    setBusy(true);
    try {
      const result = await api.pointerMapRemoveNode({ mapId: selectedMapId, nodeId });
      if (result?.success) {
        if (selectedNodeId === nodeId) setSelectedNodeId(null);
        await loadMaps();
      } else {
        setMessage(`Remove failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMap = async () => {
    if (!api || !selectedMapId) return;
    setBusy(true);
    try {
      const result = await api.pointerMapSave({ mapId: selectedMapId });
      if (result?.success) {
        await loadSavedMaps();
        setMessage('Pointer map saved.');
      } else {
        setMessage(`Save failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSavedMap = async (mapId: string) => {
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.pointerMapLoad({ mapId });
      if (result?.success && result.map) {
        await loadMaps();
        setSelectedMapId(result.map.id);
        setRenameValue(result.map.name);
        setLastScanResult(null);
        setMessage(`Loaded "${result.map.name}" — every node is unresolved until you Refresh against a live attach.`);
      } else {
        setMessage(`Load failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSavedMap = async (mapId: string, name: string) => {
    if (!api) return;
    const confirmed = window.confirm(`Permanently delete saved pointer map "${name}"? This cannot be undone.`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await api.pointerMapDeleteSaved({ mapId });
      if (result?.success) {
        await loadSavedMaps();
        setMessage(`Deleted saved map "${name}".`);
      } else {
        setMessage(`Delete failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (label: string, text: string) => {
    const ok = await copyToClipboard(text);
    setMessage(ok ? `Copied ${label}.` : `Could not copy ${label} — clipboard unavailable.`);
  };

  const handleExportNode = (node: PointerMapNodeDto) => {
    const featureName = window.prompt('Feature name for this pointer path:', node.label || 'Pointer Feature')?.trim();
    if (!featureName) return;
    const moduleOffset = Number.parseInt(node.path.moduleOffset.replace(/^0x/i, ''), 16);
    const bundle = exportMemoryFeatureToYaml({
      gameName: (attachedExecutable ?? 'unknown').replace(/\.exe$/i, ''),
      executableName: attachedExecutable ?? 'unknown.exe',
      featureName,
      dataType: exportDataType,
      sessionAddress: node.targetAddress ?? node.lastResolvedAddress ?? '0x0',
      moduleName: node.path.moduleName,
      moduleOffset: Number.isFinite(moduleOffset) ? moduleOffset : undefined,
      pointerChain: node.path.offsets,
      featureType: 'toggle',
    });
    downloadTextFile(bundle.filename, bundle.yaml);
    setMessage(`Exported ${bundle.filename} — restart-verify before marking verified.`);
  };

  if (!api) {
    return <div className={styles.panel}><p role="status">Electron API not available (browser mode).</p></div>;
  }

  const nodes = selectedMap?.nodes ?? [];
  const filtered = filterPointerMapNodes(nodes, {
    targetAddress: filterTargetAddress === 'all' ? undefined : filterTargetAddress === 'manual' ? null : filterTargetAddress,
    status: filterStatus === 'all' ? undefined : filterStatus,
    module: filterModule === 'all' ? undefined : filterModule,
  });
  const nodeGroups = groupNodesByTarget(sortPointerMapNodes(filtered, sortBy));
  // A target that was actually scanned but truthfully found zero candidates
  // must still be visible as its own group (mission §6/§15 — "zero
  // candidates complete" vs "zero candidates incomplete" must never be
  // silently absent) — groupNodesByTarget alone only sees populated nodes.
  const zeroResultTargets = (lastScanResult?.perTarget ?? [])
    .map((t) => t.targetAddress)
    .filter((addr) => !nodeGroups.some((g) => g.targetAddress === addr))
    .filter((addr) => filterTargetAddress === 'all' || filterTargetAddress === addr);
  const groups = [...nodeGroups, ...zeroResultTargets.map((targetAddress) => ({ targetAddress, nodes: [] as PointerMapNodeDto[] }))];
  const modules = distinctModuleNames(nodes);
  const allTargets = groupNodesByTarget(nodes).map((g) => g.targetAddress);

  return (
    <section className={styles.panel} aria-label="Pointer map visualization">
      <h3>Pointer Maps</h3>
      <p className={styles.meta}>
        Named, persistent collections of pointer chains across one or more targets — built on the
        real P2-1/P2-2 production model, not a second implementation. Scan a target's address (from
        the value-scan or manual read/write sections above) into a map, then inspect, resolve, and
        export chains here.
      </p>

      <div className={styles.row}>
        <label htmlFor="pm-map-select">Active map</label>
        <select
          id="pm-map-select"
          aria-label="Select pointer map"
          value={selectedMapId ?? ''}
          onChange={(e) => (e.target.value ? handleSelectMap(e.target.value) : setSelectedMapId(null))}
        >
          <option value="">Select a pointer map…</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.nodes.length} node{m.nodes.length === 1 ? '' : 's'})
            </option>
          ))}
        </select>
        <input
          type="text"
          value={newMapName}
          onChange={(e) => setNewMapName(e.target.value)}
          placeholder="New map name…"
          aria-label="New pointer map name"
        />
        <button className="btn-secondary" onClick={() => void handleCreateMap()} disabled={busy || !newMapName.trim()}>
          Create Map
        </button>
      </div>

      {savedMaps.length > 0 && (
        <div className={styles.row}>
          <label>Saved maps</label>
          <ul className={styles.savedList} aria-label="Saved pointer maps">
            {savedMaps.map((m) => (
              <li key={m.mapId}>
                {m.name} — {m.nodeCount} node{m.nodeCount === 1 ? '' : 's'}{' '}
                <button className="btn-secondary" onClick={() => void handleLoadSavedMap(m.mapId)} disabled={busy}>
                  Load
                </button>{' '}
                <button className="btn-danger" onClick={() => void handleDeleteSavedMap(m.mapId, m.name)} disabled={busy}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className={styles.meta} role="status">{message}</p>}

      {selectedMap && (
        <>
          <div className={styles.row}>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              aria-label="Rename pointer map"
            />
            <button className="btn-secondary" onClick={() => void handleRenameMap()} disabled={busy || !renameValue.trim()}>
              Rename
            </button>
            <button className="btn-secondary" onClick={() => void handleSaveMap()} disabled={busy}>
              Save
            </button>
            <button className="btn-secondary" onClick={() => void handleResolve()} disabled={busy || !attached}>
              Refresh / Resolve
            </button>
            <button className="btn-danger" onClick={() => void handleDeleteMap()} disabled={busy}>
              Delete Map
            </button>
          </div>

          <div className={styles.row}>
            <label htmlFor="pm-targets">Target address(es)</label>
            <input
              id="pm-targets"
              type="text"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              placeholder="0x1a2b3c4d, 0x5e6f7a8b — space or comma separated, up to 8"
              disabled={busy || !attached}
            />
            <label htmlFor="pm-scan-depth">Max depth</label>
            <input id="pm-scan-depth" type="number" min={1} max={6} value={scanMaxDepth} onChange={(e) => setScanMaxDepth(e.target.value)} disabled={busy || !attached} />
            <label htmlFor="pm-scan-offset">Max offset/level</label>
            <input id="pm-scan-offset" type="number" min={256} max={65536} value={scanMaxOffset} onChange={(e) => setScanMaxOffset(e.target.value)} disabled={busy || !attached} />
            <label htmlFor="pm-scan-candidates">Max candidates/level</label>
            <input
              id="pm-scan-candidates"
              type="number"
              min={1}
              max={64}
              value={scanMaxCandidatesPerLevel}
              onChange={(e) => setScanMaxCandidatesPerLevel(e.target.value)}
              disabled={busy || !attached}
              title="Raise this if a real, known-present pointer path isn't found — a real process has many incidental pointer-shaped bytes that can crowd out the real path at the default."
            />
            <button className="btn-primary" onClick={() => void handleScan()} disabled={busy || !attached || !targetInput.trim()}>
              Scan Into Map
            </button>
            <button className="btn-danger" onClick={() => void handleCancelScan()} disabled={!scanActive}>
              Cancel Scan
            </button>
          </div>
          {scanActive && (
            <p className={styles.meta} role="status">
              <Badge label="Scanning" variant="caution" /> Scan in progress — Cancel is available.
            </p>
          )}
          {!attached && <p className={styles.meta} role="status">Attach to a process above to scan or resolve this map.</p>}

          {lastScanResult && (
            <div className={styles.row}>
              <span className={styles.meta}>
                Aggregate completeness: <Badge {...completenessBadge(lastScanResult.aggregateCompleteness)} />
                {lastScanResult.resourceLimited && <Badge label="Resource Limit" variant="caution" />}
              </span>
            </div>
          )}

          <div className={styles.row}>
            <label htmlFor="pm-filter-target">Filter: target</label>
            <select id="pm-filter-target" value={filterTargetAddress} onChange={(e) => setFilterTargetAddress(e.target.value)}>
              <option value="all">All targets</option>
              {allTargets.map((t) => (
                <option key={t ?? 'manual'} value={t ?? 'manual'}>{t ?? 'Manually added'}</option>
              ))}
            </select>
            <label htmlFor="pm-filter-status">Filter: status</label>
            <select id="pm-filter-status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as PointerMapNodeStatus | 'all')}>
              {STATUS_FILTER_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All statuses' : nodeStatusBadge(s).label}</option>
              ))}
            </select>
            <label htmlFor="pm-filter-module">Filter: module</label>
            <select id="pm-filter-module" value={filterModule} onChange={(e) => setFilterModule(e.target.value)}>
              <option value="all">All modules</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label htmlFor="pm-sort">Sort</label>
            <select id="pm-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as PointerMapNodeSort)}>
              <option value="order">Scan order</option>
              <option value="depth">Depth</option>
              <option value="module">Module</option>
            </select>
          </div>

          <div className={styles.targetGroups} aria-label="Pointer map targets and candidates">
            {groups.length === 0 && <p className={styles.meta}>No nodes in this map yet — scan a target address above.</p>}
            {groups.map((group) => {
              const outcome = lastScanResult?.perTarget.find((t) => t.targetAddress === group.targetAddress);
              return (
                <div key={group.targetAddress ?? 'manual'} className={styles.targetGroup}>
                  <div className={styles.targetGroupHeader}>
                    <strong>{group.targetAddress ?? 'Manually added'}</strong>
                    <span className={styles.meta}> — {group.nodes.length} candidate{group.nodes.length === 1 ? '' : 's'}</span>
                    {outcome && (
                      <>
                        {' '}
                        <Badge {...completenessBadge(outcome.completeness)} />
                        <span className={styles.meta}> · {humanizeSnakeCase(outcome.termination)} · depth {outcome.deepestLevelCompleted}/{outcome.requestedDepth}</span>
                      </>
                    )}
                  </div>
                  {group.nodes.length === 0 && (
                    <p className={styles.meta}>
                      No candidates found —{' '}
                      {outcome && outcome.completeness.state !== 'complete'
                        ? `scan was incomplete (${completenessBadge(outcome.completeness).label}), absence is not authoritative.`
                        : 'scan completed with zero candidates.'}
                    </p>
                  )}
                  <ul className={styles.nodeList}>
                    {group.nodes.map((node) => {
                      const badge = nodeStatusBadge(node.status);
                      const stale = isStaleReloadedNode(node);
                      return (
                        <li key={node.id} className={selectedNodeId === node.id ? styles.nodeSelected : undefined}>
                          <button
                            className={styles.nodeButton}
                            onClick={() => setSelectedNodeId(node.id === selectedNodeId ? null : node.id)}
                            aria-pressed={selectedNodeId === node.id}
                          >
                            <code>
                              {node.path.moduleName}+{node.path.moduleOffset}
                              {node.path.offsets.length > 0 ? ` → [${node.path.offsets.map((o) => `${o < 0 ? '-' : '+'}0x${Math.abs(o).toString(16)}`).join(', ')}]` : ''}
                            </code>{' '}
                            (depth {node.depth}) <Badge {...badge} />
                            {stale && <Badge label="Stale — needs re-resolve" variant="caution" />}
                            {node.status === 'resolved' && node.lastResolvedAddress && (
                              <span className={styles.meta}> → {node.lastResolvedAddress}</span>
                            )}
                          </button>
                          <button className="btn-secondary" onClick={() => void handleRemoveNode(node.id)} disabled={busy}>
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          {selectedNode && (
            <div className={styles.detailPanel} aria-label="Selected pointer candidate detail">
              <h4>Chain Detail</h4>
              <dl>
                <dt>Candidate ID</dt><dd>{selectedNode.id}</dd>
                <dt>Target</dt><dd>{selectedNode.targetAddress ?? 'Manually added'}</dd>
                <dt>Module / root</dt><dd>{selectedNode.path.moduleName}+{selectedNode.path.moduleOffset}</dd>
                <dt>Depth</dt><dd>{selectedNode.depth}</dd>
                <dt>Resolution state</dt><dd><Badge {...nodeStatusBadge(selectedNode.status)} /></dd>
                <dt>Resolved address</dt>
                <dd>{selectedNode.status === 'resolved' ? selectedNode.lastResolvedAddress : '— (not currently resolved)'}</dd>
                <dt>Last resolved at</dt><dd>{selectedNode.lastResolvedAt ?? 'never'}</dd>
                <dt>Scan provenance</dt><dd>{selectedNode.scanId ?? 'manual'}</dd>
              </dl>

              <p className={styles.meta}>Chain steps:</p>
              <ol className={styles.chainSteps}>
                {pointerMapDtoNodeChainSteps(selectedNode).map((step, i) => (
                  <li key={i} className={step.isRoot ? styles.chainStepRoot : undefined}>{step.label}</li>
                ))}
                <li>= {selectedNode.status === 'resolved' ? selectedNode.lastResolvedAddress : '(unresolved)'}</li>
              </ol>

              <div className={styles.row}>
                <button className="btn-secondary" onClick={() => void handleCopy('module+offset chain', `${selectedNode.path.moduleName}+${selectedNode.path.moduleOffset}${selectedNode.path.offsets.length ? ' -> [' + selectedNode.path.offsets.map((o) => `0x${o.toString(16)}`).join(', ') + ']' : ''}`)}>
                  Copy Full Expression
                </button>
                <button className="btn-secondary" onClick={() => void handleCopy('module', selectedNode.path.moduleName)}>Copy Module</button>
                <button className="btn-secondary" onClick={() => void handleCopy('offset chain', selectedNode.path.offsets.map((o) => `0x${o.toString(16)}`).join(', '))}>Copy Offsets</button>
                {selectedNode.lastResolvedAddress && (
                  <button className="btn-secondary" onClick={() => void handleCopy('resolved address', selectedNode.lastResolvedAddress!)}>
                    Copy Resolved Address
                  </button>
                )}
              </div>

              <div className={styles.row}>
                <label htmlFor="pm-export-datatype">Export data type</label>
                <select id="pm-export-datatype" value={exportDataType} onChange={(e) => setExportDataType(e.target.value as (typeof EXPORT_DATA_TYPES)[number])}>
                  {EXPORT_DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button className="btn-primary" onClick={() => handleExportNode(selectedNode)}>Export to Trainer YAML</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default PointerMapPanel;
