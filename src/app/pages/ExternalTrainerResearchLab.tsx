import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import {
  buildTrainerResearchExportBundle,
  type MemoryDiffCandidate,
  type TrainerExeAnalysis,
} from '../../core/trainer-research/index.js';
import { UEDUMPER_REFERENCE } from '../../core/ue-research/types.js';
import { SCRIPT_RESEARCH_CHARTER } from '../../core/script-research/types.js';
import type { AaScriptAnalysis, CtScriptResearchReport, MergedUeScriptHint } from '../../core/script-research/types.js';
import { IN_PROCESS_SCRIPT_MILESTONE } from '../../core/in-process-script/charter.js';
import { planHookFromScriptAnalysis } from '../../core/in-process-script/aa-hook-planner.js';
import type {
  HookInstallManifest,
  HookInstallProposal,
  InjectorLaunchProposal,
} from '../../core/in-process-script/types.js';
import type { SolithDefinitionV1 } from '../../core/definitions/schema.v1.js';
import { PublishDefinitionModal } from '../components/PublishDefinitionModal.js';
import AddressDataResearchPanel from '../components/AddressDataResearchPanel.js';

interface ProcessEntry {
  pid: number;
  name: string;
}

const SCAN_KEY = 'external-trainer-research';
const UNKNOWN_DATA_TYPES = ['float', 'int32', 'double'];
const DISPLAY_LIMIT = 150;

