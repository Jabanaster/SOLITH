import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Deterministic renderer-state fixture. This is unavailable in normal builds/runs.
  e2eTrainerState: process.env.NODE_ENV === 'test'
    ? (process.env.RESOURCEFORGE_E2E_TRAINER_STATE ?? null)
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
  parseSave: (filePath: string) => ipcRenderer.invoke('parse-save', filePath),
  compareSaves: (savePathA: string, savePathB: string, gameId?: string, knownOldValue?: any, knownNewValue?: any) => 
    ipcRenderer.invoke('compare-saves', savePathA, savePathB, gameId, knownOldValue, knownNewValue),
  createProposalForEdit: (gameId: string, filePath: string, path: string, oldValue: any, newValue: any, recipeId?: string) => 
    ipcRenderer.invoke('create-proposal-for-edit', gameId, filePath, path, oldValue, newValue, recipeId),
  applyProposal: (proposal: any) => ipcRenderer.invoke('apply-proposal', proposal),
  suggestDataEdits: (filePath: string) => ipcRenderer.invoke('suggest-data-edits', filePath),
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
});
