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
    liveMemoryAttach: (payload: { pid: number; executableName: string; userConfirmedOffline: true }) => Promise<any>;
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
      comparison: { kind: string; value?: number };
      previous: { address: string; value: number }[];
    }) => Promise<{ success: boolean; matches?: { address: string; value: number }[]; error?: string }>;
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
  };
}
