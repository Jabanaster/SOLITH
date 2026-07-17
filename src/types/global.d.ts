declare module 'xml2js';
declare module '*.css';
declare module 'sql.js';

interface Window {
  electronAPI: {
    e2eTrainerState: string | null;
    // Games
    getGames: () => Promise<any[]>;
    addGame: (gameData: any) => Promise<any>;
    deleteGame: (gameId: string) => Promise<any>;
    scanGame: (gameId: string) => Promise<any>;
    // Recipes
    getRecipes: (gameId: string) => Promise<any[]>;
    createRecipe: (recipeData: any) => Promise<any>;
    deleteRecipe: (recipeId: string) => Promise<any>;
    // Journal
    getJournal: (gameId?: string) => Promise<any[]>;
    logEvent: (eventData: any) => Promise<any>;
    // Settings
    getSettings: () => Promise<any>;
    setSetting: (key: string, value: any) => Promise<any>;
    // Backups
    getBackups: (gameId: string) => Promise<any[]>;
    restoreBackup: (backupId: string) => Promise<any>;
    // Saves & Discovery
    detectSaveFiles: (gameId: string) => Promise<any[]>;
    pickSaveFile: (gameId: string) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
    parseSave: (gameId: string, filePath: string) => Promise<any>;
    compareSaves: (a: string, b: string, gameId: string, old?: any, nw?: any) => Promise<any[] | { error: string }>;
    compareSavesReport: (a: string, b: string, gameId: string, old?: any, nw?: any) => Promise<{ results: any[]; report: any } | { error: string }>;
    createProposalForEdit: (gameId: string, filePath: string, path: string, oldValue: any, newValue: any, recipeId?: string) => Promise<any>;
    applyProposal: (proposal: any) => Promise<any>;
    suggestDataEdits: (gameId: string, filePath: string) => Promise<any[] | { error: string }>;
    discoverSaveLocations: (gameId: string) => Promise<any[]>;
    getSaveLocations: (gameId: string) => Promise<any[]>;
    approveSaveLocation: (locationId: string) => Promise<any>;
    revokeSaveLocation: (locationId: string) => Promise<any>;
    addUserSelectedLocation: (gameId: string, path: string) => Promise<any>;
    // Process detection (read-only, no injection)
    checkGameRunning: (gameId: string) => Promise<{ running: boolean; evidence: string }>;
    // Compatibility profiles
    getCompatibilityProfile: (gameId: string) => Promise<any | null>;
    getAllProfiles: () => Promise<any[]>;
    // Live Memory Trainer (V2, feature-flagged off by default, single-player/
    // offline only — see PROJECT_SPEC.md Section 3.1)
    liveMemoryListProcesses: () => Promise<{ success: boolean; processes?: { pid: number; name: string }[]; error?: string }>;
    liveMemoryAttach: (payload: {
      pid: number;
      executableName: string;
      userConfirmedOffline: true;
      executableHashSHA256?: string;
      executableHashPrefixes?: string[];
      targetSHA256?: string;
      driftAcknowledged?: boolean;
      catalogGameId?: string;
    }) => Promise<any>;
    liveMemoryDetach: () => Promise<{ success: boolean; error?: string }>;
    liveMemoryRead: (payload: { address: string; dataType: string }) => Promise<{ success: boolean; value?: number; error?: string }>;
    liveMemoryProposeWrite: (payload: { address: string; dataType: string; requestedValue: number }) => Promise<any>;
    liveMemoryConfirmWrite: (payload: { proposalId: string }) => Promise<any>;
    liveMemoryRollback: (payload: { manifest: unknown }) => Promise<{ success: boolean; error?: string }>;
    liveMemoryScanFirst: (payload: {
      dataType: string;
      targetValue: number;
      maxRegionBytes?: number;
      maxTotalBytes?: number;
      maxMatches?: number;
    }) => Promise<{
      success: boolean;
      result?: { matches: { address: string; value: number }[]; regionsScanned: number; bytesScanned: number; truncated: boolean };
      error?: string;
    }>;
    liveMemoryScanNext: (payload: {
      dataType: string;
      comparison: { kind: string; value?: number; min?: number; max?: number };
      previous: { address: string; value: number }[];
    }) => Promise<{ success: boolean; matches?: { address: string; value: number }[]; error?: string }>;
    liveMemoryScanFirstUnknown: (payload: {
      key: string;
      maxRegionBytes?: number;
      maxTotalBytes?: number;
    }) => Promise<{ success: boolean; regionsScanned?: number; bytesScanned?: number; truncated?: boolean; error?: string }>;
    liveMemoryScanNextFromUnknown: (payload: {
      key: string;
      dataTypes: string[];
      comparison: { kind: string; value?: number; min?: number; max?: number };
      maxMatches?: number;
    }) => Promise<{
      success: boolean;
      result?: {
        matches: { address: string; value: number; dataType: string }[];
        regionsScanned: number;
        bytesScanned: number;
        truncated: boolean;
      };
      error?: string;
    }>;
    liveMemoryReadMany: (payload: { addresses: { address: string; dataType: string }[] }) => Promise<{
      success: boolean;
      values?: { address: string; value: number; dataType: string }[];
      error?: string;
    }>;
    liveMemoryFreezeStart: (payload: { address: string; dataType: string; value: number; intervalMs?: number }) => Promise<{ success: boolean; error?: string }>;
    liveMemoryFreezeStop: () => Promise<{ success: boolean; status?: any; error?: string }>;
    liveMemoryFreezeStatus: () => Promise<{ success: boolean; status?: any; error?: string }>;
    liveMemoryListControls: () => Promise<{
      success: boolean;
      controls?: { id: string; label: string; description: string; dataType: string; constraints?: { min?: number; max?: number } }[];
      error?: string;
    }>;
    liveMemoryResolveControl: (payload: { controlId: string }) => Promise<{
      success: boolean;
      address?: { address: string; dataType: string };
      currentValue?: number;
      error?: string;
    }>;
    liveMemoryResolveDefinitionFeature: (payload: { catalogGameId: string; featureId: string }) => Promise<{
      success: boolean;
      address?: { address: string; dataType: string };
      currentValue?: number;
      error?: string;
    }>;
    cheatToggleGetAll: (payload: { gameId: string }) => Promise<{
      success: boolean;
      states?: { gameId: string; cheatId: string; enabled: boolean; confirmedAddress: string | null; dataType: string | null }[];
      error?: string;
    }>;
    cheatToggleSet: (payload: {
      gameId: string;
      cheatId: string;
      enabled: boolean;
      confirmedAddress?: string | null;
      dataType?: string | null;
    }) => Promise<{ success: boolean; error?: string }>;
    cheatToggleClear: (payload: { gameId: string; cheatId: string }) => Promise<{ success: boolean; error?: string }>;

    trainerOverlayToggle: () => Promise<{ success: boolean; visible?: boolean; error?: string }>;
    trainerOverlayHide: () => Promise<{ success: boolean; error?: string }>;
    trainerHotkeysGetDefaults: () => Promise<{ success: boolean; hotkeys?: Record<string, string>; error?: string }>;
    trainerHotkeysGetBindings: () => Promise<{
      success: boolean;
      hotkeys?: Record<string, string>;
      conflicts?: Array<{ accelerator: string; actions: string[] }>;
      osWarnings?: Array<{ accelerator: string; action: string; reason: string }>;
      error?: string;
    }>;
    trainerHotkeysSetBindings: (payload: {
      hotkeys: Record<string, string>;
    }) => Promise<{
      success: boolean;
      hotkeys?: Record<string, string>;
      conflicts?: Array<{ accelerator: string; actions: string[] }>;
      osWarnings?: Array<{ accelerator: string; action: string; reason: string }>;
      error?: string;
    }>;
    onTrainerHotkey: (callback: (payload: { action: string }) => void) => (() => void) | undefined;

    trainerCatalogSearch: (payload: {
      query?: string;
      limit?: number;
      offset?: number;
      categories?: string[];
      verificationStatus?: 'all' | 'verified' | 'community' | 'metadata-only' | 'unverified';
    }) => Promise<{
      success: boolean;
      entries?: import('../core/trainer-catalog/types.js').TrainerCatalogEntry[];
      total?: number;
      error?: string;
    }>;
    trainerCatalogStats: () => Promise<{ success: boolean; total?: number; error?: string }>;
    trainerCatalogGet: (payload: { catalogGameId: string }) => Promise<{ success: boolean; entry?: unknown; error?: string }>;
    trainerCatalogSeed: () => Promise<{ success: boolean; total?: number; error?: string }>;
    trainerCatalogSyncRemote: () => Promise<{
      success: boolean;
      report?: { totalImported: number; providers: Array<{ provider: string; imported: number; errors: string[] }> };
      error?: string;
    }>;
    trainerCatalogSyncHub: () => Promise<{
      success: boolean;
      report?: {
        status: 'disabled' | 'synced';
        imported: number;
        skippedUserDefinitions: number;
        rejected: number;
        pages: number;
        maxLocalTimestamp: number;
      };
      error?: string;
    }>;
    publishToCommunity: (payload: {
      definition: unknown;
      executableHash: string;
    }) => Promise<{
      success: boolean;
      published?: {
        id: string;
        gameId: string;
        certLevel: 'L0_Community';
        createdAt: string;
        updatedAt: string;
      };
      error?: string;
    }>;
    trainerCatalogLoadGame: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      gameId?: string;
      name?: string;
      cheatCount?: number;
      config?: import('../core/cheat-system/types.js').GameConfig;
      /** Phase 1 schema.v1 lanes — advisory until Phase 2 IPC enforcement. */
      capabilities?: import('../core/definitions/load-catalog-definition.js').CatalogDefinitionCapabilities | null;
      error?: string;
    }>;
    trainerCatalogGetTrainerControls: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      controls?: import('../core/trainer-host/trainer-control-schema.js').TrainerControl[];
      capabilities?: import('../core/definitions/load-catalog-definition.js').CatalogDefinitionCapabilities | null;
      error?: string;
    }>;
    trainerCatalogApproveSavePath: (payload: { catalogGameId: string; saveFilePath: string }) => Promise<{
      success: boolean;
      locationId?: string;
      error?: string;
    }>;
    trainerCatalogImportYaml: (payload: { yamlText: string }) => Promise<{
      success: boolean;
      catalogGameId?: string;
      packId?: string;
      cheatCount?: number;
      title?: string;
      errors?: string[];
      error?: string;
    }>;
    trainerCatalogImportCt: (payload: { xmlText: string; title?: string }) => Promise<{
      success: boolean;
      catalogGameId?: string;
      packId?: string;
      cheatCount?: number;
      title?: string;
      acceptedCount?: number;
      rejectedCount?: number;
      rejected?: Array<{ name: string; reason: string }>;
      validationErrors?: string[];
      metadataImport?: boolean;
      scriptOnlyCount?: number;
      scriptAnalysisCount?: number;
      errors?: string[];
      error?: string;
    }>;
    trainerResearchPickExe: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    trainerResearchAnalyzeExe: (payload: { filePath: string }) => Promise<{
      success: boolean;
      analysis?: import('../core/trainer-research/types.js').TrainerExeAnalysis;
      error?: string;
    }>;
    trainerResearchPickDumpspaceFolder: () => Promise<{ success: boolean; folderPath?: string; error?: string }>;
    trainerResearchImportDumpspace: (payload: { dumpspaceDir: string; title: string; executable: string }) => Promise<{
      success: boolean;
      catalogGameId?: string;
      packId?: string;
      cheatCount?: number;
      title?: string;
      classCount?: number;
      structCount?: number;
      offsetCount?: number;
      notes?: string[];
      errors?: string[];
      error?: string;
    }>;
    trainerResearchPickCt: () => Promise<{
      success: boolean;
      filePath?: string;
      xmlText?: string;
      error?: string;
    }>;
    trainerResearchAnalyzeCtScripts: (payload: { xmlText: string; title?: string; executable?: string }) => Promise<{
      success: boolean;
      report?: import('../core/script-research/types.js').CtScriptResearchReport;
      error?: string;
    }>;
    trainerResearchMergeUeScripts: (payload: {
      dumpspaceDir: string;
      xmlText: string;
      title?: string;
      executable?: string;
    }) => Promise<{
      success: boolean;
      merged?: import('../core/script-research/types.js').MergedUeScriptHint[];
      error?: string;
    }>;
    trainerCatalogFeedbackRecord: (payload: {
      catalogGameId: string;
      featureId: string;
      rating: -1 | 0 | 1;
      executableHashPrefix?: string | null;
      note?: string | null;
    }) => Promise<{ success: boolean; summary?: { positive: number; negative: number; total: number }; error?: string }>;
    trainerCatalogFeedbackSummary: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      summary?: { positive: number; negative: number; total: number };
      quarantined?: boolean;
      pendingUpdates?: number;
      error?: string;
    }>;
    trainerCatalogEvaluatePromotion: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      eligibility?: { eligible: boolean; reasons: string[] };
      error?: string;
    }>;
    trainerCatalogPromoteVerified: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      catalogGameId?: string;
      verificationStatus?: string;
      error?: string;
    }>;
    trainerCatalogExportDefinition: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      catalogGameId?: string;
      filename?: string;
      yaml?: string;
      title?: string;
      verificationStatus?: string;
      error?: string;
    }>;
    trainerCatalogPendingQuarantine: () => Promise<{
      success: boolean;
      pending?: Array<{
        id: number;
        catalogGameId: string;
        reason: string;
        previousVerificationStatus: string | null;
        queuedAt: string;
      }>;
      error?: string;
    }>;
    liveMemoryPointerScan: (payload: { address: string; maxDepth?: number; maxOffsetPerLevel?: number }) => Promise<{
      success: boolean;
      result?: {
        candidates: Array<{ moduleName: string; moduleOffset: string; offsets: number[]; depth: number }>;
        truncated: boolean;
        levelsSearched: number;
        scansPerformed: number;
      };
      error?: string;
    }>;
    liveMemoryScanAob: (payload: { signature: string; moduleName?: string }) => Promise<{
      success: boolean;
      found?: boolean;
      address?: string;
      error?: string;
    }>;
    inProcessProposeHook: (payload: { plan: unknown; userApprovedAction: true }) => Promise<{
      success: boolean;
      proposal?: import('../core/in-process-script/types.js').HookInstallProposal;
      error?: string;
    }>;
    inProcessConfirmHook: (payload: { proposalId: string; userApprovedAction: true }) => Promise<{
      success: boolean;
      manifest?: import('../core/in-process-script/types.js').HookInstallManifest;
      guard?: { allowed: boolean; reason: string };
      error?: string;
    }>;
    inProcessRollbackHook: () => Promise<{ success: boolean; error?: string }>;
    inProcessProposeInjectorLaunch: (payload: {
      exePath: string;
      userConfirmedOffline: true;
      userApprovedAction: true;
    }) => Promise<{
      success: boolean;
      proposal?: import('../core/in-process-script/types.js').InjectorLaunchProposal;
      error?: string;
    }>;
    inProcessConfirmInjectorLaunch: (payload: { proposalId: string; userApprovedAction: true }) => Promise<{
      success: boolean;
      pid?: number;
      error?: string;
    }>;
    onCatalogProcessDetected?: (
      callback: (payload: { catalogGameId: string; displayName: string; pid: number; executable: string }) => void,
    ) => (() => void) | undefined;

    installDiscoveryScan: (payload?: {
      steamInstallPath?: string;
      epicManifestsPath?: string;
      offlineRootsOnly?: boolean;
    }) => Promise<{
      success: boolean;
      discovered?: number;
      matched?: number;
      platforms?: Record<string, number>;
      scannedAt?: string;
      installedCount?: number;
      error?: string;
    }>;
    installDiscoveryList: () => Promise<{
      success: boolean;
      games?: Array<{
        id: string;
        catalogGameId?: string;
        catalogDisplayName?: string;
        platform: string;
        installPath: string;
        executablePath?: string;
        displayName?: string;
        steamAppId?: number;
        detectedAt: string;
        lastSeenAt: string;
      }>;
      catalogGameIds?: string[];
      total?: number;
      error?: string;
    }>;

    trainerDeckGet: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      entry?: import('../core/trainer-catalog/types.js').TrainerCatalogEntry;
      rows?: import('../core/trainer-deck/build-deck-rows.js').TrainerDeckRow[];
      controls?: import('../core/trainer-host/trainer-control-schema.js').TrainerControl[];
      capabilities?: import('../core/definitions/load-catalog-definition.js').CatalogDefinitionCapabilities;
      health?: { catalogGameId: string; status: string; staleReason?: string };
      installed?: { installPath?: string };
      error?: string;
    }>;
    trainerHealthCheck: (payload?: { catalogGameId?: string }) => Promise<{
      success: boolean;
      map?: Record<string, { catalogGameId: string; status: string; staleReason?: string }>;
      error?: string;
    }>;
    trainerHealthList: () => Promise<{
      success: boolean;
      map?: Record<string, { catalogGameId: string; status: string; staleReason?: string }>;
      error?: string;
    }>;
    trainerCatalogCertifyL1: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      schemaValid?: boolean;
      resolutionOk?: boolean;
      backupPathOk?: boolean;
      errors?: string[];
      error?: string;
    }>;
    catalogDemandNotify: (payload: {
      catalogGameId: string;
      kind?: 'notify' | 'verification_request';
    }) => Promise<{
      success: boolean;
      demand?: { catalogGameId: string; notifyCount: number; verificationRequests: number };
      error?: string;
    }>;
    catalogDemandList: () => Promise<{ success: boolean; error?: string }>;
    installDiscoveryOpenPath: (payload: {
      catalogGameId: string;
      targetPath?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    catalogProcessWatchActive: (payload: { active: boolean }) => Promise<{
      success: boolean;
      intervalMs?: number;
      error?: string;
    }>;
  };
}
