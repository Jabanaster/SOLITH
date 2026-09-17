import React, { useState, useEffect, useCallback } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { exportMemoryFeatureToYaml } from '../../core/definitions/export-definition.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import {
  addWatchListBookmark,
  listWatchListBookmarks,
  removeWatchListBookmark,
  type WatchListBookmark,
} from '../live-memory/watch-list-bookmarks.js';
import AddressDataResearchPanel from '../components/AddressDataResearchPanel.js';
import PointerMapPanel from '../components/PointerMapPanel.js';
import StructureDiscoveryPanel from '../components/StructureDiscoveryPanel.js';
import LiveCorrelationWatcherPanel from '../components/LiveCorrelationWatcherPanel.js';
import LiveToggleCardsPanel from '../components/LiveToggleCardsPanel.js';
import SinglePlayerWaiverModal from '../components/SinglePlayerWaiverModal.js';
import { ALL_GAMES } from '../../core/cheat-system/games.js';
import {
  buildLiveToggleCards,
  RESEARCH_PROMOTE_SEED_KEY,
  type LiveToggleCard,
  type ResearchPromoteSeed,
} from '../../core/live-memory/ct-promote.js';
import {
  buildProcessPickerOptions,
  describeProcessMatch,
  groupProcessPickerOptions,
  isSameProcessInstance,
  type ProcessPickerInstalledGame,
  type ProcessPickerSort,
} from '../live-memory/process-picker.js';
import { SessionSinglePlayerWaiverStore } from '../../core/live-memory/single-player-waiver-shared.js';
import type {
  CorrelationCandidate,
  CorrelationReport,
  PlayerCorrelationEvent,
} from '../../core/live-memory/live-correlation-watcher.js';

interface ProcessEntry {
  pid: number;
  name: string;
  executablePath?: string;
  parentPid?: number;
  parentProcessName?: string;
  startTime?: string;
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
  dataType?: string;
  scanMode?: string;
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

const LiveMemoryTrainerPage: React.FC<{ initialCatalogGameId?: string | null }> = ({ initialCatalogGameId }) => {
  const api = (window as any).electronAPI;
  const apiAvailable = typeof window !== 'undefined' && !!api;

  const [featureEnabled, setFeatureEnabled] = useState<boolean>(true);
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [installedGames, setInstalledGames] = useState<ProcessPickerInstalledGame[]>([]);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [processSearch, setProcessSearch] = useState('');
  const [processSort, setProcessSort] = useState<ProcessPickerSort>('az');
  const [showAllProcesses, setShowAllProcesses] = useState(false);
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);
  const [attached, setAttached] = useState(false);
  const [attachedExecutable, setAttachedExecutable] = useState('');
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
  const [correlationReport, setCorrelationReport] = useState<CorrelationReport | null>(null);
  const [correlationActive, setCorrelationActive] = useState(false);
  const [correlationFlashEvent, setCorrelationFlashEvent] = useState<string | null>(null);

  const [freezeValue, setFreezeValue] = useState('');
  const [freezeIntervalMs, setFreezeIntervalMs] = useState('200');
  const [speedhackMultiplier, setSpeedhackMultiplier] = useState('1');
  const [freezeStatus, setFreezeStatus] = useState<FreezeStatusView | null>(null);
  const [watchBookmarks, setWatchBookmarks] = useState<WatchListBookmark[]>([]);

  const [pointerScanDepth, setPointerScanDepth] = useState('3');
  const [pointerScanMaxOffset, setPointerScanMaxOffset] = useState('4096');
  const [pointerCandidates, setPointerCandidates] = useState<
    Array<{ moduleName: string; moduleOffset: string; offsets: number[]; depth: number }>
  >([]);
  const [pointerScanInfo, setPointerScanInfo] = useState('');

