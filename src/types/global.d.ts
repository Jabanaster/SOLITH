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
    parseSave: (filePath: string) => Promise<any>;
    compareSaves: (a: string, b: string, gameId?: string, old?: any, nw?: any) => Promise<any[]>;
    createProposalForEdit: (gameId: string, filePath: string, path: string, oldValue: any, newValue: any, recipeId?: string) => Promise<any>;
    applyProposal: (proposal: any) => Promise<any>;
    suggestDataEdits: (filePath: string) => Promise<any[]>;
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
  };
}
