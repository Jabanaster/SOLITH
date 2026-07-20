import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Deterministic renderer-state fixture. This is unavailable in normal builds/runs.
  e2eTrainerState: process.env.NODE_ENV === 'test'
    ? (process.env.SOLITH_E2E_TRAINER_STATE ?? process.env.RESOURCEFORGE_E2E_TRAINER_STATE ?? null)
    : null,

  // Database operations
  getGames: () => ipcRenderer.invoke('get-games'),
  addGame: (gameData: any) => ipcRenderer.invoke('add-game', gameData),
  deleteGame: (gameId: string) => ipcRenderer.invoke('delete-game', gameId),
  scanGame: (gameId: string) => ipcRenderer.invoke('scan-game', gameId),
  getRecipes: (gameId: string) => ipcRenderer.invoke('get-recipes', gameId),
  createRecipe: (recipeData: any) => ipcRenderer.invoke('create-recipe', recipeData),
  getJournal: (gameId?: string) => ipcRenderer.invoke('get-journal', gameId),
  logEvent: (eventData: any) => ipcRenderer.invoke('log-event', eventData),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key: string, value: any) => ipcRenderer.invoke('set-setting', key, value),
  deleteRecipe: (recipeId: string) => ipcRenderer.invoke('delete-recipe', recipeId),
  getBackups: (gameId: string) => ipcRenderer.invoke('get-backups', gameId),
  restoreBackup: (backupId: string) => ipcRenderer.invoke('restore-backup', backupId),
  
  // Saves & Discovery & Proposal operations
  detectSaveFiles: (gameId: string) => ipcRenderer.invoke('detect-save-files', gameId),
  pickSaveFile: (gameId: string) => ipcRenderer.invoke('pick-save-file', gameId),
  parseSave: (gameId: string, filePath: string) => ipcRenderer.invoke('parse-save', gameId, filePath),
  compareSaves: (savePathA: string, savePathB: string, gameId?: string, knownOldValue?: any, knownNewValue?: any) => 
    ipcRenderer.invoke('compare-saves', savePathA, savePathB, gameId, knownOldValue, knownNewValue),
  compareSavesReport: (savePathA: string, savePathB: string, gameId?: string, knownOldValue?: any, knownNewValue?: any) =>
    ipcRenderer.invoke('compare-saves-report', savePathA, savePathB, gameId, knownOldValue, knownNewValue),
  createProposalForEdit: (gameId: string, filePath: string, path: string, oldValue: any, newValue: any, recipeId?: string) => 
    ipcRenderer.invoke('create-proposal-for-edit', gameId, filePath, path, oldValue, newValue, recipeId),
  applyProposal: (proposal: any) => ipcRenderer.invoke('apply-proposal', proposal),
  suggestDataEdits: (gameId: string, filePath: string) => ipcRenderer.invoke('suggest-data-edits', gameId, filePath),
  discoverSaveLocations: (gameId: string) => ipcRenderer.invoke('discover-save-locations', gameId),
  getSaveLocations: (gameId: string) => ipcRenderer.invoke('get-save-locations', gameId),
  approveSaveLocation: (locationId: string) => ipcRenderer.invoke('approve-save-location', locationId),
  revokeSaveLocation: (locationId: string) => ipcRenderer.invoke('revoke-save-location', locationId),
  addUserSelectedLocation: (gameId: string, path: string) => ipcRenderer.invoke('add-user-selected-location', gameId, path),

  // Game-running detection (read-only process check, no injection)
  checkGameRunning: (gameId: string) => ipcRenderer.invoke('check-game-running', gameId),

  // Compatibility profiles
  getCompatibilityProfile: (gameId: string) => ipcRenderer.invoke('get-compatibility-profile', gameId),
  getAllProfiles: () => ipcRenderer.invoke('get-all-profiles'),

  // V2 Session Lifecycle Monitor (read-only, disabled by default)
  v2MonitorStart: (payload: { gameId: string; executableName: string; markerFilePath?: string; pollIntervalMs?: number }) =>
    ipcRenderer.invoke('v2-monitor-start', payload),
  v2MonitorStop: () => ipcRenderer.invoke('v2-monitor-stop'),
  v2MonitorGetState: () => ipcRenderer.invoke('v2-monitor-get-state'),
  v2MonitorClearTimeline: () => ipcRenderer.invoke('v2-monitor-clear-timeline'),
  v2MonitorExportDiagnostics: () => ipcRenderer.invoke('v2-monitor-export-diagnostics'),

  // TrainerHost (file-read-only, Milestone C)
  trainerHostStart: () => ipcRenderer.invoke('trainer-host-start', {}),
  trainerHostStop: () => ipcRenderer.invoke('trainer-host-stop'),
  trainerHostGetStatus: () => ipcRenderer.invoke('trainer-host-get-status'),
  trainerHostReadField: (payload: { gameId: string; filePath: string; field: string }) =>
    ipcRenderer.invoke('trainer-host-read-field', payload),

  // TrainerHost write workflow (Milestone D/E)
  // propose → (user approves in UI) → approveAndWrite → rollback if needed
  trainerHostProposeWrite: (payload: { gameId: string; filePath: string; field: string; currentValue: string; newValue: string }) =>
    ipcRenderer.invoke('trainer-host-propose-write', payload),
  trainerHostApproveAndWrite: (payload: { proposalId: string }) =>
    ipcRenderer.invoke('trainer-host-approve-and-write', payload),
  trainerHostRollback: (payload: { gameId: string; filePath: string; backupPath: string; field: string }) =>
    ipcRenderer.invoke('trainer-host-rollback', payload),

  // Live Memory Trainer (V2, feature-flagged off by default, single-player/
  // offline only — see PROJECT_SPEC.md Section 3.1). Standard
  // ReadProcessMemory/WriteProcessMemory only; no injection.
  liveMemoryListProcesses: () => ipcRenderer.invoke('live-memory-list-processes'),
  liveMemoryAttach: (payload: { pid: number; executableName: string; userConfirmedOffline: true }) =>
    ipcRenderer.invoke('live-memory-attach', payload),
  liveMemoryZeroInputPrepare: (payload: {
    pid: number;
    executableName: string;
    catalogGameId: string;
    userConfirmedOffline: true;
    executableHashSHA256?: string;
    driftAcknowledged?: boolean;
    maxFuzzyDistance?: number;
    featureHints?: Record<string, string>;
  }) => ipcRenderer.invoke('live-memory-zero-input-prepare', payload),
  liveMemoryDetach: () => ipcRenderer.invoke('live-memory-detach'),
  liveMemoryRead: (payload: { address: string; dataType: string }) =>
    ipcRenderer.invoke('live-memory-read', payload),
  liveMemoryProposeWrite: (payload: { address: string; dataType: string; requestedValue: number }) =>
    ipcRenderer.invoke('live-memory-propose-write', payload),
  liveMemoryConfirmWrite: (payload: { proposalId: string }) =>
    ipcRenderer.invoke('live-memory-confirm-write', payload),
  liveMemoryRollback: (payload: { manifest: unknown }) =>
    ipcRenderer.invoke('live-memory-rollback', payload),
  liveMemoryScanFirst: (payload: {
    dataType: string;
    targetValue: number;
    maxRegionBytes?: number;
    maxTotalBytes?: number;
    maxMatches?: number;
  }) => ipcRenderer.invoke('live-memory-scan-first', payload),
  liveMemoryScanNext: (payload: {
    dataType: string;
    comparison: { kind: string; value?: number; min?: number; max?: number };
    previous: { address: string; value: number }[];
  }) => ipcRenderer.invoke('live-memory-scan-next', payload),
  liveMemoryScanFirstUnknown: (payload: { key: string; maxRegionBytes?: number; maxTotalBytes?: number }) =>
    ipcRenderer.invoke('live-memory-scan-first-unknown', payload),
  liveMemoryScanNextFromUnknown: (payload: {
    key: string;
    dataTypes: string[];
    comparison: { kind: string; value?: number; min?: number; max?: number };
    maxMatches?: number;
  }) => ipcRenderer.invoke('live-memory-scan-next-from-unknown', payload),
  liveMemoryReadMany: (payload: { addresses: { address: string; dataType: string }[] }) =>
    ipcRenderer.invoke('live-memory-read-many', payload),
  liveMemoryFreezeStart: (payload: { address: string; dataType: string; value: number; intervalMs?: number }) =>
    ipcRenderer.invoke('live-memory-freeze-start', payload),
  liveMemoryFreezeStop: () => ipcRenderer.invoke('live-memory-freeze-stop'),
  liveMemoryFreezeStatus: () => ipcRenderer.invoke('live-memory-freeze-status'),
  liveMemoryListControls: () => ipcRenderer.invoke('live-memory-list-controls'),
  liveMemoryResolveControl: (payload: { controlId: string }) =>
    ipcRenderer.invoke('live-memory-resolve-control', payload),
  liveMemoryResolveDefinitionFeature: (payload: { catalogGameId: string; featureId: string }) =>
    ipcRenderer.invoke('live-memory-resolve-definition-feature', payload),

  // Persisted cheat toggle state — survives a Solith restart (see
  // cheat-toggle-store.ts for why this is scoped to "app restart", not "game restart").
  cheatToggleGetAll: (payload: { gameId: string }) => ipcRenderer.invoke('cheat-toggle-get-all', payload),
  cheatToggleSet: (payload: {
    gameId: string;
    cheatId: string;
    enabled: boolean;
    confirmedAddress?: string | null;
    dataType?: string | null;
  }) => ipcRenderer.invoke('cheat-toggle-set', payload),
  cheatToggleClear: (payload: { gameId: string; cheatId: string }) =>
    ipcRenderer.invoke('cheat-toggle-clear', payload),

  trainerOverlayToggle: () => ipcRenderer.invoke('trainer-overlay-toggle'),
  trainerOverlayHide: () => ipcRenderer.invoke('trainer-overlay-hide'),
  trainerHotkeysGetDefaults: () => ipcRenderer.invoke('trainer-hotkeys-get-defaults'),
  trainerHotkeysGetBindings: () => ipcRenderer.invoke('trainer-hotkeys-get-bindings'),
  trainerHotkeysSetBindings: (payload: { hotkeys: Record<string, string> }) =>
    ipcRenderer.invoke('trainer-hotkeys-set-bindings', payload),
  onTrainerHotkey: (callback: (payload: { action: string }) => void) => {
    const listener = (_event: unknown, payload: { action: string }) => callback(payload);
    ipcRenderer.on('trainer-hotkey', listener);
    return () => ipcRenderer.removeListener('trainer-hotkey', listener);
  },

  trainerCatalogSearch: (payload: {
    query?: string;
    limit?: number;
    offset?: number;
    categories?: string[];
    verificationStatus?: 'all' | 'verified' | 'community' | 'metadata-only' | 'unverified';
  }) => ipcRenderer.invoke('trainer-catalog-search', payload),
  trainerCatalogStats: () => ipcRenderer.invoke('trainer-catalog-stats'),
  trainerCatalogGet: (payload: { catalogGameId: string }) => ipcRenderer.invoke('trainer-catalog-get', payload),
  trainerCatalogSeed: () => ipcRenderer.invoke('trainer-catalog-seed'),
  trainerCatalogSyncRemote: () => ipcRenderer.invoke('trainer-catalog-sync-remote'),
  trainerCatalogSyncHub: (payload?: { overwriteUserDefinitions?: boolean }) =>
    ipcRenderer.invoke('trainer-catalog-sync-hub', payload ?? {}),
  trainerCatalogGetDefinition: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-get-definition', payload),
  publishToCommunity: (payload: {
    definition: unknown;
    executableHash: string;
  }) => ipcRenderer.invoke('publishToCommunity', payload),
  trainerCatalogLoadGame: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-load-game', payload),
  trainerCatalogGetTrainerControls: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-get-trainer-controls', payload),
  trainerCatalogApproveSavePath: (payload: { catalogGameId: string; saveFilePath: string }) =>
    ipcRenderer.invoke('trainer-catalog-approve-save-path', payload),
  trainerCatalogImportYaml: (payload: { yamlText: string }) =>
    ipcRenderer.invoke('trainer-catalog-import-yaml', payload),
  trainerCatalogImportCt: (payload: { xmlText: string; title?: string }) =>
    ipcRenderer.invoke('trainer-catalog-import-ct', payload),
  trainerCatalogFeedbackRecord: (payload: {
    catalogGameId: string;
    featureId: string;
    rating: -1 | 0 | 1;
    executableHashPrefix?: string | null;
    note?: string | null;
  }) => ipcRenderer.invoke('trainer-catalog-feedback-record', payload),
  trainerCatalogFeedbackSummary: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-feedback-summary', payload),
  trainerCatalogEvaluatePromotion: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-evaluate-promotion', payload),
  trainerCatalogPromoteVerified: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-promote-verified', payload),
  trainerCatalogExportDefinition: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-export-definition', payload),
  trainerCatalogPendingQuarantine: () => ipcRenderer.invoke('trainer-catalog-pending-quarantine'),
  ctLibrarySummary: () => ipcRenderer.invoke('ct-library-summary'),
  ctLibrarySearch: (payload: {
    query?: string;
    gameId?: string;
    kind?: 'all' | 'pointer' | 'script' | 'aob';
    limit?: number;
    offset?: number;
  }) => ipcRenderer.invoke('ct-library-search', payload),
  ctLibraryGameDetail: (payload: { gameId: string }) => ipcRenderer.invoke('ct-library-game-detail', payload),
  trainerResearchPickExe: () => ipcRenderer.invoke('trainer-research-pick-exe'),
  trainerResearchAnalyzeExe: (payload: { filePath: string }) =>
    ipcRenderer.invoke('trainer-research-analyze-exe', payload),
  trainerResearchPickDumpspaceFolder: () => ipcRenderer.invoke('trainer-research-pick-dumpspace-folder'),
  trainerResearchImportDumpspace: (payload: { dumpspaceDir: string; title: string; executable: string }) =>
    ipcRenderer.invoke('trainer-research-import-dumpspace', payload),
  trainerResearchPickCt: () => ipcRenderer.invoke('trainer-research-pick-ct'),
  trainerResearchAnalyzeCtScripts: (payload: { xmlText: string; title?: string; executable?: string }) =>
    ipcRenderer.invoke('trainer-research-analyze-ct-scripts', payload),
  trainerResearchMergeUeScripts: (payload: {
    dumpspaceDir: string;
    xmlText: string;
    title?: string;
    executable?: string;
  }) => ipcRenderer.invoke('trainer-research-merge-ue-scripts', payload),
  liveMemoryPointerScan: (payload: { address: string; maxDepth?: number; maxOffsetPerLevel?: number }) =>
    ipcRenderer.invoke('live-memory-pointer-scan', payload),
  liveMemoryScanAob: (payload: { signature: string; moduleName?: string }) =>
    ipcRenderer.invoke('live-memory-scan-aob', payload),
  inProcessProposeHook: (payload: { plan: unknown; userApprovedAction: true }) =>
    ipcRenderer.invoke('in-process-propose-hook', payload),
  inProcessConfirmHook: (payload: { proposalId: string; userApprovedAction: true }) =>
    ipcRenderer.invoke('in-process-confirm-hook', payload),
  inProcessRollbackHook: () => ipcRenderer.invoke('in-process-rollback-hook'),
  inProcessProposeInjectorLaunch: (payload: {
    exePath: string;
    userConfirmedOffline: true;
    userApprovedAction: true;
  }) => ipcRenderer.invoke('in-process-propose-injector-launch', payload),
  inProcessConfirmInjectorLaunch: (payload: { proposalId: string; userApprovedAction: true }) =>
    ipcRenderer.invoke('in-process-confirm-injector-launch', payload),
  onCatalogProcessDetected: (callback: (payload: {
    catalogGameId: string;
    displayName: string;
    pid: number;
    executable: string;
    planAllowed?: boolean;
    blockReason?: string;
    fingerprintStatus?: string;
    hasDefinition?: boolean;
    prepareReady?: boolean;
  }) => void) => {
    const listener = (_event: unknown, payload: {
      catalogGameId: string;
      displayName: string;
      pid: number;
      executable: string;
      planAllowed?: boolean;
      blockReason?: string;
      fingerprintStatus?: string;
      hasDefinition?: boolean;
      prepareReady?: boolean;
      executableHashSHA256?: string;
    }) => callback(payload);
    ipcRenderer.on('catalog-process-detected', listener);
    return () => ipcRenderer.removeListener('catalog-process-detected', listener);
  },
  onZeroInputReady: (callback: (payload: {
    catalogGameId: string;
    pid: number;
    executable: string;
    counts?: { resolved: number; failed: number; scanRequired: number };
    features?: unknown[];
    featureHints?: Record<string, string>;
  }) => void) => {
    const listener = (_event: unknown, payload: {
      catalogGameId: string;
      pid: number;
      executable: string;
      counts?: { resolved: number; failed: number; scanRequired: number };
      features?: unknown[];
      featureHints?: Record<string, string>;
    }) => callback(payload);
    ipcRenderer.on('zero-input-ready', listener);
    return () => ipcRenderer.removeListener('zero-input-ready', listener);
  },

  installDiscoveryScan: (payload?: {
    steamInstallPath?: string;
    epicManifestsPath?: string;
    offlineRootsOnly?: boolean;
  }) => ipcRenderer.invoke('install-discovery-scan', payload ?? {}),
  installDiscoveryList: () => ipcRenderer.invoke('install-discovery-list'),

  trainerDeckGet: (payload: { catalogGameId: string }) => ipcRenderer.invoke('trainer-deck-get', payload),
  trainerHealthCheck: (payload?: { catalogGameId?: string }) =>
    ipcRenderer.invoke('trainer-health-check', payload ?? {}),
  trainerHealthList: () => ipcRenderer.invoke('trainer-health-list'),
  trainerCatalogCertifyL1: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-certify-l1', payload),
  catalogDemandNotify: (payload: { catalogGameId: string; kind?: 'notify' | 'verification_request' }) =>
    ipcRenderer.invoke('catalog-demand-notify', payload),
  catalogDemandList: () => ipcRenderer.invoke('catalog-demand-list'),
  installDiscoveryOpenPath: (payload: { catalogGameId: string; targetPath?: string }) =>
    ipcRenderer.invoke('install-discovery-open-path', payload),
  catalogProcessWatchActive: (payload: { active: boolean }) =>
    ipcRenderer.invoke('catalog-process-watch-active', payload),
});