const ExternalTrainerResearchLab: React.FC = () => {
  const api = window.electronAPI;
  const apiAvailable = !!api;

  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [publishDefinition, setPublishDefinition] = useState<SolithDefinitionV1 | null>(null);

  const [trainerPath, setTrainerPath] = useState('');
  const [trainerAnalysis, setTrainerAnalysis] = useState<TrainerExeAnalysis | null>(null);

  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);
  const [attached, setAttached] = useState(false);
  const [attachedExecutable, setAttachedExecutable] = useState('');

  const [baselineCaptured, setBaselineCaptured] = useState(false);
  const [baselineStats, setBaselineStats] = useState<{ regionsScanned: number; bytesScanned: number; truncated: boolean } | null>(null);
  const [rawCandidates, setRawCandidates] = useState<Array<{ address: string; value: number; dataType: string }>>([]);
  const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(new Set());
  const [exportTitle, setExportTitle] = useState('Researched Trainer Pack');

  const [labels, setLabels] = useState<Record<string, { label: string; category: string; featureType?: 'scan_unknown' | 'freeze' | 'write_once' }>>({});

  const [dumpspaceDir, setDumpspaceDir] = useState('');
  const [dumpspaceTitle, setDumpspaceTitle] = useState('UE Game Research');
  const [dumpspaceExecutable, setDumpspaceExecutable] = useState('Game-Win64-Shipping.exe');
  const [dumpspaceResult, setDumpspaceResult] = useState<{
    cheatCount: number;
    offsetCount: number;
    classCount: number;
    structCount: number;
    notes: string[];
  } | null>(null);

  const [ctFilePath, setCtFilePath] = useState('');
  const [ctXmlText, setCtXmlText] = useState('');
  const [ctReport, setCtReport] = useState<CtScriptResearchReport | null>(null);
  const [selectedScriptName, setSelectedScriptName] = useState('');
  const [aobScanAddress, setAobScanAddress] = useState('');
  const [mergedHints, setMergedHints] = useState<MergedUeScriptHint[]>([]);
  const [inProcessEnabled, setInProcessEnabled] = useState(false);
  const [inProcessApproved, setInProcessApproved] = useState(false);
  const [hookProposal, setHookProposal] = useState<HookInstallProposal | null>(null);
  const [hookManifest, setHookManifest] = useState<HookInstallManifest | null>(null);
  const [injectorProposal, setInjectorProposal] = useState<InjectorLaunchProposal | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await api?.getSettings?.();
        setFeatureEnabled(settings?.v2FreeformMemoryEnabled !== false && settings?.v2LiveModeEnabled !== false);
        setInProcessEnabled(settings?.inProcessScriptExecutionEnabled === true);
      } catch {
        setFeatureEnabled(true);
      }
    })();
  }, [api]);

  const refreshProcesses = useCallback(async () => {
    if (!api?.liveMemoryListProcesses) return;
    const result = await api.liveMemoryListProcesses();
    if (result.success && result.processes) {
      setProcesses(result.processes);
    }
  }, [api]);

  useEffect(() => {
    void refreshProcesses();
  }, [refreshProcesses]);

  const pickDumpspaceFolder = async () => {
    if (!api?.trainerResearchPickDumpspaceFolder) return;
    setBusy(true);
    setMessage('');
    setDumpspaceResult(null);
    try {
      const picked = await api.trainerResearchPickDumpspaceFolder();
      if (!picked.success || !picked.folderPath) {
        if (picked.error !== 'cancelled') setMessage(picked.error ?? 'Folder pick failed');
        return;
      }
      setDumpspaceDir(picked.folderPath);
      setMessage('Dumpspace folder selected. Review title/executable, then import to Trainer Library.');
    } finally {
      setBusy(false);
    }
  };

  const importDumpspaceToLibrary = async () => {
    if (!api?.trainerResearchImportDumpspace || !dumpspaceDir) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.trainerResearchImportDumpspace({
        dumpspaceDir,
        title: dumpspaceTitle.trim() || 'UE Game Research',
        executable: dumpspaceExecutable.trim() || 'Game-Win64-Shipping.exe',
      });
      if (!result.success) {
        setMessage(result.errors?.join(' ') ?? result.error ?? 'Dumpspace import failed');
        return;
      }
      setDumpspaceResult({
        cheatCount: result.cheatCount ?? 0,
        offsetCount: result.offsetCount ?? 0,
        classCount: result.classCount ?? 0,
        structCount: result.structCount ?? 0,
        notes: result.notes ?? [],
      });
      setMessage(
        `Imported ${result.cheatCount ?? 0} UE research features from Dumpspace (${result.catalogGameId}). Open Trainer Library to review.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const pickCtForScriptResearch = async () => {
    if (!api?.trainerResearchPickCt) return;
    setBusy(true);
    setMessage('');
    setCtReport(null);
    setMergedHints([]);
    try {
      const picked = await api.trainerResearchPickCt();
      if (!picked.success || !picked.xmlText) {
        if (picked.error !== 'cancelled') setMessage(picked.error ?? 'CT pick failed');
        return;
      }
      setCtFilePath(picked.filePath ?? '');
      setCtXmlText(picked.xmlText);
      const analyzed = await api.trainerResearchAnalyzeCtScripts?.({ xmlText: picked.xmlText });
      if (analyzed?.success && analyzed.report) {
        setCtReport(analyzed.report);
        setDumpspaceExecutable(analyzed.report.executable);
        setDumpspaceTitle(analyzed.report.title);
        const friendship = analyzed.report.scripts.find((s) => /friendship/i.test(s.cheatName));
        setSelectedScriptName(friendship?.cheatName ?? analyzed.report.scripts[0]?.cheatName ?? '');
        setMessage(`Script Research Analyzer: ${analyzed.report.analyzedScripts} scripts parsed.`);
      } else {
        setMessage(analyzed?.error ?? 'Script analysis failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const importCtScriptsToLibrary = async () => {
    if (!ctXmlText || !api?.trainerCatalogImportCt) return;
    setBusy(true);
    try {
      const result = await api.trainerCatalogImportCt({
        xmlText: ctXmlText,
        title: ctReport?.title,
      });
      if (result.success) {
        setMessage(
          `Imported "${result.title}" — ${result.cheatCount ?? 0} metadata cheats, ${result.scriptAnalysisCount ?? 0} scripts analyzed.`,
        );
      } else {
        setMessage(result.errors?.join('; ') ?? result.error ?? 'CT import failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const mergeUeWithScripts = async () => {
    if (!api?.trainerResearchMergeUeScripts || !dumpspaceDir || !ctXmlText) return;
    setBusy(true);
    try {
      const result = await api.trainerResearchMergeUeScripts({
        dumpspaceDir,
        xmlText: ctXmlText,
        title: dumpspaceTitle,
        executable: dumpspaceExecutable,
      });
      if (result.success && result.merged) {
        setMergedHints(result.merged);
        setMessage(`Merged ${result.merged.length} UE + script research hints.`);
      } else {
        setMessage(result.error ?? 'Merge failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const scanSelectedScriptAob = async () => {
    if (!api?.liveMemoryScanAob || !attached || !selectedScript) return;
    const aob = selectedScript.aobScans[0];
    if (!aob) {
      setMessage('Selected script has no AOB pattern.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.liveMemoryScanAob({
        signature: aob.patternSolith,
        moduleName: aob.module,
      });
      if (result.success && result.found && result.address) {
        setAobScanAddress(result.address);
        setMessage(`Read-only AOB hit for ${aob.symbol} at ${result.address} (hook site reference — not injected).`);
      } else if (result.success) {
        setAobScanAddress('');
        setMessage('AOB not found in attached process (game patch or module mismatch).');
      } else {
        setMessage(result.error ?? 'AOB scan failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const selectedScript: AaScriptAnalysis | undefined = useMemo(() => {
    if (!ctReport) return undefined;
    return ctReport.scripts.find((s) => s.cheatName === selectedScriptName) ?? ctReport.scripts[0];
  }, [ctReport, selectedScriptName]);

  const selectedHookPlan = useMemo(() => {
    if (!selectedScript || !ctReport) return null;
    return planHookFromScriptAnalysis(selectedScript, ctReport.executable);
  }, [selectedScript, ctReport]);

  const enableInProcessPilot = async () => {
    if (!api?.setSetting) return;
    await api.setSetting('inProcessScriptExecutionEnabled', true);
    setInProcessEnabled(true);
    setMessage(
      'In-process script execution enabled (Crimson Desert pilot). Requires offline confirm + per-action approval.',
    );
  };

  const proposeHookInstall = async () => {
    if (!api?.inProcessProposeHook || !selectedHookPlan || !inProcessApproved) return;
    setBusy(true);
    try {
      const result = await api.inProcessProposeHook({
        plan: selectedHookPlan,
        userApprovedAction: true,
      });
      if (result.success && result.proposal) {
        setHookProposal(result.proposal);
        setMessage(`Hook proposal staged for ${selectedHookPlan.cheatName}. Confirm to patch process memory.`);
      } else {
        setMessage(result.error ?? 'Hook proposal failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmHookInstall = async () => {
    if (!api?.inProcessConfirmHook || !hookProposal || !inProcessApproved) return;
    setBusy(true);
    try {
      const result = await api.inProcessConfirmHook({
        proposalId: hookProposal.proposalId,
        userApprovedAction: true,
      });
      if (result.success && result.manifest) {
        setHookManifest(result.manifest);
        setHookProposal(null);
        setMessage(`Hook installed at ${result.manifest.hookSite} (code cave ${result.manifest.caveAddress}).`);
      } else {
        setMessage(result.error ?? result.guard?.reason ?? 'Hook install failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const rollbackHookInstall = async () => {
    if (!api?.inProcessRollbackHook) return;
    setBusy(true);
    try {
      const result = await api.inProcessRollbackHook();
      if (result.success) {
        setHookManifest(null);
        setMessage('Hook rolled back — original bytes restored.');
      } else {
        setMessage(result.error ?? 'Rollback failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const proposeInjectorFromTrainerPath = async () => {
    if (!api?.inProcessProposeInjectorLaunch || !trainerPath || !inProcessApproved) return;
    setBusy(true);
    try {
      const result = await api.inProcessProposeInjectorLaunch({
        exePath: trainerPath,
        userConfirmedOffline: true,
        userApprovedAction: true,
      });
      if (result.success && result.proposal) {
        setInjectorProposal(result.proposal);
        setMessage(`Injector launch proposal for ${result.proposal.fileName}. Confirm to spawn externally.`);
      } else {
        setMessage(result.error ?? 'Injector proposal failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmInjectorLaunch = async () => {
    if (!api?.inProcessConfirmInjectorLaunch || !injectorProposal || !inProcessApproved) return;
    setBusy(true);
    try {
      const result = await api.inProcessConfirmInjectorLaunch({
        proposalId: injectorProposal.proposalId,
        userApprovedAction: true,
      });
      if (result.success) {
        setInjectorProposal(null);
        setMessage(
          `Trainer launched (pid ${result.pid ?? 'unknown'}). Solith did not inject — attach to CrimsonDesert.exe separately.`,
        );
      } else {
        setMessage(result.error ?? 'Injector launch failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const pickTrainerExe = async () => {
    if (!api?.trainerResearchPickExe) return;
    setBusy(true);
    setMessage('');
    try {
      const picked = await api.trainerResearchPickExe();
      if (!picked.success || !picked.filePath) {
        if (picked.error !== 'cancelled') setMessage(picked.error ?? 'Pick failed');
        return;
      }
      setTrainerPath(picked.filePath);
      const analyzed = await api.trainerResearchAnalyzeExe?.({ filePath: picked.filePath });
      if (analyzed?.success && analyzed.analysis) {
        setTrainerAnalysis(analyzed.analysis);
        setExportTitle(`${analyzed.analysis.fileName.replace(/\.exe$/i, '')} Research`);
        setMessage('Trainer metadata captured. Solith did not execute the file.');
        setStep(2);
      } else {
        setMessage(analyzed?.error ?? 'PE analysis failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const attachToGame = async () => {
    if (!api?.liveMemoryAttach || selectedPid == null) return;
    setBusy(true);
    setMessage('');
    try {
      const proc = processes.find((p) => p.pid === selectedPid);
      const result = await api.liveMemoryAttach({
        pid: selectedPid,
        executableName: proc?.name ?? 'Game.exe',
        userConfirmedOffline: true,
      });
      if (result.success) {
        setAttached(true);
        setAttachedExecutable(proc?.name ?? 'Game.exe');
        setMessage('Attached to game process (read-only until you export/import cheats).');
        setStep(3);
      } else {
        setMessage(result.error ?? result.guard?.reason ?? 'Attach failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const captureBaseline = async () => {
    if (!api?.liveMemoryScanFirstUnknown) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.liveMemoryScanFirstUnknown({ key: SCAN_KEY });
      if (!result.success) {
        setMessage(result.error ?? 'Baseline capture failed');
        return;
      }
      setBaselineCaptured(true);
      setBaselineStats({
        regionsScanned: result.regionsScanned ?? 0,
        bytesScanned: result.bytesScanned ?? 0,
        truncated: !!result.truncated,
      });
      setMessage(
        'Baseline captured. Toggle a cheat in your external trainer, then click Scan For Changes.',
      );
      setStep(4);
    } finally {
      setBusy(false);
    }
  };

  const scanForChanges = async () => {
    if (!api?.liveMemoryScanNextFromUnknown) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.liveMemoryScanNextFromUnknown({
        key: SCAN_KEY,
        dataTypes: UNKNOWN_DATA_TYPES,
        comparison: { kind: 'changed' },
        maxMatches: 2000,
      });
      if (!result.success || !result.result) {
        setMessage(result.error ?? 'Diff scan failed');
        return;
      }
      const matches = result.result.matches ?? [];
      setRawCandidates(matches);
      setSelectedAddresses(new Set(matches.slice(0, 12).map((m) => m.address)));
      setMessage(
        `Found ${matches.length} changed cells${result.result.truncated ? ' (truncated — narrow with another toggle)' : ''}.`,
      );
      setStep(5);
    } finally {
      setBusy(false);
    }
  };

  const labeledCandidates: MemoryDiffCandidate[] = useMemo(() => {
    return rawCandidates
      .filter((c) => selectedAddresses.has(c.address))
      .map((c, index) => {
        const meta = labels[c.address];
        return {
          id: `research-${index + 1}`,
          address: c.address,
          dataType: c.dataType,
          baselineValue: 0,
          currentValue: c.value,
          label: meta?.label ?? `Changed value @ ${c.address}`,
          category: meta?.category ?? 'Research',
          featureType: meta?.featureType ?? 'scan_unknown',
        };
      });
  }, [rawCandidates, selectedAddresses, labels]);

  const exportBundle = useMemo(() => {
    if (labeledCandidates.length === 0) return null;
    return buildTrainerResearchExportBundle({
      title: exportTitle,
      gameExecutable: attachedExecutable || 'Game.exe',
      trainerExePath: trainerPath || undefined,
      trainerSha256: trainerAnalysis?.sha256,
      candidates: labeledCandidates,
    });
  }, [labeledCandidates, exportTitle, attachedExecutable, trainerPath, trainerAnalysis]);

  const importToLibrary = async () => {
    if (!exportBundle || !api?.trainerCatalogImportCt) return;
    setBusy(true);
    try {
      const result = await api.trainerCatalogImportCt({
        xmlText: exportBundle.ctXml,
        title: exportTitle,
      });
      if (result.success) {
        setMessage(
          `Imported ${result.cheatCount ?? 0} cheats to Trainer Library as "${result.title}". Open Live Memory Trainer to verify with solo guards.`,
        );
      } else {
        setMessage(result.errors?.join('; ') ?? result.error ?? 'Import failed');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!apiAvailable) {
    return (
      <div className="discovery-lab-container">
        <PageModuleHeader
          artwork="hoodedProfile"
          title="External Trainer Research Lab"
          description="Desktop app required for PE analysis and live memory diffing."
        />
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="discovery-lab-container">
        <PageModuleHeader
          artwork="hoodedProfile"
          title="External Trainer Research Lab"
          description="Enable v2LiveModeEnabled and v2FreeformMemoryEnabled in settings."
        />
      </div>
    );
  }

  return (
    <div className="discovery-lab-container">
      <PageModuleHeader
        artwork="hoodedProfile"
        title="External Trainer Research Lab"
        description="Analyze a user-supplied trainer .exe (never executed), diff game memory while you toggle cheats externally, then export CT / schema drafts for Trainer Library."
      />

      <div className="glass" style={{ padding: '12px 16px', marginBottom: '20px', border: '1px solid #ffb30055' }}>
        <strong style={{ color: '#ffb300' }}>Safety charter</strong>
        <p style={{ margin: '8px 0 0', color: '#8892b0', fontSize: '13px' }}>
          Run the external trainer yourself outside Solith. Solith only reads PE metadata and attaches to the{' '}
          <em>game</em> process for memory diffing. No third-party trainer binaries are launched from this app.
        </p>
      </div>

      <div className="glass" style={{ padding: '20px', marginBottom: '20px', border: '1px solid #2d3a5c' }}>
        <h3 style={{ color: '#64ffda', marginTop: 0 }}>UEDumper Dumpspace import</h3>
        <p style={{ color: '#8892b0', fontSize: '13px', marginTop: 0 }}>
          Import JSON from{' '}
          <a href={UEDUMPER_REFERENCE.repository} target="_blank" rel="noreferrer" style={{ color: '#64ffda' }}>
            Spuckwaffel/UEDumper
          </a>{' '}
          ({UEDUMPER_REFERENCE.ueVersions}). Run UEDumper externally, then point Solith at the exported{' '}
          <code>Dumpspace/</code> folder. Solith imports struct offsets and global UE offsets as L0 research features — not the UEDumper binary or driver paths.
        </p>
        <ul style={{ color: '#8892b0', fontSize: '12px', margin: '0 0 12px', paddingLeft: '18px' }}>
          {UEDUMPER_REFERENCE.requiredPerGame.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div style={{ display: 'grid', gap: '12px', maxWidth: '560px' }}>
          <label style={{ color: '#e0e0e0', fontSize: '13px' }}>
            Game title
            <input
              value={dumpspaceTitle}
              onChange={(e) => setDumpspaceTitle(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '6px', padding: '8px', background: '#0d0d12', color: '#fff', border: '1px solid #2d3a5c' }}
            />
          </label>
          <label style={{ color: '#e0e0e0', fontSize: '13px' }}>
            Shipping executable
            <input
              value={dumpspaceExecutable}
              onChange={(e) => setDumpspaceExecutable(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '6px', padding: '8px', background: '#0d0d12', color: '#fff', border: '1px solid #2d3a5c' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void pickDumpspaceFolder()}>
            Pick Dumpspace folder
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!dumpspaceDir || busy}
            onClick={() => void importDumpspaceToLibrary()}
          >
            Import → Trainer Library
          </button>
        </div>
        {dumpspaceDir && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#8892b0', wordBreak: 'break-all' }}>
            Folder: {dumpspaceDir}
          </div>
        )}
        {dumpspaceResult && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#e0e0e0' }}>
            <div>
              {dumpspaceResult.cheatCount} research features · {dumpspaceResult.offsetCount} global offsets ·{' '}
              {dumpspaceResult.classCount} classes · {dumpspaceResult.structCount} structs
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: '18px', color: '#8892b0' }}>
              {dumpspaceResult.notes.slice(0, 6).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="glass" style={{ padding: '20px', marginBottom: '20px', border: '1px solid #2d3a5c' }}>
        <h3 style={{ color: '#64ffda', marginTop: 0 }}>Script Research Analyzer</h3>
        <p style={{ color: '#8892b0', fontSize: '13px', marginTop: 0 }}>
          Milestone authorized: extract AOB patterns and CE symbols from AssemblerScript. Solith never runs scripts or injects hooks.
          Replicate cheats via memory diff → pointer scan → <code>freeze</code> / <code>write_once</code> in schema.v1.
        </p>
        <ul style={{ color: '#8892b0', fontSize: '12px', margin: '0 0 12px', paddingLeft: '18px' }}>
          {SCRIPT_RESEARCH_CHARTER.authorized.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void pickCtForScriptResearch()}>
            Pick .CT &amp; analyze scripts
          </button>
          <button type="button" className="btn-primary" disabled={!ctXmlText || busy} onClick={() => void importCtScriptsToLibrary()}>
            Import CT metadata → Library
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!dumpspaceDir || !ctXmlText || busy}
            onClick={() => void mergeUeWithScripts()}
          >
            Merge UEDumper + scripts
          </button>
        </div>
        {ctFilePath && (
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#8892b0', wordBreak: 'break-all' }}>
            CT: {ctFilePath}
          </div>
        )}
        {ctReport && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '13px', color: '#e0e0e0', marginBottom: '8px' }}>
              {ctReport.analyzedScripts} scripts · {ctReport.allSymbols.length} registered symbols · executable{' '}
              <code>{ctReport.executable}</code>
            </div>
            <select
              value={selectedScriptName}
              onChange={(e) => setSelectedScriptName(e.target.value)}
              style={{ width: '100%', maxWidth: '520px', padding: '8px', background: '#0d0d12', color: '#fff', border: '1px solid #2d3a5c' }}
            >
              {ctReport.scripts.map((s) => (
                <option key={s.cheatName} value={s.cheatName}>
                  {s.cheatName} ({s.replicationStrategy})
                </option>
              ))}
            </select>
            {selectedScript && (
              <div style={{ marginTop: '12px', fontSize: '12px', color: '#e0e0e0' }}>
                <div>
                  <strong>Strategy:</strong> {selectedScript.replicationStrategy}
                  {selectedScript.usesCodeInjection ? ' · uses code injection (reference only)' : ''}
                </div>
                {selectedScript.aobScans[0] && (
                  <div style={{ marginTop: '6px' }}>
                    <strong>AOB {selectedScript.aobScans[0].symbol}:</strong>{' '}
                    <code>{selectedScript.aobScans[0].patternSolith}</code>
                  </div>
                )}
                {selectedScript.memoryOperandHints[0] && (
                  <div style={{ marginTop: '6px', color: '#ffb300' }}>
                    Memory hint: [{selectedScript.memoryOperandHints[0].register}+0x
                    {selectedScript.memoryOperandHints[0].offset.toString(16)}] (
                    {selectedScript.memoryOperandHints[0].operation})
                  </div>
                )}
                <ol style={{ margin: '10px 0 0', paddingLeft: '18px', color: '#8892b0' }}>
                  {selectedScript.workflowSteps.map((stepText) => (
                    <li key={stepText}>{stepText}</li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: '10px' }}
                  disabled={!attached || busy || selectedScript.aobScans.length === 0}
                  onClick={() => void scanSelectedScriptAob()}
                >
                  Read-only AOB scan (attached process)
                </button>
                {aobScanAddress && (
                  <div style={{ marginTop: '8px', color: '#64ffda' }}>
                    AOB address: <code>{aobScanAddress}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {mergedHints.length > 0 && (
          <div style={{ marginTop: '16px', maxHeight: '200px', overflow: 'auto', fontSize: '12px' }}>
            <strong style={{ color: '#64ffda' }}>UEDumper + script merge</strong>
            <ul style={{ color: '#8892b0', paddingLeft: '18px' }}>
              {mergedHints.slice(0, 6).map((hint) => (
                <li key={hint.cheatName}>
                  {hint.cheatName}
                  {hint.ueClassMember ? ` → ${hint.ueClassMember} @ 0x${hint.ueOffset?.toString(16)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="glass" style={{ padding: '20px', marginBottom: '20px', border: '1px solid #ff525255' }}>
        <h3 style={{ color: '#ff5252', marginTop: 0 }}>In-Process Script Execution (Crimson Desert pilot)</h3>
        <p style={{ color: '#8892b0', fontSize: '13px', marginTop: 0 }}>
          Milestone M: AA hook presets, code-cave install, and external trainer launch — gated by{' '}
          <code>inProcessScriptExecutionEnabled</code>, offline confirm, and per-action approval.
        </p>
        <ul style={{ color: '#8892b0', fontSize: '12px', paddingLeft: '18px' }}>
          {IN_PROCESS_SCRIPT_MILESTONE.safety.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {!inProcessEnabled ? (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void enableInProcessPilot()}>
            Enable in-process pilot (settings)
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ color: '#e0e0e0', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={inProcessApproved}
                onChange={(e) => setInProcessApproved(e.target.checked)}
              />{' '}
              I approve in-process hook / injector actions for this session (CrimsonDesert.exe pilot only)
            </label>
            {selectedHookPlan?.status === 'ready' && (
              <div style={{ fontSize: '12px', color: '#e0e0e0' }}>
                Executable preset: <code>{selectedHookPlan.presetId}</code> — {selectedHookPlan.cheatName}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!attached || !inProcessApproved || busy}
                    onClick={() => void proposeHookInstall()}
                  >
                    Propose hook install
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!hookProposal || !inProcessApproved || busy}
                    onClick={() => void confirmHookInstall()}
                  >
                    Confirm hook install
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!hookManifest || busy}
                    onClick={() => void rollbackHookInstall()}
                  >
                    Rollback hook
                  </button>
                </div>
              </div>
            )}
            {trainerPath && (
              <div style={{ fontSize: '12px', color: '#e0e0e0' }}>
                External trainer: <code>{trainerPath}</code>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!inProcessApproved || busy}
                    onClick={() => void proposeInjectorFromTrainerPath()}
                  >
                    Propose trainer launch
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!injectorProposal || !inProcessApproved || busy}
                    onClick={() => void confirmInjectorLaunch()}
                  >
                    Confirm trainer launch
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {message && (
        <div className="glass" style={{ padding: '12px', marginBottom: '16px', border: '1px solid #2d3a5c', color: '#e0e0e0' }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '6px',
              textAlign: 'center',
              fontSize: '12px',
              border: step === n ? '1px solid #64ffda' : '1px solid #2d3a5c',
              color: step === n ? '#64ffda' : '#8892b0',
            }}
          >
            {n === 1 && 'Trainer PE'}
            {n === 2 && 'Attach Game'}
            {n === 3 && 'Baseline'}
            {n === 4 && 'Toggle & Diff'}
            {n === 5 && 'Export'}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="glass" style={{ padding: '20px', border: '1px solid #2d3a5c' }}>
          <h3 style={{ color: '#64ffda', marginTop: 0 }}>Step 1 — Trainer metadata (read-only)</h3>
          <p style={{ color: '#8892b0', fontSize: '13px' }}>
            Pick a FLiNG/MrAntiFun/other trainer .exe on disk. Solith extracts PE headers and strings only.
          </p>
          <button type="button" className="btn-primary" onClick={() => void pickTrainerExe()} disabled={busy}>
            {busy ? 'Analyzing…' : 'Pick trainer .exe'}
          </button>
          {trainerAnalysis && (
            <div style={{ marginTop: '16px', fontSize: '13px', color: '#e0e0e0' }}>
              <div><strong>File:</strong> {trainerAnalysis.fileName}</div>
              <div><strong>SHA-256:</strong> <code>{trainerAnalysis.sha256}</code></div>
              <div><strong>Machine:</strong> {trainerAnalysis.machine ?? 'n/a'} · <strong>Subsystem:</strong> {trainerAnalysis.subsystem ?? 'n/a'}</div>
            </div>
          )}
        </div>
      )}

      {step >= 2 && (
        <div className="glass" style={{ padding: '20px', marginBottom: '16px', border: '1px solid #2d3a5c' }}>
          <h3 style={{ color: '#64ffda', marginTop: 0 }}>Step 2 — Attach to game (not trainer)</h3>
          <p style={{ color: '#8892b0', fontSize: '13px' }}>
            Start your game and external trainer manually. Select the <strong>game</strong> process here.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={selectedPid ?? ''}
              onChange={(e) => setSelectedPid(e.target.value ? Number(e.target.value) : null)}
              style={{ minWidth: '280px', padding: '8px', background: '#0d0d12', color: '#fff', border: '1px solid #2d3a5c' }}
            >
              <option value="">Select process…</option>
              {processes.map((p) => (
                <option key={p.pid} value={p.pid}>{p.name} (pid {p.pid})</option>
              ))}
            </select>
            <button type="button" className="btn-secondary" onClick={() => void refreshProcesses()}>Refresh</button>
            <label style={{ color: '#e0e0e0', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={userConfirmedOffline}
                onChange={(e) => setUserConfirmedOffline(e.target.checked)}
              />{' '}
              Solo / offline confirmed
            </label>
            <button type="button" className="btn-primary" disabled={!selectedPid || !userConfirmedOffline || attached || busy} onClick={() => void attachToGame()}>
              Attach
            </button>
          </div>
        </div>
      )}

      {attached && (
        <div className="glass" style={{ padding: '20px', marginBottom: '16px', border: '1px solid #2d3a5c' }}>
          <AddressDataResearchPanel
            attached={attached}
            processName={attachedExecutable || 'unknown'}
            pid={selectedPid}
          />
        </div>
      )}

      {step >= 3 && attached && (
        <div className="glass" style={{ padding: '20px', marginBottom: '16px', border: '1px solid #2d3a5c' }}>
          <h3 style={{ color: '#64ffda', marginTop: 0 }}>Step 3 — Baseline snapshot (cheat OFF)</h3>
          <p style={{ color: '#8892b0', fontSize: '13px' }}>
            Disable the cheat in your external trainer, then capture writable memory baseline.
          </p>
          <button type="button" className="btn-primary" disabled={busy || baselineCaptured} onClick={() => void captureBaseline()}>
            {baselineCaptured ? 'Baseline captured' : 'Capture baseline'}
          </button>
          {baselineStats && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#8892b0' }}>
              Scanned {baselineStats.bytesScanned.toLocaleString()} bytes across {baselineStats.regionsScanned} regions
              {baselineStats.truncated ? ' (truncated — large game footprint)' : ''}.
            </div>
          )}
        </div>
      )}

      {step >= 4 && baselineCaptured && (
        <div className="glass" style={{ padding: '20px', marginBottom: '16px', border: '1px solid #2d3a5c' }}>
          <h3 style={{ color: '#64ffda', marginTop: 0 }}>Step 4 — Toggle cheat & diff</h3>
          <p style={{ color: '#8892b0', fontSize: '13px' }}>
            Enable one cheat in your external trainer, then scan for changed values. Repeat per cheat if needed.
          </p>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void scanForChanges()}>
            Scan for changes
          </button>
        </div>
      )}

      {step >= 5 && rawCandidates.length > 0 && (
        <div className="glass" style={{ padding: '20px', border: '1px solid #2d3a5c' }}>
          <h3 style={{ color: '#64ffda', marginTop: 0 }}>Step 5 — Label & export</h3>
          <label style={{ display: 'block', marginBottom: '12px', color: '#e0e0e0', fontSize: '13px' }}>
            Pack title
            <input
              value={exportTitle}
              onChange={(e) => setExportTitle(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '6px', padding: '8px', background: '#0d0d12', color: '#fff', border: '1px solid #2d3a5c' }}
            />
          </label>

          <div style={{ maxHeight: '320px', overflow: 'auto', border: '1px solid #2d3a5c', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#16213e', color: '#64ffda' }}>
                  <th style={{ padding: '8px' }}>Use</th>
                  <th style={{ padding: '8px' }}>Address</th>
                  <th style={{ padding: '8px' }}>Type</th>
                  <th style={{ padding: '8px' }}>Value</th>
                  <th style={{ padding: '8px' }}>Label</th>
                  <th style={{ padding: '8px' }}>Schema type</th>
                </tr>
              </thead>
              <tbody>
                {rawCandidates.slice(0, DISPLAY_LIMIT).map((c) => (
                  <tr key={c.address} style={{ borderTop: '1px solid #2d3a5c' }}>
                    <td style={{ padding: '8px' }}>
                      <input
                        type="checkbox"
                        checked={selectedAddresses.has(c.address)}
                        onChange={(e) => {
                          setSelectedAddresses((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(c.address);
                            else next.delete(c.address);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px', fontFamily: 'monospace' }}>{c.address}</td>
                    <td style={{ padding: '8px' }}>{c.dataType}</td>
                    <td style={{ padding: '8px' }}>{c.value}</td>
                    <td style={{ padding: '8px' }}>
                      <input
                        value={labels[c.address]?.label ?? ''}
                        placeholder="Cheat name"
                        onChange={(e) =>
                          setLabels((prev) => ({
                            ...prev,
                            [c.address]: {
                              label: e.target.value,
                              category: prev[c.address]?.category ?? 'Research',
                              featureType: prev[c.address]?.featureType ?? 'scan_unknown',
                            },
                          }))
                        }
                        style={{ width: '100%', padding: '4px', background: '#0d0d12', color: '#fff', border: '1px solid #2d3a5c' }}
                      />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <select
                        value={labels[c.address]?.featureType ?? 'scan_unknown'}
                        onChange={(e) =>
                          setLabels((prev) => ({
                            ...prev,
                            [c.address]: {
                              label: prev[c.address]?.label ?? '',
                              category: prev[c.address]?.category ?? 'Research',
                              featureType: e.target.value as 'scan_unknown' | 'freeze' | 'write_once',
                            },
                          }))
                        }
                        style={{ padding: '4px', background: '#0d0d12', color: '#fff', border: '1px solid #2d3a5c' }}
                      >
                        <option value="scan_unknown">scan_unknown</option>
                        <option value="freeze">freeze</option>
                        <option value="write_once">write_once</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={!exportBundle}
              onClick={() => exportBundle && downloadTextFile(`${exportTitle}.CT`, exportBundle.ctXml)}
            >
              Download .CT
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!exportBundle}
              onClick={() => exportBundle && downloadTextFile(`${exportTitle}.schema.v1.json`, exportBundle.schemaJson)}
            >
              Download schema.v1
            </button>
            <button type="button" className="btn-primary" disabled={!exportBundle || busy} onClick={() => void importToLibrary()}>
              Import CT → Trainer Library
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!exportBundle || busy}
              onClick={() => {
                if (exportBundle) {
                  setPublishDefinition(JSON.parse(exportBundle.schemaJson) as SolithDefinitionV1);
                }
              }}
            >
              Publish to Community Hub
            </button>
          </div>
        </div>
      )}
      {publishDefinition && (
        <PublishDefinitionModal
          definition={publishDefinition}
          onClose={() => setPublishDefinition(null)}
          onPublished={(id) => {
            setPublishDefinition(null);
            setMessage(`Published to the Solith Hub as L0 Community definition ${id}.`);
          }}
        />
      )}
    </div>
  );
};

export default ExternalTrainerResearchLab;
