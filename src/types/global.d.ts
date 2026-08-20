declare module 'xml2js';
declare module '*.css';
declare module 'sql.js';

interface Window {
  electronAPI: {
    e2eTrainerState: string | null;
    // Games
    getGames: () => Promise<any[]>;
    addGame: (gameData: any) => Promise<any>;
    updateGame: (gameData: {
      gameId: string;
      name: string;
      path: string;
      engine?: string;
      executablePath?: string;
      coverPath?: string;
      iconPath?: string;
      saveLocations?: string[];
      notes?: string;
      metadataId?: string;
      launcher?: 'steam' | 'epic' | 'gog' | 'xbox' | 'ubisoft' | 'ea' | 'battlenet' | 'manual';
    }) => Promise<any>;
    deleteGame: (gameId: string) => Promise<any>;
    pickGameFolder: () => Promise<{ success: boolean; folderPath?: string; canceled?: boolean; error?: string }>;
    pickGameExecutable: () => Promise<{ success: boolean; filePath?: string; folderPath?: string; canceled?: boolean; error?: string }>;
    scanGame: (gameId: string) => Promise<any>;
    // Recipes
    getRecipes: (gameId: string) => Promise<any[]>;
    createRecipe: (recipeData: any) => Promise<any>;
    deleteRecipe: (recipeId: string) => Promise<any>;
    // Journal
    getJournal: (gameId?: string) => Promise<any[]>;
    getProposals: (gameId: string) => Promise<{
      success: boolean;
      proposals?: Array<{
        id: string;
        gameId: string;
        recipeId?: string;
        targetFile: string;
        operation: 'set' | 'increment' | 'decrement' | 'toggle';
        path: string;
        oldValue: unknown;
        newValue: unknown;
        risk: string;
        preview: string;
        validationRule: string;
        requiresBackup: boolean;
        dryRunPassed: boolean;
        status: 'pending' | 'approved' | 'rejected';
        createdAt: string;
      }>;
      error?: string;
    }>;
    logEvent: (eventData: any) => Promise<any>;
    // Settings
    getSettings: () => Promise<any>;
    setSetting: (key: string, value: any) => Promise<any>;
    getAppVersion: () => Promise<string>;
    // Notifications
    listNotifications: () => Promise<any[]>;
    getUnreadNotificationCount: () => Promise<number>;
    createNotification: (payload: {
      category: string;
      title: string;
      message: string;
      severity?: string;
      action?: { type: 'open-view'; view: string };
    }) => Promise<any>;
    markNotificationRead: (id: string) => Promise<any>;
    markAllNotificationsRead: () => Promise<any>;
    clearNotificationHistory: () => Promise<any>;
    onNotificationCreated?: (callback: (record: {
      id: string;
      category: string;
      title: string;
      message: string;
      severity: string;
      createdAt: string;
      read: boolean;
      action?: { type: 'open-view'; view: string };
    }) => void) => () => void;
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
    liveMemoryListProcesses: () => Promise<{ success: boolean; processes?: { pid: number; name: string; executablePath?: string; parentPid?: number; parentProcessName?: string; startTime?: string }[]; error?: string }>;
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
    liveMemoryZeroInputPrepare: (payload: {
      pid: number;
      executableName: string;
      catalogGameId: string;
      userConfirmedOffline: true;
      executableHashSHA256?: string;
      driftAcknowledged?: boolean;
      maxFuzzyDistance?: number;
      featureHints?: Record<string, string>;
    }) => Promise<any>;
    liveMemoryDetach: () => Promise<{ success: boolean; error?: string }>;
    liveMemoryRead: (payload: { address: string; dataType: string }) => Promise<{ success: boolean; value?: number; error?: string }>;
    liveMemoryProposeWrite: (payload: { address: string; dataType: string; requestedValue: number }) => Promise<any>;
    liveMemoryIssueWriteConsent: (payload: { proposalId: string; userConfirmed?: true }) => Promise<{
      success: boolean;
      consent?: { tokenId: string; expiresAt: string; bindingHash: string };
      error?: string;
    }>;
    liveMemoryConfirmWrite: (payload: { proposalId: string; consentToken: string }) => Promise<any>;
    liveMemoryRollback: (payload: { proposalId: string }) => Promise<{ success: boolean; error?: string }>;
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
    }) => Promise<{
      success: boolean;
      result?: {
        buckets: Array<{
          mode: 'exact' | 'between' | 'greaterThan' | 'lessThan';
          dataType: string;
          matches: { address: string; value: number; dataType?: string }[];
          regionsScanned: number;
          bytesScanned: number;
          truncated: boolean;
          skipped?: boolean;
          reason?: string;
        }>;
        unknown?: { regionsScanned: number; bytesScanned: number; truncated: boolean };
        totals: {
          buckets: number;
          matches: number;
          regionsScanned: number;
          bytesScanned: number;
          truncatedBuckets: number;
          skippedBuckets: number;
          unknownCaptured: boolean;
        };
        readOnly: true;
        executable: false;
      };
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
    }) => Promise<{
      success: boolean;
      report?: import('../core/live-memory/live-correlation-watcher.js').CorrelationReport;
      error?: string;
    }>;
    liveMemoryCorrelationPoll: () => Promise<{
      success: boolean;
      report?: import('../core/live-memory/live-correlation-watcher.js').CorrelationReport;
      error?: string;
    }>;
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
        | 'ocr_value'
        | 'custom';
      label?: string;
      expectedDirection: 'increased' | 'decreased' | 'changed' | 'unchanged';
      expectedDelta?: number;
      observedValue?: number;
      lookbackMs?: number;
      observedAt?: string;
    }) => Promise<{
      success: boolean;
      report?: import('../core/live-memory/live-correlation-watcher.js').CorrelationReport;
      error?: string;
    }>;
    liveMemoryCorrelationStop: () => Promise<{ success: boolean; error?: string }>;
    onLiveMemoryCorrelationReport?: (
      callback: (payload: import('../core/live-memory/live-correlation-watcher.js').CorrelationReport) => void,
    ) => (() => void) | undefined;
    localOcrListWindowSources: (payload?: { targetName?: string }) => Promise<{
      success: boolean;
      sources?: Array<{
        id: string;
        name: string;
        thumbnailDataUrl: string;
        thumbnailSize?: { width: number; height: number };
        captureSize?: { width: number; height: number };
        appIconDataUrl?: string;
      }>;
      error?: string;
    }>;
    localOcrReadWindowRegion: (payload: {
      sourceId: string;
      roi: { x: number; y: number; width: number; height: number };
    }) => Promise<{
      success: boolean;
      result?: import('../core/ocr/local-ocr.js').LocalOcrResult;
      roi?: { x: number; y: number; width: number; height: number };
      sourceName?: string;
      error?: string;
    }>;
    liveMemoryFreezePropose: (payload: { address: string; dataType: string; value: number; intervalMs?: number }) => Promise<{
      success: boolean;
      proposal?: { proposalId: string; target: { address: string; dataType: string }; value: number; intervalMs?: number };
      error?: string;
    }>;
    liveMemoryFreezeRequestConsent: (payload: { proposalId: string }) => Promise<{
      success: boolean;
      consent?: { tokenId: string; expiresAt: string; bindingHash: string };
      error?: string;
    }>;
    liveMemoryFreezeStart: (payload: { proposalId: string; consentToken: string }) => Promise<{ success: boolean; error?: string }>;
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
    wispOverlayToggle: () => Promise<{ success: boolean; visible?: boolean; error?: string }>;
    wispOverlayHide: () => Promise<{ success: boolean; error?: string }>;
    wispOverlaySetExpanded?: (payload: { expanded: boolean }) => Promise<{
      success: boolean;
      expanded?: boolean;
      error?: string;
    }>;
    wispOverlayMoveBy?: (payload: { deltaX: number; deltaY: number }) => Promise<{
      success: boolean;
      error?: string;
    }>;
    wispOverlaySetInteractive?: (payload: { interactive: boolean }) => Promise<{
      success: boolean;
      interactive?: boolean;
      error?: string;
    }>;
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
    trainerCatalogSyncHub: (payload?: { overwriteUserDefinitions?: boolean }) => Promise<{
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
    trainerCatalogGetDefinition: (payload: { catalogGameId: string }) => Promise<{
      success: boolean;
      definition?: import('../core/definitions/schema.v1.js').SolithDefinitionV1;
      canPublish?: boolean;
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
    trainerCatalogIdentityReviewList: () => Promise<{
      success: boolean;
      items?: import('../core/trainer-catalog/identity-review.js').IdentityReviewItem[];
      error?: string;
    }>;
    trainerCatalogIdentityReviewCount: () => Promise<{
      success: boolean;
      count?: number;
      error?: string;
    }>;
    trainerCatalogIdentityReviewResolve: (payload: {
      id: string;
      resolution: 'keep-existing' | 'accept-incoming' | 'treat-separate' | 'ignore';
    }) => Promise<{
      success: boolean;
      item?: import('../core/trainer-catalog/identity-review.js').IdentityReviewItem;
      error?: string;
    }>;
    trainerCatalogPickCt: () => Promise<{
      success: boolean;
      canceled?: boolean;
      filePath?: string;
      xmlText?: string;
      title?: string;
      sha256?: string;
      error?: string;
    }>;
    trainerCatalogPreviewCt: (payload: {
      filePath: string;
      xmlText: string;
      title: string;
      sha256: string;
    }) => Promise<{
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
      sourceHash?: string;
      filePath?: string;
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
    trainerCatalogSetOwned: (payload: { catalogGameId: string; owned: boolean }) => Promise<{
      success: boolean;
      ownedConfirmed?: boolean;
      error?: string;
    }>;
    artworkCacheRefresh: (payload?: { catalogGameIds?: string[] }) => Promise<{
      success: boolean;
      queued?: number;
      error?: string;
    }>;
    artworkCacheRetryMissing: () => Promise<{ success: boolean; queued?: number; error?: string }>;
    artworkCacheStatus: () => Promise<{
      success: boolean;
      running?: boolean;
      active?: number;
      completed?: number;
      total?: number;
      paused?: boolean;
      cancelled?: boolean;
      error?: string;
    }>;
    artworkCachePause: () => Promise<{ success: boolean; error?: string }>;
    artworkCacheResume: () => Promise<{ success: boolean; error?: string }>;
    artworkCacheCancel: () => Promise<{ success: boolean; error?: string }>;
    catalogUpdatesStatus: () => Promise<{
      success: boolean;
      state?: {
        currentVersion: number;
        lastSuccessAt: string | null;
        lastCheckAt: string | null;
        autoUpdateEnabled: boolean;
        bundledSnapshotOnly: boolean;
        artworkNetworkOptOut: boolean;
      };
      history?: Array<{
        id: number;
        version: number;
        appliedAt: string;
        recordCount: number;
        notice: string;
        status: 'applied' | 'rejected' | 'rolled-back';
        rejectReason?: string;
      }>;
      dueForAutomaticCheck?: boolean;
      error?: string;
    }>;
    catalogUpdatesSetPreference: (payload: {
      autoUpdateEnabled?: boolean;
      bundledSnapshotOnly?: boolean;
      artworkNetworkOptOut?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
    catalogUpdatesImport: () => Promise<{
      success: boolean;
      canceled?: boolean;
      result?: { status: 'applied' | 'rejected'; version: number; recordCount: number; rejectReason?: string };
      error?: string;
    }>;
    catalogUpdatesRollbackLast: () => Promise<{ success: boolean; restoredCount?: number; error?: string }>;
    aiConfigTestConnection: (payload: {
      provider: 'None' | 'Ollama' | 'LM Studio';
      endpoint?: string;
      model?: string;
      timeout?: number;
    }) => Promise<{ success: boolean; result?: { success: boolean; message: string }; error?: string }>;
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
    ctLibrarySummary: () => Promise<{
      success: boolean;
      available: boolean;
      summary?: import('../core/ct-library/types.js').CtLibrarySummaryIndex;
      error?: string;
    }>;
    ctLibrarySearch: (payload: {
      query?: string;
      gameId?: string;
      kind?: 'all' | 'pointer' | 'script' | 'aob';
      limit?: number;
      offset?: number;
    }) => Promise<{
      success: boolean;
      available: boolean;
      summary?: import('../core/ct-library/types.js').CtLibrarySummaryIndex;
      total: number;
      results: import('../core/ct-library/search.js').CtLibrarySearchResult[];
      error?: string;
    }>;
    ctLibraryGameDetail: (payload: { gameId: string }) => Promise<{
      success: boolean;
      available: boolean;
      game?: import('../core/ct-library/types.js').CtLibraryGameSummary;
      tables: import('../core/registry/compile-ct-zip.js').CtZipCatalogEntry[];
      error?: string;
    }>;
    ctLibraryPickZip: () => Promise<
      | { status: 'selected'; selectionId: string; path: string; filename: string }
      | { status: 'cancelled' }
      | { status: 'error'; error: string; errorCode: string }
    >;
    ctLibraryImportZipPreview: (payload: {
      selectionId: string;
      jobId?: string;
      limit?: number;
    }) => Promise<{
      success: boolean;
      jobId: string;
      archivePath?: string;
      filename?: string;
      totals?: import('../core/registry/compile-ct-zip.js').CtZipCatalogIndex['totals'];
      rejected?: import('../core/registry/compile-ct-zip.js').CtZipCatalogIndex['rejected'];
      games?: Array<{
        game: string;
        tableName: string;
        archivePath: string;
        counts: import('../core/registry/compile-ct-zip.js').CtZipCatalogEntry['counts'];
      }>;
      error?: string;
      errorCode?: string;
    }>;
    ctLibraryImportZipStart: (payload: {
      selectionId: string;
      jobId?: string;
      limit?: number;
      maxShardBytes?: number;
    }) => Promise<{
      success: boolean;
      jobId: string;
      libraryOutputPath?: string;
      shardDirectory?: string;
      shards?: number;
      totals?: import('../core/registry/compile-ct-zip.js').CtZipCatalogIndex['totals'];
      error?: string;
      errorCode?: string;
    }>;
    ctLibraryImportZipCancel: (payload: { jobId: string }) => Promise<{
      success: boolean;
      jobId: string;
      error?: string;
    }>;
    onCtLibraryImportProgress?: (
      callback: (payload: import('../core/ct-library/import-state.js').CtImportProgress) => void,
    ) => (() => void) | undefined;
    registrySelectProcess: (payload: { pid: number; executableName: string }) => Promise<{
      success: boolean;
      selectionId?: string;
      expiresAt?: string;
      error?: string;
    }>;
    registryRunReadOnlyVerification: (payload: {
      registry: unknown;
      selectionId: string;
      timeoutMs?: number;
    }) => Promise<{
      success: boolean;
      artifact?: import('../core/runtime/headless-verification.js').HeadlessVerificationArtifact;
      artifactPath?: string;
      error?: string;
    }>;
    registryCompareRestartArtifacts: (payload: { previous: unknown; current: unknown }) => Promise<{
      success: boolean;
      comparison?: import('../core/runtime/restart-validation.js').RestartValidationArtifact;
      pointerStability?: import('../core/runtime/delta-engine.js').SessionStabilityArtifact;
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
    /** Phase 9 — typed reinterpret at one address (read-only). */
    researchView: (payload: { address: string; types: string[] }) => Promise<{
      success: boolean;
      entries?: Array<{ address: string; type: string; value: number | string | null; readable: boolean }>;
      error?: string;
    }>;
    researchHex: (payload: { address: string; size?: number }) => Promise<{
      success: boolean;
      window?: {
        address: string;
        size: number;
        hexRows: Array<{ offset: number; hex: string; ascii: string }>;
        truncated: boolean;
        readable: boolean;
        error?: string;
      };
      error?: string;
    }>;
    researchPointerAnalyze: (payload: {
      address: string;
      maxDepth?: number;
      maxOffsetPerLevel?: number;
    }) => Promise<{
      success: boolean;
      report?: import('../core/live-memory/research/pointer-candidate-analysis.js').PointerCandidateReport;
      levelsSearched?: number;
      scansPerformed?: number;
      error?: string;
    }>;
    /** Phase 2 — session-bound path resolve (attached process only). */
    researchResolvePath: (payload: {
      moduleName: string;
      baseOffset: string;
      pointerChain?: number[];
    }) => Promise<{ success: boolean; address?: string; error?: string }>;
    researchSnapshotDiff: (payload: {
      old: import('../core/live-memory/research/session-snapshot.js').SessionSnapshot;
      new: import('../core/live-memory/research/session-snapshot.js').SessionSnapshot;
    }) => Promise<{
      success: boolean;
      diff?: import('../core/live-memory/research/session-snapshot.js').SessionSnapshotDiff;
      error?: string;
    }>;
    researchSnapshotSave: (payload: {
      snapshot: import('../core/live-memory/research/session-snapshot.js').SessionSnapshot;
      label?: string;
    }) => Promise<{
      success: boolean;
      filePath?: string;
      snapshot?: import('../core/live-memory/research/session-snapshot.js').SessionSnapshot;
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
    inProcessIssueInjectorConsent: (payload: { proposalId: string; userConfirmed?: true }) => Promise<{
      success: boolean;
      consent?: { tokenId: string; expiresAt: string; bindingHash: string };
      error?: string;
    }>;
    inProcessConfirmInjectorLaunch: (payload: {
      proposalId: string;
      userApprovedAction: true;
      consentToken: string;
    }) => Promise<{
      success: boolean;
      pid?: number;
      error?: string;
    }>;
    inProcessRegisterInjectorHelper: (payload: { exePath: string }) => Promise<{
      success: boolean;
      entry?: { relativePath: string; sha256: string; publisher?: string | null; registeredAt: string };
      error?: string;
    }>;
    onCatalogProcessDetected?: (
      callback: (payload: {
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
      }) => void,
    ) => (() => void) | undefined;
    onZeroInputReady?: (
      callback: (payload: {
        catalogGameId: string;
        pid: number;
        executable: string;
        counts?: { resolved: number; failed: number; scanRequired: number };
        features?: unknown[];
        featureHints?: Record<string, string>;
      }) => void,
    ) => (() => void) | undefined;

    installDiscoveryScan: (payload?: {
      steamInstallPath?: string;
      epicManifestsPath?: string;
      gogFixturePath?: string;
      offlineRootsOnly?: boolean;
      userSelectedRoots?: string[];
      includeCommonRoots?: boolean;
    }) => Promise<{
      success: boolean;
      discovered?: number;
      matched?: number;
      platforms?: Record<string, number>;
      scannedAt?: string;
      installedCount?: number;
      error?: string;
    }>;
    installDiscoveryPickFolder: () => Promise<{
      success: boolean;
      folderPath?: string;
      canceled?: boolean;
      error?: string;
    }>;
    installDiscoveryPreview: (payload?: {
      steamInstallPath?: string;
      epicManifestsPath?: string;
      gogFixturePath?: string;
      offlineRootsOnly?: boolean;
      userSelectedRoots?: string[];
      includeCommonRoots?: boolean;
    }) => Promise<{
      success: boolean;
      discovered?: number;
      matched?: number;
      platforms?: Record<string, number>;
      scannedAt?: string;
      records?: Array<{
        id: string;
        previewCandidateId: string;
        installIdentity: string;
        canonicalInstallPath: string;
        canonicalExecutablePath?: string;
        launcherAppId?: string;
        identityVersion: number;
        identityStatus: 'verified' | 'backfilled' | 'ambiguous' | 'legacy';
        needsReverification: boolean;
        catalogGameId?: string;
        catalogDisplayName?: string;
        platform: 'steam' | 'epic' | 'gog' | 'xbox' | 'manual';
        installPath: string;
        executablePath?: string;
        displayName?: string;
        steamAppId?: number;
        detectedAt: string;
        lastSeenAt: string;
        duplicate: boolean;
        duplicateReason?: 'same_executable_path' | 'same_launcher_app_id_and_path' | 'same_install_identity';
        duplicateOfId?: string;
        source: string;
        unsupportedReason?: string;
        classification: 'likely_game' | 'uncertain';
        classificationReason: string;
      }>;
      locationsChecked?: string[];
      duplicatesSkipped?: number;
      unsupported?: number;
      rejected?: Array<{ installPath: string; executablePath?: string; displayName?: string; reason: string }>;
      failures?: Array<{ location: string; reason: string }>;
      error?: string;
    }>;
    installDiscoveryCommit: (payload: { records: Array<{ platform: 'steam' | 'epic' | 'gog' | 'xbox' | 'manual'; installPath: string; executablePath?: string; displayName?: string; steamAppId?: number; launcherAppId?: string }> }) => Promise<{
      success: boolean;
      added?: number;
      skipped?: number;
      installedCount?: number;
      error?: string;
    }>;
    installDiscoveryList: () => Promise<{
      success: boolean;
      games?: Array<{
        id: string;
        installIdentity: string;
        canonicalInstallPath: string;
        canonicalExecutablePath?: string;
        launcherAppId?: string;
        identityVersion: number;
        identityStatus: 'verified' | 'backfilled' | 'ambiguous' | 'legacy';
        needsReverification: boolean;
        catalogGameId?: string;
        catalogDisplayName?: string;
        // Matches InstalledGameRecord['platform'] (InstallPlatform, 8 values) — the
        // narrower 5-value union above belongs only to preview/commit, whose scanners
        // and Zod schema do not yet produce ubisoft/ea/battlenet records.
        platform: 'steam' | 'epic' | 'gog' | 'xbox' | 'ubisoft' | 'ea' | 'battlenet' | 'manual';
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

    listGameLibrary: (payload?: { view?: 'installed' | 'all' | 'owned' }) => Promise<{
      success: boolean;
      records?: Array<{
        canonicalGameId: string;
        title: string;
        aliases: string[];
        artworkUrl?: string;
        supportState: 'supported' | 'partial' | 'unsupported' | 'unknown';
        trainerAvailability: 'available' | 'unavailable' | 'unknown';
        verificationStatus: 'verified' | 'community' | 'metadata-only' | 'unverified' | 'unknown';
        ownershipStatus?: 'owned';
        manuallyAdded: boolean;
        installations: Array<{
          installationId: string;
          launcher: 'steam' | 'epic' | 'gog' | 'xbox' | 'ubisoft' | 'ea' | 'battlenet' | 'manual';
          edition?: string;
          installPath?: string;
          executablePath?: string;
          buildVersion?: string;
          launchUri?: string;
          lastSeenAt: string;
          detectionSource: 'auto-detected' | 'manual';
          active: boolean;
          sourceGameId?: string;
        }>;
        saveLocations: string[];
      }>;
      error?: string;
    }>;
    listCanonicalGames: () => Promise<{ success: boolean; games?: unknown[]; error?: string }>;
    getCanonicalGame: (payload: { canonicalGameId: string }) => Promise<{
      success: boolean;
      game?: unknown;
      installations?: unknown[];
      error?: string;
    }>;
    launchInstallation: (payload: { canonicalGameId: string; installationId: string }) => Promise<{
      success: boolean;
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
    catalogDemandList: () => Promise<{
      success: boolean;
      demand?: Array<{ catalogGameId: string; notifyCount: number; verificationRequests: number; lastRequestedAt: string }>;
      error?: string;
    }>;
    trainerCatalogAllTimePopularityList: () => Promise<{
      success: boolean;
      popularity?: Array<{ catalogGameId: string; positiveCount: number }>;
      error?: string;
    }>;
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