  const [savedControls, setSavedControls] = useState<SavedControl[]>([]);
  const [controlsChecked, setControlsChecked] = useState(false);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [toggleCards, setToggleCards] = useState<LiveToggleCard[]>([]);
  const [waiverStore] = useState(() => new SessionSinglePlayerWaiverStore());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESEARCH_PROMOTE_SEED_KEY);
      if (!raw) return;
      const seed = JSON.parse(raw) as ResearchPromoteSeed;
      if (!seed.moduleName || !seed.baseOffset) return;
      const cards = buildLiveToggleCards([
        {
          id: `promote-${seed.label ?? 'seed'}`,
          label: seed.label ?? 'Promoted path',
          dataType: 'float',
          moduleName: seed.moduleName,
          baseOffset: seed.baseOffset,
          pointerChain: seed.pointerChain ?? [],
          liveResolution: seed.liveResolution ?? 'resolvable',
          defaultValue: 100,
          source: 'research',
        },
      ]);
      setToggleCards(cards);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setWatchBookmarks(listWatchListBookmarks());
  }, []);

  const refreshWatchBookmarks = useCallback(() => {
    setWatchBookmarks(listWatchListBookmarks());
  }, []);

  const processOptions = buildProcessPickerOptions({
    processes,
    catalogGames: ALL_GAMES,
    installedGames,
    currentCatalogGameId: initialCatalogGameId ?? null,
    showAllProcesses,
    sort: processSort,
    search: processSearch,
  });

  const processGroups = groupProcessPickerOptions(processOptions);
  const selectedProcessVisible = selectedPid == null || processOptions.some((option) => option.pid === selectedPid);

  const handleBookmarkCurrent = () => {
    if (!address.trim()) return;
    addWatchListBookmark({
      label: `Scan @ ${address.trim()}`,
      address: address.trim(),
      dataType,
    });
    refreshWatchBookmarks();
    setMessage('Address bookmarked in watch list.');
  };

  const handleUseBookmark = (bookmark: WatchListBookmark) => {
    setAddress(bookmark.address);
    setDataType(bookmark.dataType as (typeof DATA_TYPES)[number]);
    setMessage(`Loaded bookmark: ${bookmark.label}`);
  };

  useEffect(() => {
    if (!apiAvailable) {
      setFeatureEnabled(false);
      return;
    }
    api.getSettings().then((s: any) => {
      setFeatureEnabled(s?.v2FreeformMemoryEnabled !== false && s?.v2LiveModeEnabled !== false);
    }).catch(() => setFeatureEnabled(true));
  }, [apiAvailable, api]);

  useEffect(() => {
    if (!apiAvailable || !api?.getGames) return;
    let cancelled = false;
    void api.getGames()
      .then((games: ProcessPickerInstalledGame[]) => {
        if (!cancelled && Array.isArray(games)) setInstalledGames(games);
      })
      .catch(() => {
        if (!cancelled) setInstalledGames([]);
      });
    return () => { cancelled = true; };
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

  useEffect(() => {
    if (!initialCatalogGameId || !apiAvailable) return;
    let cancelled = false;
    void (async () => {
      const result = await api.trainerCatalogLoadGame?.({ catalogGameId: initialCatalogGameId });
      const exe = result?.config?.executable ?? result?.entry?.executables?.[0];
      if (!cancelled && exe) {
        setMessage(`Catalog game loaded — look for ${exe} in the process list.`);
        const listResult = await api.liveMemoryListProcesses?.();
        if (listResult?.success) setProcesses(listResult.processes ?? []);
        const match = listResult?.processes?.find(
          (p: ProcessEntry) => p.name.toLowerCase() === exe.toLowerCase(),
        );
        if (match) setSelectedPid(match.pid);
      }
    })();
    return () => { cancelled = true; };
  }, [initialCatalogGameId, apiAvailable, api]);

  const handleAttach = async () => {
    if (!selectedPid) return;
    const proc = processes.find(p => p.pid === selectedPid);
    if (!proc) return;

    setBusy(true);
    setMessage('');
    try {
      const refreshed = await api.liveMemoryListProcesses();
      const current = refreshed?.success ? refreshed.processes?.find((item: ProcessEntry) => item.pid === selectedPid) : null;
      if (!current || !isSameProcessInstance(proc, current)) {
        setProcesses(refreshed?.processes ?? []);
        setSelectedPid(null);
        setMessage('The selected process exited or changed identity. Refresh and select the game again.');
        return;
      }
      const result: AttachResult = await api.liveMemoryAttach({
        pid: selectedPid,
        executableName: proc.name,
        userConfirmedOffline,
      });
      setLastGuard(result.guard ?? null);
      if (result.success) {
        setAttached(true);
        setAttachedExecutable(proc.name);
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
      setAttachedExecutable('');
      setPendingProposal(null);
      setReadValue(null);
      setSavedControls([]);
      setControlsChecked(false);
      setCorrelationReport(null);
      setCorrelationActive(false);
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
      const consentResult = await api.liveMemoryIssueWriteConsent({
        proposalId: pendingProposal.proposalId,
        userConfirmed: true,
      });
      if (!consentResult?.success || !consentResult.consent?.tokenId) {
        setMessage(`Consent failed: ${consentResult?.error ?? 'unknown error'}`);
        return;
      }
      const result = await api.liveMemoryConfirmWrite({
        proposalId: pendingProposal.proposalId,
        consentToken: consentResult.consent.tokenId,
      });
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
      const numericValue = Number(scanTargetValue);
      const result = await api.liveMemoryScanFirstAutoMatrix({
        value: numericValue,
        min: numericValue,
        max: numericValue,
        includeUnknown: true,
        unknownKey: 'manual-live-memory-scan',
      });
      if (result?.success && result.result) {
        const seen = new Set<string>();
        const matches: ScanMatchEntry[] = [];
        for (const bucket of result.result.buckets) {
          if (bucket.skipped) continue;
          for (const match of bucket.matches) {
            const matchType = match.dataType ?? bucket.dataType;
            const key = `${match.address}:${matchType}:${bucket.mode}`;
            if (seen.has(key)) continue;
            seen.add(key);
            matches.push({
              address: match.address,
              value: match.value,
              dataType: matchType,
              scanMode: bucket.mode,
            });
          }
        }
        setScanMatches(matches);
        setHasScanned(true);
        setScanInfo(
          `${matches.length} match(es) across ${result.result.totals.buckets} auto bucket(s) · ` +
            `${result.result.totals.regionsScanned} region-pass(es) · ` +
            `${(result.result.totals.bytesScanned / (1024 * 1024)).toFixed(1)} MiB` +
            (result.result.totals.unknownCaptured ? ' · unknown baseline captured' : '') +
            (result.result.totals.truncatedBuckets > 0 ? ' · scan truncated by safety limits, results are partial' : ''),
        );
        setMessage('');
      } else {
        setMessage(`Auto scan failed: ${result?.error ?? 'unknown error'}`);
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
      const fallbackType = dataType;
      const groups = new Map<string, ScanMatchEntry[]>();
      for (const match of scanMatches) {
        const matchType = match.dataType ?? fallbackType;
        groups.set(matchType, [...(groups.get(matchType) ?? []), match]);
      }
      const narrowed: ScanMatchEntry[] = [];
      for (const [matchType, matches] of groups.entries()) {
        const result = await api.liveMemoryScanNext({ dataType: matchType, comparison, previous: matches });
        if (!result?.success) {
          setMessage(`Next scan failed: ${result?.error ?? 'unknown error'}`);
          return;
        }
        narrowed.push(...(result.matches ?? []).map((match: ScanMatchEntry) => ({ ...match, dataType: matchType })));
      }
      setScanMatches(narrowed);
      setScanInfo(`${narrowed.length} match(es) remaining after narrowing across ${groups.size} value type(s)`);
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const handleUseMatch = (match: ScanMatchEntry) => {
    setAddress(match.address);
    setReadValue(match.value);
    if (match.dataType && DATA_TYPES.includes(match.dataType as (typeof DATA_TYPES)[number])) {
      setDataType(match.dataType as (typeof DATA_TYPES)[number]);
    }
    setMessage(`Loaded ${match.address} into the manual read/write section below — review and propose from there.`);
  };

  useEffect(() => {
    if (!apiAvailable || !api.onLiveMemoryCorrelationReport) return undefined;
    return api.onLiveMemoryCorrelationReport((report: CorrelationReport) => {
      setCorrelationReport(report);
    });
  }, [apiAvailable, api]);

  useEffect(() => {
    if (!attached && correlationActive) {
      setCorrelationActive(false);
      setCorrelationReport(null);
    }
  }, [attached, correlationActive]);

  const handleStartCorrelationWatcher = async (candidates: CorrelationCandidate[]) => {
    if (!attached || candidates.length === 0) return;
    setBusy(true);
    try {
      const result = await api.liveMemoryCorrelationStart({
        candidates,
        pollIntervalMs: 100,
        reportIntervalMs: 333,
        eventLookbackMs: 1500,
        epsilon: 0.001,
      });
      if (result?.success) {
        setCorrelationActive(true);
        setCorrelationReport(result.report ?? null);
        setMessage(`Correlation watcher started on ${candidates.length} read-only candidate(s).`);
      } else {
        setMessage(`Correlation watcher failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleStopCorrelationWatcher = async () => {
    setBusy(true);
    try {
      const result = await api.liveMemoryCorrelationStop();
      if (result?.success) {
        setCorrelationActive(false);
        setMessage('Correlation watcher stopped.');
      } else {
        setMessage(`Correlation watcher stop failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCorrelationEvent = async (event: PlayerCorrelationEvent) => {
    if (!correlationActive) return;
    setCorrelationFlashEvent(event.kind);
    window.setTimeout(() => setCorrelationFlashEvent(null), 450);
    try {
      const result = await api.liveMemoryCorrelationEvent(event);
      if (result?.success) {
        setCorrelationReport(result.report ?? null);
      } else {
        setMessage(`Correlation event failed: ${result?.error ?? 'unknown error'}`);
      }
    } catch {
      setMessage('Correlation event failed.');
    }
  };

  const handlePointerScan = async () => {
    if (!address.trim()) return;
    setBusy(true);
    setPointerScanInfo('');
    setPointerCandidates([]);
    try {
      const result = await api.liveMemoryPointerScan({
        address: address.trim(),
        maxDepth: pointerScanDepth.trim() ? Number(pointerScanDepth) : undefined,
        maxOffsetPerLevel: pointerScanMaxOffset.trim() ? Number(pointerScanMaxOffset) : undefined,
      });
      if (result?.success && result.result) {
        setPointerCandidates(result.result.candidates);
        setPointerScanInfo(
          `Found ${result.result.candidates.length} candidate path(s) · depth ${result.result.levelsSearched} · ${result.result.scansPerformed} scan(s)${result.result.truncated ? ' · truncated' : ''}`,
        );
        setMessage('Pointer scan complete — review candidates below before exporting a definition.');
      } else {
        setMessage(`Pointer scan failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
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
      const baseInterval = freezeIntervalMs.trim() ? Number(freezeIntervalMs) : 200;
      const multiplier = Math.max(1, Math.min(8, Number(speedhackMultiplier) || 1));
      const intervalMs = Math.max(50, Math.floor(baseInterval / multiplier));
      const proposeResult = await api.liveMemoryFreezePropose({
        address: address.trim(),
        dataType,
        value: Number(freezeValue),
        intervalMs,
      });
      if (!proposeResult?.success || !proposeResult.proposal?.proposalId) {
        setMessage(`Freeze proposal failed: ${proposeResult?.error ?? 'unknown error'}`);
        return;
      }
      const consentResult = await api.liveMemoryFreezeRequestConsent({
        proposalId: proposeResult.proposal.proposalId,
      });
      if (!consentResult?.success || !consentResult.consent?.tokenId) {
        setMessage(`Freeze consent failed: ${consentResult?.error ?? 'unknown error'}`);
        return;
      }
      const result = await api.liveMemoryFreezeStart({
        proposalId: proposeResult.proposal.proposalId,
        consentToken: consentResult.consent.tokenId,
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

  const handleExportMemoryDefinition = () => {
    if (!attached || !address.trim() || !attachedExecutable) {
      setMessage('Attach to a process and enter a resolved address before exporting.');
      return;
    }
    const featureName = window.prompt('Feature name for this memory definition:', 'Discovered Stat')?.trim();
    if (!featureName) return;
    const bundle = exportMemoryFeatureToYaml({
      gameName: attachedExecutable.replace(/\.exe$/i, ''),
      executableName: attachedExecutable,
      featureName,
      dataType,
      sessionAddress: address.trim(),
      defaultValue: readValue ?? undefined,
    });
    downloadTextFile(bundle.filename, bundle.yaml);
    setMessage(`Exported ${bundle.filename} — review pointer stability before distributing.`);
  };

  const handleExportPointerCandidate = (
    candidate: { moduleName: string; moduleOffset: string; offsets: number[] },
  ) => {
    if (!attached || !attachedExecutable) return;
    const featureName = window.prompt('Feature name for this pointer path:', 'Pointer Feature')?.trim();
    if (!featureName) return;
    const moduleOffset = parseInt(candidate.moduleOffset.replace(/^0x/i, ''), 16);
    const bundle = exportMemoryFeatureToYaml({
      gameName: attachedExecutable.replace(/\.exe$/i, ''),
      executableName: attachedExecutable,
      featureName,
      dataType,
      sessionAddress: address.trim(),
      defaultValue: readValue ?? undefined,
      moduleName: candidate.moduleName,
      moduleOffset: Number.isFinite(moduleOffset) ? moduleOffset : undefined,
      pointerChain: candidate.offsets,
      featureType: 'toggle',
    });
    downloadTextFile(bundle.filename, bundle.yaml);
    setMessage(`Exported pointer path to ${bundle.filename} — restart-verify before marking verified.`);
  };

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
          <h2>Advanced Scan Mode</h2>
          <p className="v2-safety-notice">Full freeform memory editor — any process, any address, scan/narrow/freeze</p>
        </div>
        <div className="v2-monitor-disabled">
          <p><strong>Freeform memory editing is turned off in settings.</strong></p>
          <p>Enable <code>v2FreeformMemoryEnabled</code> and <code>v2LiveModeEnabled</code> in Solith settings.</p>
          <p className="v2-safety-notice">
            When enabled, this reads and writes a target process's memory using standard
            ReadProcessMemory/WriteProcessMemory only — no DLL injection, no kernel drivers,
            no anti-cheat interaction. Every attach and every write requires the single-player /
            private-play waiver. Connection counts may be shown as advisory info and do not
            automatically block writes after you accept responsibility.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-monitor-page">
      <PageModuleHeader
        artwork="trainerController"
        title={<>Advanced Scan Mode</>}
        description="Freeform ReadProcessMemory/WriteProcessMemory — scan any value, enter any address, freeze, pointer workflows"
        walkthroughId="live-memory-trainer"
      />

      <section className="v2-monitor-section" aria-label="Process selection">
        <h3>Target Process</h3>
        <div className="v2-controls-row">
          <button className="btn-secondary" onClick={loadProcesses} disabled={busy || attached}>
            Refresh Process List
          </button>
        </div>
        {processes.length > 0 && (
          <>
            <div className="v2-controls-row">
              <label htmlFor="lm-process-search">Search</label>
              <input
                id="lm-process-search"
                type="search"
                value={processSearch}
                onChange={e => setProcessSearch(e.target.value)}
                placeholder="Game title or executable…"
                disabled={attached}
              />
              <label htmlFor="lm-process-sort">Sort</label>
              <select
                id="lm-process-sort"
                aria-label="Process sort order"
                value={processSort}
                onChange={e => setProcessSort(e.target.value as ProcessPickerSort)}
                disabled={attached}
              >
                <option value="az">A–Z</option>
                <option value="za">Z–A</option>
                <option value="confidence">Confidence</option>
                <option value="recent">Recently detected</option>
                <option value="pid">PID</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={showAllProcesses}
                  onChange={(e) => setShowAllProcesses(e.target.checked)}
                  disabled={attached}
                />{' '}
                Show all processes
              </label>
            </div>
            <select
              id="live-memory-process-picker"
              aria-label="Select target process"
              value={selectedPid ?? ''}
              onChange={e => setSelectedPid(e.target.value ? Number(e.target.value) : null)}
              disabled={attached}
            >
              <option value="">Select a game process…</option>
              {processGroups.map(group => (
                <optgroup key={group.group} label={group.label}>
                  {group.options.map(p => (
                    <option key={p.pid} value={p.pid}>
                      {p.title} — {p.processName} (PID {p.pid}) — {describeProcessMatch(p)}{p.executablePath ? ' — ' + p.executablePath : ''}{p.parentProcessName ? ' — parent: ' + p.parentProcessName : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="v2-meta">
              Showing {processOptions.length} filtered candidate(s) from {processes.length} running process(es).
              Unknown/system/tool processes stay hidden unless “Show all processes” is enabled.
            </p>
            {!selectedProcessVisible && (
              <p className="v2-session-ended-notice" role="status">
                The selected process is hidden by the current search/filter. Clear the search or enable “Show all processes” before attaching.
              </p>
            )}
          </>
        )}

        <label>
          <input
            type="checkbox"
            checked={userConfirmedOffline}
            onChange={(e) => {
              if (e.target.checked) {
                const scope = processOptions.find((p) => p.pid === selectedPid)?.processName ?? 'global';
                if (waiverStore.isAccepted(scope)) {
                  setUserConfirmedOffline(true);
                } else {
                  setWaiverModalOpen(true);
                }
              } else {
                setUserConfirmedOffline(false);
              }
            }}
            disabled={attached}
          />
          {' '}I accept the single-player / private-play waiver (memory manipulation is my responsibility).
        </label>

        <div className="v2-controls-row">
          {!attached ? (
            <button
              className="btn-primary"
              onClick={handleAttach}
              disabled={busy || !selectedPid || !selectedProcessVisible || !userConfirmedOffline}
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
            <button
              className="btn-secondary"
              onClick={handleExportMemoryDefinition}
              disabled={busy || !address.trim()}
            >
              Export Definition
            </button>
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
        <section className="v2-monitor-section" aria-label="Pointer path discovery">
          <h3>Pointer Path Discovery</h3>
          <p className="v2-meta">
            Reverse-scans from the address above to find module + offset + pointer-chain candidates.
            Use this after you have a stable dynamic address from the value scan — export a definition
            once you confirm a path survives a game restart.
          </p>

          <div className="v2-controls-row">
            <label htmlFor="lm-pointer-depth">Max depth</label>
            <input
              id="lm-pointer-depth"
              type="number"
              min={1}
              max={6}
              value={pointerScanDepth}
              onChange={e => setPointerScanDepth(e.target.value)}
              disabled={busy || !address.trim()}
            />
            <label htmlFor="lm-pointer-offset">Max offset / level</label>
            <input
              id="lm-pointer-offset"
              type="number"
              min={256}
              max={65536}
              value={pointerScanMaxOffset}
              onChange={e => setPointerScanMaxOffset(e.target.value)}
              disabled={busy || !address.trim()}
            />
            <button
              className="btn-secondary"
              onClick={() => void handlePointerScan()}
              disabled={busy || !address.trim()}
            >
              Scan for Pointer Paths
            </button>
          </div>

          {pointerScanInfo && <p className="v2-meta">{pointerScanInfo}</p>}

          {pointerCandidates.length > 0 && (
            <ul className="v2-scan-results" aria-label="Pointer path candidates">
              {pointerCandidates.slice(0, 50).map((c, i) => (
                <li key={`${c.moduleName}-${c.moduleOffset}-${i}`}>
                  <code>
                    {c.moduleName}+{c.moduleOffset}
                    {c.offsets.length > 0 ? ` → [${c.offsets.map((o) => `0x${o.toString(16)}`).join(', ')}]` : ''}
                  </code>
                  {' '}(depth {c.depth}){' '}
                  <button className="btn-secondary" onClick={() => handleExportPointerCandidate(c)} disabled={busy}>
                    Export YAML
                  </button>
                </li>
              ))}
              {pointerCandidates.length > 50 && (
                <li className="v2-meta">…and {pointerCandidates.length - 50} more (narrow depth/offset to refine)</li>
              )}
            </ul>
          )}
        </section>
      )}

      <PointerMapPanel attached={attached} attachedExecutable={attachedExecutable || null} />
      <StructureDiscoveryPanel attached={attached} processName={attachedExecutable || 'unknown'} pid={selectedPid} />

      {attached && (
        <section className="v2-monitor-section" aria-label="Memory scan (find value)">
          <h3>Scan for a Value (read-only)</h3>
          <p className="v2-meta">
            Finds addresses currently holding a value you tell it — e.g. your current in-game gold or
            health. Nothing is written during a scan. Use the comparison scan to narrow down after the
            value changes in-game, the same way advanced memory scan workflows operate.
          </p>

          <label htmlFor="lm-scan-first-value">First scan: current value</label>
          <div className="v2-controls-row">
            <input
              id="lm-scan-first-value"
              type="number"
              value={scanTargetValue}
              onChange={e => setScanTargetValue(e.target.value)}
              placeholder="e.g. 100"
            />
            <button
              id="live-memory-auto-scan-all-types"
              className="btn-secondary"
              onClick={handleScanFirst}
              disabled={busy || scanTargetValue.trim() === ''}
            >
              Auto Scan All Types
            </button>
          </div>
          <p className="v2-meta">
            This scans exact, between, greater-than, and less-than buckets across byte, int32, uint32, float,
            double, and int64, and captures an unknown-value baseline. No manual value-type dropdown is used here.
          </p>

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
                <li key={`${m.address}-${m.dataType ?? dataType}-${m.scanMode ?? 'narrowed'}`}>
                  <code>{m.address}</code> = {m.value}{' '}
                  <span className="v2-meta">({m.dataType ?? dataType}{m.scanMode ? ` · ${m.scanMode}` : ''})</span>{' '}
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
        <LiveCorrelationWatcherPanel
          attached={attached}
          busy={busy}
          scanMatches={scanMatches}
          fallbackDataType={dataType}
          report={correlationReport}
          active={correlationActive}
          flashEvent={correlationFlashEvent}
          onStart={handleStartCorrelationWatcher}
          onStop={handleStopCorrelationWatcher}
          onEvent={handleCorrelationEvent}
        />
      )}

      {attached && (
        <section className="v2-monitor-section" aria-label="Watch list bookmarks">
          <h3>Watch List Bookmarks</h3>
          <p className="v2-meta">
            Save addresses you want to revisit during a session. Bookmarks are stored locally in this app only.
          </p>
          <div className="v2-controls-row">
            <button className="btn-secondary" onClick={handleBookmarkCurrent} disabled={busy || !address.trim()}>
              Bookmark current address
            </button>
          </div>
          {watchBookmarks.length > 0 ? (
            <ul className="v2-scan-results" aria-label="Saved bookmarks">
              {watchBookmarks.map((b) => (
                <li key={b.id}>
                  <strong>{b.label}</strong> — <code>{b.address}</code> ({b.dataType}){' '}
                  <button className="btn-secondary" onClick={() => handleUseBookmark(b)} disabled={busy}>
                    Load
                  </button>{' '}
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      removeWatchListBookmark(b.id);
                      refreshWatchBookmarks();
                    }}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="v2-meta">No bookmarks yet.</p>
          )}
        </section>
      )}

      {attached && (
        <section className="v2-monitor-section" aria-label="Freeze value">
          <h3>Freeze Value (Infinite Health / Infinite Ammo style toggle)</h3>
          <p className="v2-meta">
            Continuously re-writes a value on an interval. The online-session guard is rechecked every
            tick — if it fails at any point, the freeze stops itself rather than continuing to write.
            Optional speedhack divides the freeze interval (scoped to this panel only).
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
            <label htmlFor="lm-speedhack">Speedhack ×</label>
            <input
              id="lm-speedhack"
              type="number"
              min={1}
              max={8}
              value={speedhackMultiplier}
              onChange={e => setSpeedhackMultiplier(e.target.value)}
              disabled={!!freezeStatus?.active}
              title="Divides freeze interval (1–8)"
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

      {attached && (
        <>
          <LiveToggleCardsPanel
            attached={attached}
            cards={toggleCards}
            freezeActive={Boolean(freezeStatus?.active)}
            onResolve={async (card) => {
              const result = await api.researchResolvePath?.({
                moduleName: card.moduleName,
                baseOffset: card.baseOffset,
                pointerChain: card.pointerChain,
              });
              if (!result?.success || !result.address) {
                setMessage(result?.error ?? 'resolve failed');
                return null;
              }
              return result.address;
            }}
            onFreeze={async (addr, value, type) => {
              const proposeResult = await api.liveMemoryFreezePropose({
                address: addr,
                dataType: type,
                value,
                intervalMs: Number(freezeIntervalMs) || 200,
              });
              if (!proposeResult?.success || !proposeResult.proposal?.proposalId) {
                setMessage(proposeResult?.error ?? 'freeze proposal failed');
                return;
              }
              const consentResult = await api.liveMemoryFreezeRequestConsent({
                proposalId: proposeResult.proposal.proposalId,
              });
              if (!consentResult?.success || !consentResult.consent?.tokenId) {
                setMessage(consentResult?.error ?? 'freeze consent failed');
                return;
              }
              const result = await api.liveMemoryFreezeStart({
                proposalId: proposeResult.proposal.proposalId,
                consentToken: consentResult.consent.tokenId,
              });
              if (!result?.success) setMessage(result?.error ?? 'freeze failed');
              else {
                setFreezeStatus({
                  active: true,
                  tickCount: 0,
                  target: { address: { address: addr, dataType: type }, value },
                  lastGuard: null,
                });
                setMessage(`Freeze started @ ${addr}`);
              }
            }}
            onStopFreeze={async () => {
              await api.liveMemoryFreezeStop();
              setFreezeStatus({
                active: false,
                tickCount: freezeStatus?.tickCount ?? 0,
                stopReason: 'user_stopped',
                target: null,
                lastGuard: null,
              });
            }}
          />
          <AddressDataResearchPanel
            attached={attached}
            processName={attachedExecutable || 'unknown'}
            pid={selectedPid}
          />
        </>
      )}

      {message && <p className="v2-message" role="status">{message}</p>}

      <SinglePlayerWaiverModal
        open={waiverModalOpen}
        scopeKey={processOptions.find((p) => p.pid === selectedPid)?.processName ?? 'global'}
        store={waiverStore}
        onCancel={() => setWaiverModalOpen(false)}
        onAccept={() => {
          setUserConfirmedOffline(true);
          setWaiverModalOpen(false);
        }}
      />

      <section className="v2-monitor-section v2-safety-section" aria-label="Safety information">
        <p className="v2-safety-notice">
          <strong>Safety:</strong> Attach and writes require the single-player / private-play waiver.
          Connection observations are advisory after Trust Shift — you assume local responsibility.
          No DLL injection, no kernel drivers, no anti-cheat interaction. Audit log records
          <code> waiverAssumed</code> on modifications.
        </p>
      </section>
    </div>
  );
};

export default LiveMemoryTrainerPage;
