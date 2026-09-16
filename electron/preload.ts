import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Deterministic renderer-state fixture. This is unavailable in normal builds/runs.
  e2eTrainerState: process.env.NODE_ENV === 'test'
    ? (process.env.SOLITH_E2E_TRAINER_STATE ?? null)
    : null,

  // Database operations
  getGames: () => ipcRenderer.invoke('get-games'),
  addGame: (gameData: any) => ipcRenderer.invoke('add-game', gameData),
  updateGame: (gameData: any) => ipcRenderer.invoke('update-game', gameData),
  deleteGame: (gameId: string) => ipcRenderer.invoke('delete-game', gameId),
  pickGameFolder: () => ipcRenderer.invoke('pick-game-folder'),
  pickGameExecutable: () => ipcRenderer.invoke('pick-game-executable'),
  scanGame: (gameId: string) => ipcRenderer.invoke('scan-game', gameId),
  getRecipes: (gameId: string) => ipcRenderer.invoke('get-recipes', gameId),
  createRecipe: (recipeData: any) => ipcRenderer.invoke('create-recipe', recipeData),
  getJournal: (gameId?: string) => ipcRenderer.invoke('get-journal', gameId),
  getProposals: (gameId: string) => ipcRenderer.invoke('get-proposals', gameId),
  logEvent: (eventData: any) => ipcRenderer.invoke('log-event', eventData),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key: string, value: any) => ipcRenderer.invoke('set-setting', key, value),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  listNotifications: () => ipcRenderer.invoke('list-notifications'),
  getUnreadNotificationCount: () => ipcRenderer.invoke('get-unread-notification-count'),
  createNotification: (payload: {
    category: string;
    title: string;
    message: string;
    severity?: string;
    action?: { type: 'open-view'; view: string };
  }) => ipcRenderer.invoke('create-notification', payload),
  markNotificationRead: (id: string) => ipcRenderer.invoke('mark-notification-read', { id }),
  markAllNotificationsRead: () => ipcRenderer.invoke('mark-all-notifications-read'),
  clearNotificationHistory: () => ipcRenderer.invoke('clear-notification-history'),
  onNotificationCreated: (callback: (record: {
    id: string;
    category: string;
    title: string;
    message: string;
    severity: string;
    createdAt: string;
    read: boolean;
    action?: { type: 'open-view'; view: string };
  }) => void) => {
    const listener = (_event: unknown, record: any) => callback(record);
    ipcRenderer.on('notification-created', listener);
    return () => ipcRenderer.removeListener('notification-created', listener);
  },
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
  liveMemoryIssueWriteConsent: (payload: { proposalId: string; userConfirmed?: true }) =>
    ipcRenderer.invoke('live-memory-issue-write-consent', payload),
  liveMemoryConfirmWrite: (payload: { proposalId: string; consentToken: string }) =>
    ipcRenderer.invoke('live-memory-confirm-write', payload),
  liveMemoryRollback: (payload: { proposalId: string }) =>
    ipcRenderer.invoke('live-memory-rollback', payload),
  liveMemoryScanFirst: (payload: {
    dataType: string;
    targetValue: number;
    // Stage 7.1 §3/§4 — exact int64 wire value (decimal string; a `number`
    // alone cannot carry a value beyond Number.MAX_SAFE_INTEGER without
    // loss). Ignored for any dataType other than 'int64'. See
    // LiveMemoryScanFirstSchema and LiveMemorySession.scanExactViaBackend.
    targetValueBigint?: string;
    maxRegionBytes?: number;
    maxTotalBytes?: number;
    maxMatches?: number;
  }) => ipcRenderer.invoke('live-memory-scan-first', payload),
  liveMemoryScanFirstAutoMatrix: (payload: {
    value?: number;
    min?: number;
    max?: number;
    modes?: Array<'exact' | 'between' | 'greaterThan' | 'lessThan'>;
    dataTypes?: string[];
    includeUnknown?: boolean;
    unknownKey?: string;
    maxRegionBytes?: number;
    maxTotalBytes?: number;
    maxMatches?: number;
    unknownMaxRegionBytes?: number;
    unknownMaxTotalBytes?: number;
  }) => ipcRenderer.invoke('live-memory-scan-first-auto-matrix', payload),
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
  liveMemoryCorrelationStart: (payload: {
    candidates: Array<{
      id?: string;
      address: string;
      value: number;
      dataType: string;
      source?: 'auto-scan' | 'unknown-scan' | 'aob-candidate' | 'pointer-candidate' | 'manual';
      scanMode?: string;
      label?: string;
    }>;
    pollIntervalMs?: number;
    reportIntervalMs?: number;
    epsilon?: number;
    eventLookbackMs?: number;
  }) => ipcRenderer.invoke('live-memory-correlation-start', payload),
  liveMemoryCorrelationPoll: () => ipcRenderer.invoke('live-memory-correlation-poll', {}),
  liveMemoryCorrelationEvent: (payload: {
    id?: string;
    kind:
      | 'spent_resource'
      | 'gained_resource'
      | 'took_damage'
      | 'healed'
      | 'used_stamina'
      | 'recovered_stamina'
      | 'used_item'
      | 'collected_loot'
      | 'custom';
    label?: string;
    expectedDirection: 'increased' | 'decreased' | 'changed' | 'unchanged';
    expectedDelta?: number;
    observedValue?: number;
    lookbackMs?: number;
    observedAt?: string;
  }) => ipcRenderer.invoke('live-memory-correlation-event', payload),
  liveMemoryCorrelationStop: () => ipcRenderer.invoke('live-memory-correlation-stop', {}),
  onLiveMemoryCorrelationReport: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('live-memory-correlation-report', listener);
    return () => ipcRenderer.removeListener('live-memory-correlation-report', listener);
  },
  localOcrListWindowSources: (payload?: { targetName?: string }) =>
    ipcRenderer.invoke('local-ocr-list-window-sources', payload ?? {}),
  localOcrReadWindowRegion: (payload: {
    sourceId: string;
    roi: { x: number; y: number; width: number; height: number };
  }) => ipcRenderer.invoke('local-ocr-read-window-region', payload),
  liveMemoryFreezePropose: (payload: { address: string; dataType: string; value: number; intervalMs?: number }) =>
    ipcRenderer.invoke('live-memory-freeze-propose', payload),
  liveMemoryFreezeRequestConsent: (payload: { proposalId: string }) =>
    ipcRenderer.invoke('live-memory-freeze-issue-consent', payload),
  liveMemoryFreezeStart: (payload: { proposalId: string; consentToken: string }) =>
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
  wispOverlayToggle: () => ipcRenderer.invoke('wisp-overlay-toggle'),
  wispOverlayHide: () => ipcRenderer.invoke('wisp-overlay-hide'),
  wispOverlaySetExpanded: (payload: { expanded: boolean }) =>
    ipcRenderer.invoke('wisp-overlay-set-expanded', payload),
  wispOverlayMoveBy: (payload: { deltaX: number; deltaY: number }) =>
    ipcRenderer.invoke('wisp-overlay-move-by', payload),
  wispOverlaySetInteractive: (payload: { interactive: boolean }) =>
    ipcRenderer.invoke('wisp-overlay-set-interactive', payload),
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
  trainerCatalogIdentityReviewList: () => ipcRenderer.invoke('trainer-catalog-identity-review-list'),
  trainerCatalogIdentityReviewCount: () => ipcRenderer.invoke('trainer-catalog-identity-review-count'),
  trainerCatalogIdentityReviewResolve: (payload: {
    id: string;
    resolution: 'keep-existing' | 'accept-incoming' | 'treat-separate' | 'ignore';
  }) => ipcRenderer.invoke('trainer-catalog-identity-review-resolve', payload),
  trainerCatalogPickCt: () => ipcRenderer.invoke('trainer-catalog-pick-ct'),
  trainerCatalogPreviewCt: (payload: { filePath: string; xmlText: string; title: string; sha256: string }) =>
    ipcRenderer.invoke('trainer-catalog-preview-ct', payload),
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
  trainerCatalogSetOwned: (payload: { catalogGameId: string; owned: boolean }) =>
    ipcRenderer.invoke('trainer-catalog-set-owned', payload),
  artworkCacheRefresh: (payload?: { catalogGameIds?: string[] }) => ipcRenderer.invoke('artwork-cache-refresh', payload ?? {}),
  artworkCacheRetryMissing: () => ipcRenderer.invoke('artwork-cache-retry-missing'),
  artworkCacheStatus: () => ipcRenderer.invoke('artwork-cache-status'),
  artworkCachePause: () => ipcRenderer.invoke('artwork-cache-pause'),
  artworkCacheResume: () => ipcRenderer.invoke('artwork-cache-resume'),
  artworkCacheCancel: () => ipcRenderer.invoke('artwork-cache-cancel'),
  catalogUpdatesStatus: () => ipcRenderer.invoke('catalog-updates-status'),
  catalogUpdatesSetPreference: (payload: { autoUpdateEnabled?: boolean; bundledSnapshotOnly?: boolean; artworkNetworkOptOut?: boolean }) =>
    ipcRenderer.invoke('catalog-updates-set-preference', payload),
  catalogUpdatesImport: () => ipcRenderer.invoke('catalog-updates-import'),
  catalogUpdatesRollbackLast: () => ipcRenderer.invoke('catalog-updates-rollback-last'),
  aiConfigTestConnection: (payload: { provider: 'None' | 'Ollama' | 'LM Studio'; endpoint?: string; model?: string; timeout?: number }) =>
    ipcRenderer.invoke('ai-config-test-connection', payload),
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
  ctLibraryPickZip: () => ipcRenderer.invoke('ct-library-pick-zip'),
  ctLibraryImportZipPreview: (payload: {
    selectionId: string;
    jobId?: string;
    limit?: number;
  }) => ipcRenderer.invoke('ct-library-import-zip-preview', payload),
  ctLibraryImportZipStart: (payload: {
    selectionId: string;
    jobId?: string;
    limit?: number;
    maxShardBytes?: number;
  }) => ipcRenderer.invoke('ct-library-import-zip-start', payload),
  ctLibraryImportZipCancel: (payload: { jobId: string }) => ipcRenderer.invoke('ct-library-import-zip-cancel', payload),
  onCtLibraryImportProgress: (callback: (payload: {
    jobId: string;
    phase: string;
    label: string;
    archivePath?: string;
    processedTables?: number;
    totalTables?: number;
  }) => void) => {
    const listener = (_event: unknown, payload: {
      jobId: string;
      phase: string;
      label: string;
      archivePath?: string;
      processedTables?: number;
      totalTables?: number;
    }) => callback(payload);
    ipcRenderer.on('ct-library-import-progress', listener);
    return () => ipcRenderer.removeListener('ct-library-import-progress', listener);
  },
  registrySelectProcess: (payload: { pid: number; executableName: string }) =>
    ipcRenderer.invoke('registry-select-process', payload),
  registryRunReadOnlyVerification: (payload: {
    registry: unknown;
    selectionId: string;
    timeoutMs?: number;
  }) => ipcRenderer.invoke('registry-run-readonly-verification', payload),
  registryCompareRestartArtifacts: (payload: { previous: unknown; current: unknown }) =>
    ipcRenderer.invoke('registry-compare-restart-artifacts', payload),
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
  // Phase 2 P2-2 — pointer map production surface. Every address crossing
  // this boundary is a "0x..." string, never a bare Number — a real 64-bit
  // process's addresses can exceed Number.MAX_SAFE_INTEGER (mission §11).
  pointerMapCreate: (payload: { name: string }) => ipcRenderer.invoke('pointer-map-create', payload),
  pointerMapList: () => ipcRenderer.invoke('pointer-map-list'),
  pointerMapGet: (payload: { mapId: string }) => ipcRenderer.invoke('pointer-map-get', payload),
  pointerMapRename: (payload: { mapId: string; name: string }) => ipcRenderer.invoke('pointer-map-rename', payload),
  pointerMapDelete: (payload: { mapId: string }) => ipcRenderer.invoke('pointer-map-delete', payload),
  pointerMapScanTarget: (payload: {
    mapId: string;
    target: string;
    bounds?: { maxDepth?: number; maxOffsetPerLevel?: number; maxResults?: number; maxTotalScans?: number; maxCandidatesPerLevel?: number };
  }) => ipcRenderer.invoke('pointer-map-scan-target', payload),
  pointerMapScanTargets: (payload: {
    mapId: string;
    targets: string[];
    bounds?: { maxDepth?: number; maxOffsetPerLevel?: number; maxResults?: number; maxTotalScans?: number; maxCandidatesPerLevel?: number };
  }) => ipcRenderer.invoke('pointer-map-scan-targets', payload),
  pointerMapResolve: (payload: { mapId: string }) => ipcRenderer.invoke('pointer-map-resolve', payload),
  pointerMapRefresh: (payload: { mapId: string }) => ipcRenderer.invoke('pointer-map-refresh', payload),
  pointerMapAddNode: (payload: {
    mapId: string;
    label: string;
    candidate: { moduleName: string; moduleOffset: number; offsets: number[]; depth: number };
  }) => ipcRenderer.invoke('pointer-map-add-node', payload),
  pointerMapRemoveNode: (payload: { mapId: string; nodeId: string }) =>
    ipcRenderer.invoke('pointer-map-remove-node', payload),
  pointerMapSave: (payload: { mapId: string; gameId?: string; executableIdentity?: string; architecture?: string }) =>
    ipcRenderer.invoke('pointer-map-save', payload),
  pointerMapLoad: (payload: { mapId: string }) => ipcRenderer.invoke('pointer-map-load', payload),
  pointerMapListSaved: () => ipcRenderer.invoke('pointer-map-list-saved'),
  pointerMapDeleteSaved: (payload: { mapId: string }) => ipcRenderer.invoke('pointer-map-delete-saved', payload),
  liveMemoryScanAob: (payload: { signature: string; moduleName?: string }) =>
    ipcRenderer.invoke('live-memory-scan-aob', payload),
  liveMemoryScannerRoutingModeGet: () => ipcRenderer.invoke('live-memory-scanner-routing-mode-get'),
  liveMemoryScannerRoutingModeSet: (payload: { mode: 'LEGACY' | 'NATIVE' | 'SHADOW_COMPARE' }) =>
    ipcRenderer.invoke('live-memory-scanner-routing-mode-set', payload),
  // Stage 7.2/7.3 §2/§3/§12 — cancellable production scan contract. Start
  // returns an `operationId` before the scan finishes; cancel/poll reference
  // it. This is the real preload transport for mid-flight cancellation —
  // not a UI-only flag.
  liveMemoryScanFirstStart: (payload: {
    // Stage 7.4 §1 — the 6 legacy names plus the 10 canonical short names
    // (i8/u8/i16/u16/i32/u32/i64/u64/f32/f64), which is the only way to
    // reach i8/i16/u16/u64.
    dataType:
      | 'byte' | 'int32' | 'uint32' | 'float' | 'double' | 'int64'
      | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64' | 'u64' | 'f32' | 'f64';
    targetValue: number;
    targetValueBigint?: string;
    maxRegionBytes?: number;
    maxTotalBytes?: number;
    maxMatches?: number;
  }) => ipcRenderer.invoke('live-memory-scan-first-start', payload),
  liveMemoryScanAobStart: (payload: { signature: string; moduleName?: string }) =>
    ipcRenderer.invoke('live-memory-scan-aob-start', payload),
  liveMemoryScanCancel: (payload: { operationId: string }) => ipcRenderer.invoke('live-memory-scan-cancel', payload),
  liveMemoryScanPoll: (payload: { operationId: string }) => ipcRenderer.invoke('live-memory-scan-poll', payload),

  // Phase 9 — read-only address/data research tools
  researchView: (payload: { address: string; types: string[] }) =>
    ipcRenderer.invoke('research:view', payload),
  researchHex: (payload: { address: string; size?: number }) =>
    ipcRenderer.invoke('research:hex', payload),
  researchPointerAnalyze: (payload: { address: string; maxDepth?: number; maxOffsetPerLevel?: number }) =>
    ipcRenderer.invoke('research:pointer-analyze', payload),
  researchResolvePath: (payload: {
    moduleName: string;
    baseOffset: string;
    pointerChain?: number[];
  }) => ipcRenderer.invoke('research:resolve-path', payload),
  researchSnapshotDiff: (payload: { old: unknown; new: unknown }) =>
    ipcRenderer.invoke('research:snapshot-diff', payload),
  researchSnapshotSave: (payload: { snapshot: unknown; label?: string }) =>
    ipcRenderer.invoke('research:snapshot-save', payload),

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
  inProcessIssueInjectorConsent: (payload: { proposalId: string; userConfirmed?: true }) =>
    ipcRenderer.invoke('in-process-issue-injector-consent', payload),
  inProcessConfirmInjectorLaunch: (payload: {
    proposalId: string;
    userApprovedAction: true;
    consentToken: string;
  }) => ipcRenderer.invoke('in-process-confirm-injector-launch', payload),
  inProcessRegisterInjectorHelper: (payload: { exePath: string }) =>
    ipcRenderer.invoke('in-process-register-injector-helper', payload),
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
    gogFixturePath?: string;
    offlineRootsOnly?: boolean;
    userSelectedRoots?: string[];
    includeCommonRoots?: boolean;
  }) => ipcRenderer.invoke('install-discovery-scan', payload ?? {}),
  installDiscoveryPickFolder: () => ipcRenderer.invoke('install-discovery-pick-folder'),
  installDiscoveryPreview: (payload?: {
    steamInstallPath?: string;
    epicManifestsPath?: string;
    gogFixturePath?: string;
    offlineRootsOnly?: boolean;
    userSelectedRoots?: string[];
    includeCommonRoots?: boolean;
  }) => ipcRenderer.invoke('install-discovery-preview', payload ?? {}),
  installDiscoveryCommit: (payload: { records: unknown[] }) =>
    ipcRenderer.invoke('install-discovery-commit', payload),
  installDiscoveryList: () => ipcRenderer.invoke('install-discovery-list'),

  listGameLibrary: (payload?: { view?: 'installed' | 'all' | 'owned' }) =>
    ipcRenderer.invoke('list-game-library', payload ?? {}),
  listCanonicalGames: () => ipcRenderer.invoke('list-canonical-games'),
  getCanonicalGame: (payload: { canonicalGameId: string }) => ipcRenderer.invoke('get-canonical-game', payload),
  launchInstallation: (payload: { canonicalGameId: string; installationId: string }) =>
    ipcRenderer.invoke('launch-installation', payload),

  trainerDeckGet: (payload: { catalogGameId: string }) => ipcRenderer.invoke('trainer-deck-get', payload),
  trainerHealthCheck: (payload?: { catalogGameId?: string }) =>
    ipcRenderer.invoke('trainer-health-check', payload ?? {}),
  trainerHealthList: () => ipcRenderer.invoke('trainer-health-list'),
  trainerCatalogCertifyL1: (payload: { catalogGameId: string }) =>
    ipcRenderer.invoke('trainer-catalog-certify-l1', payload),
  catalogDemandNotify: (payload: { catalogGameId: string; kind?: 'notify' | 'verification_request' }) =>
    ipcRenderer.invoke('catalog-demand-notify', payload),
  catalogDemandList: () => ipcRenderer.invoke('catalog-demand-list'),
  trainerCatalogAllTimePopularityList: () => ipcRenderer.invoke('trainer-catalog-all-time-popularity-list'),
  installDiscoveryOpenPath: (payload: { catalogGameId: string; targetPath?: string }) =>
    ipcRenderer.invoke('install-discovery-open-path', payload),
  catalogProcessWatchActive: (payload: { active: boolean }) =>
    ipcRenderer.invoke('catalog-process-watch-active', payload),
});
