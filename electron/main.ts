import { app, BrowserWindow, ipcMain } from 'electron';
import path, { dirname } from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AddGameSchema,
  ScanGameSchema,
  GetRecipesSchema,
  CreateRecipeSchema,
  DeleteRecipeSchema,
  DeleteGameSchema,
  GetJournalSchema,
  LogEventSchema,
  SetSettingSchema,
  GetBackupsSchema,
  RestoreBackupSchema,
  DetectSaveFilesSchema,
  ParseSaveSchema,
  CompareSavesSchema,
  CreateProposalSchema,
  ApplyProposalSchema,
  SuggestDataEditsSchema,
  DiscoverSaveLocationsSchema,
  ApproveSaveLocationSchema,
  RevokeSaveLocationSchema,
  GetSaveLocationsSchema,
  AddUserSelectedLocationSchema,
  CheckGameRunningSchema,
  GetCompatibilityProfileSchema,
  V2MonitorStartSchema,
  validateIpcPathSafety
} from './ipc-validation.js';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

// ── Isolated userData for test runs ─────────────────────────────────────────
// Must run before app.requestSingleInstanceLock() and app.whenReady().
// The E2E test sets ELECTRON_USER_DATA_PATH to a temp dir so every run
// starts from a clean database and never touches production data.
if (process.env.ELECTRON_USER_DATA_PATH) {
  app.setPath('userData', process.env.ELECTRON_USER_DATA_PATH);
}

// ── Single-instance lock ─────────────────────────────────────────────────────
// Prevents multiple ResourceForge dev instances from stacking up.
// Only terminates OUR second instance — never touches unrelated Electron apps.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[ResourceForge] Another instance is already running. Focusing it and exiting.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // If a second instance tries to launch, focus the existing window instead
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ResourceForge',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // tsup bundles preload.ts as CJS into dist-electron/preload.cjs
      // (CJS is required for sandbox:true + contextIsolation:true to work)
      preload: path.join(moduleDirectory, 'preload.cjs')
    },
    backgroundColor: '#080b12',
    titleBarStyle: 'hiddenInset',
    frame: true
  });

  const isDev = process.argv.includes('--dev') || process.env.RESOURCEFORGE_DEV === '1';
  const isCompatTest = process.argv.includes('--compat-test');

  if (isCompatTest) {
    // Headless compat test — load production bundle
    mainWindow.loadFile(path.join(moduleDirectory, 'dist/index.html'));
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // In packaged app: dist-electron/dist/index.html is bundled into the asar
    mainWindow.loadFile(path.join(moduleDirectory, 'dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const operationsModule = await import('../src/core/safety/operations.js');
    await operationsModule.recoverInterruptedOperations();
  } catch (error) {
    console.error('Failed to run crash recovery on startup:', error);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Database & Core Operations
ipcMain.handle('get-games', async () => {
  try {
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const gamesModule = await import('../src/core/games/index.js');
    return gamesModule.getGames();
  } catch (error) {
    console.error('get-games error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('add-game', async (event, gameData) => {
  try {
    const parsed = AddGameSchema.parse(gameData);
    const safetyModule = await import('../src/core/safety/path-safety.js');
    const safety = safetyModule.validatePathSafety(parsed.path);
    if (!safety.safe) {
      return { error: `Path safety violation: ${safety.reason}` };
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const gamesModule = await import('../src/core/games/index.js');
    const result = gamesModule.addGame(parsed);
    return { success: true, game: result };
  } catch (error) {
    console.error('add-game error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('scan-game', async (event, gameId: string) => {
  try {
    const parsed = ScanGameSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const gamesModule = await import('../src/core/games/index.js');
    return gamesModule.scanGame(parsed.gameId);
  } catch (error) {
    console.error('scan-game error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('delete-game', async (event, gameId: string) => {
  try {
    const parsed = DeleteGameSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const gamesModule = await import('../src/core/games/index.js');
    const success = gamesModule.deleteGame(parsed.gameId);
    return { success };
  } catch (error) {
    console.error('delete-game error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('get-recipes', async (event, gameId: string) => {
  try {
    const parsed = GetRecipesSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const recipesModule = await import('../src/core/recipes/index.js');
    return recipesModule.getAllTrainerItems(parsed.gameId);
  } catch (error) {
    console.error('get-recipes error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('create-recipe', async (event, recipeData) => {
  try {
    const parsed = CreateRecipeSchema.parse(recipeData);
    if (!validateIpcPathSafety(parsed.target, parsed.gameId)) {
      return { error: 'Path safety check failed: target file must reside within game directory.' };
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const recipesModule = await import('../src/core/recipes/index.js');
    const result = recipesModule.createRecipe(parsed as any);
    return { success: true, recipe: result };
  } catch (error) {
    console.error('create-recipe error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('get-journal', async (event, gameId?: string) => {
  try {
    const parsed = GetJournalSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const journalModule = await import('../src/core/journal/index.js');
    return journalModule.getJournalEvents(parsed.gameId || undefined);
  } catch (error) {
    console.error('get-journal error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('log-event', async (event, eventData) => {
  try {
    const parsed = LogEventSchema.parse(eventData);
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const journalModule = await import('../src/core/journal/index.js');
    const result = journalModule.logEvent({
      ...parsed,
      gameId: parsed.gameId || undefined,
      recipeId: parsed.recipeId || undefined
    });
    return { success: true, event: result };
  } catch (error) {
    console.error('log-event error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('get-settings', async () => {
  try {
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const settingsModule = await import('../src/core/settings/index.js');
    return settingsModule.getSettings();
  } catch (error) {
    console.error('get-settings error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('set-setting', async (event, key: any, value: any) => {
  try {
    const parsed = SetSettingSchema.parse({ key, value });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const settingsModule = await import('../src/core/settings/index.js');
    settingsModule.setSetting(parsed.key as any, parsed.value);
    return { success: true };
  } catch (error) {
    console.error('set-setting error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('delete-recipe', async (event, recipeId: string) => {
  try {
    const parsed = DeleteRecipeSchema.parse({ recipeId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const recipesModule = await import('../src/core/recipes/index.js');
    const result = recipesModule.deleteRecipe(parsed.recipeId);
    return { success: result };
  } catch (error) {
    console.error('delete-recipe error:', error);
    return { error: String(error) };
  }
});

ipcMain.handle('get-backups', async (event, gameId: string) => {
  try {
    const parsed = GetBackupsSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const backupsModule = await import('../src/core/backups/index.js');
    return backupsModule.getBackupsForGame(parsed.gameId);
  } catch (error) {
    console.error('get-backups error:', error);
    return [];
  }
});

ipcMain.handle('restore-backup', async (event, backupId: string) => {
  try {
    const parsed = RestoreBackupSchema.parse({ backupId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const backupsModule = await import('../src/core/backups/index.js');
    const success = backupsModule.restoreBackupById(parsed.backupId);
    return { success };
  } catch (error) {
    console.error('restore-backup error:', error);
    return { success: false, error: String(error) };
  }
});

// Saves & Discovery & Proposals Operations
ipcMain.handle('detect-save-files', async (event, gameId: string) => {
  try {
    const parsed = DetectSaveFilesSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const editorModule = await import('../src/core/saves/editor.js');
    const settingsModule = await import('../src/core/settings/index.js');
    const externalScanEnabled = settingsModule.getSetting('externalSaveScanEnabled') === true;
    
    const gamesModule = await import('../src/core/games/index.js');
    const game = gamesModule.getGameById(parsed.gameId);
    if (!game) return [];
    
    const scannerModule = await import('../src/core/scanner/index.js');
    return scannerModule.findSaveFiles(game.path, externalScanEnabled);
  } catch (error) {
    console.error('detect-save-files error:', error);
    return [];
  }
});

ipcMain.handle('parse-save', async (event, filePath: string) => {
  try {
    const parsedInput = ParseSaveSchema.parse({ filePath });
    
    const safetyModule = await import('../src/core/safety/path-safety.js');
    const safety = safetyModule.validatePathSafety(parsedInput.filePath);
    if (!safety.safe) {
      console.error(`parse-save blocked: ${safety.reason}`);
      return null;
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const savesModule = await import('../src/core/saves/index.js');
    const parsed = savesModule.parseSaveFile(parsedInput.filePath);
    if (!parsed) return null;
    
    const values = savesModule.extractSafeValues(parsed);
    return {
      format: parsed.format,
      path: parsed.path,
      values
    };
  } catch (error) {
    console.error('parse-save error:', error);
    return null;
  }
});

ipcMain.handle('compare-saves', async (event, savePathA: string, savePathB: string, gameId?: string, knownOldValue?: any, knownNewValue?: any) => {
  try {
    const parsed = CompareSavesSchema.parse({ savePathA, savePathB, gameId, knownOldValue, knownNewValue });
    
    const safetyModule = await import('../src/core/safety/path-safety.js');
    const safetyA = safetyModule.validatePathSafety(parsed.savePathA);
    const safetyB = safetyModule.validatePathSafety(parsed.savePathB);
    if (!safetyA.safe || !safetyB.safe) {
      console.error(`compare-saves blocked: A=${safetyA.reason}, B=${safetyB.reason}`);
      return [];
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const savesModule = await import('../src/core/saves/index.js');
    const saveA = savesModule.parseSaveFile(parsed.savePathA);
    const saveB = savesModule.parseSaveFile(parsed.savePathB);
    if (!saveA || !saveB) return [];
    
    const discoveryModule = await import('../src/core/discovery/index.js');
    return discoveryModule.compareSaves(saveA, saveB, parsed.gameId, parsed.knownOldValue, parsed.knownNewValue);
  } catch (error) {
    console.error('compare-saves error:', error);
    return [];
  }
});

ipcMain.handle('create-proposal-for-edit', async (event, gameId: string, filePath: string, pathStr: string, oldValue: any, newValue: any, recipeId?: string) => {
  try {
    const parsed = CreateProposalSchema.parse({ gameId, filePath, path: pathStr, oldValue, newValue, recipeId });
    
    if (!validateIpcPathSafety(parsed.filePath, parsed.gameId)) {
      console.error(`create-proposal-for-edit blocked: path safety check failed.`);
      return null;
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const editorModule = await import('../src/core/saves/editor.js');
    const proposal = editorModule.createProposalForEdit(
      parsed.gameId,
      parsed.filePath,
      parsed.path,
      parsed.oldValue,
      parsed.newValue,
      parsed.recipeId || undefined
    );
    return proposal;
  } catch (error) {
    console.error('create-proposal error:', error);
    return null;
  }
});

ipcMain.handle('apply-proposal', async (event, proposal: any) => {
  try {
    const parsed = ApplyProposalSchema.parse(proposal);
    
    if (!validateIpcPathSafety(parsed.targetFile, parsed.gameId)) {
      return { success: false, error: 'Path safety check failed: target file must reside within game directory.' };
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const editorModule = await import('../src/core/saves/editor.js');
    const dryRunRes = await editorModule.dryRunProposal(parsed as any);
    if (!dryRunRes.success) {
      return { success: false, error: dryRunRes.error || 'Dry run failed: Path does not exist or file is locked' };
    }
    
    const result = await editorModule.applyProposal(parsed as any);
    return result;
  } catch (error) {
    console.error('apply-proposal error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('suggest-data-edits', async (event, filePath: string) => {
  try {
    const parsed = SuggestDataEditsSchema.parse({ filePath });
    
    const safetyModule = await import('../src/core/safety/path-safety.js');
    const safety = safetyModule.validatePathSafety(parsed.filePath);
    if (!safety.safe) {
      console.error(`suggest-data-edits blocked: ${safety.reason}`);
      return [];
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const editorModule = await import('../src/core/saves/editor.js');
    return editorModule.suggestDataEdits(parsed.filePath);
  } catch (error) {
    console.error('suggest-data-edits error:', error);
    return [];
  }
});

ipcMain.handle('discover-save-locations', async (event, gameId: string) => {
  try {
    const parsed = DiscoverSaveLocationsSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const discoveryScannerModule = await import('../src/core/scanner/discovery.js');
    return await discoveryScannerModule.discoverSaveLocations(parsed.gameId);
  } catch (error) {
    console.error('discover-save-locations error:', error);
    return [];
  }
});

ipcMain.handle('get-save-locations', async (event, gameId: string) => {
  try {
    const parsed = GetSaveLocationsSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const locationsModule = await import('../src/core/saves/locations.js');
    return locationsModule.getSaveLocations(parsed.gameId);
  } catch (error) {
    console.error('get-save-locations error:', error);
    return [];
  }
});

ipcMain.handle('approve-save-location', async (event, locationId: string) => {
  try {
    const parsed = ApproveSaveLocationSchema.parse({ locationId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const locationsModule = await import('../src/core/saves/locations.js');
    const success = locationsModule.approveSaveLocation(parsed.locationId);
    return { success };
  } catch (error) {
    console.error('approve-save-location error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('revoke-save-location', async (event, locationId: string) => {
  try {
    const parsed = RevokeSaveLocationSchema.parse({ locationId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const locationsModule = await import('../src/core/saves/locations.js');
    const success = locationsModule.revokeSaveLocation(parsed.locationId);
    return { success };
  } catch (error) {
    console.error('revoke-save-location error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('add-user-selected-location', async (event, gameId: string, path: string) => {
  try {
    const parsed = AddUserSelectedLocationSchema.parse({ gameId, path });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const locationsModule = await import('../src/core/saves/locations.js');
    const result = locationsModule.addUserSelectedLocation(parsed.gameId, parsed.path);
    return result;
  } catch (error) {
    console.error('add-user-selected-location error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('check-game-running', async (event, gameId: string) => {
  try {
    const parsed = CheckGameRunningSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const profilesModule = await import('../src/core/profiles/index.js');
    const profiles = profilesModule.getProfilesForGame(parsed.gameId);
    const profile = profiles[0];

    if (!profile || !profile.executableNames?.length) {
      return { running: false, evidence: 'No executable names configured for this game' };
    }

    const processModule = await import('../src/core/process/index.js');
    return processModule.isGameRunning(profile);
  } catch (error) {
    return { running: false, evidence: `Check unavailable: ${String(error).slice(0, 80)}` };
  }
});

ipcMain.handle('get-compatibility-profile', async (event, gameId: string) => {
  try {
    const parsed = GetCompatibilityProfileSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const profilesModule = await import('../src/core/profiles/index.js');
    const profiles = profilesModule.getProfilesForGame(parsed.gameId);
    return profiles[0] ?? null;
  } catch (error) {
    console.error('get-compatibility-profile error:', error);
    return null;
  }
});

ipcMain.handle('get-all-profiles', async () => {
  try {
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const db = (await import('../src/core/database/index.js')).getDb();
    const results = db.exec('SELECT * FROM compatibility_profiles ORDER BY updatedAt DESC');
    if (!results || !results[0]) return [];

    const columns = results[0].columns as string[];
    return results[0].values.map((rowValues: any[]) => {
      const row: any = {};
      columns.forEach((col: string, idx: number) => { row[col] = rowValues[idx]; });
      return row;
    });
  } catch (error) {
    console.error('get-all-profiles error:', error);
    return [];
  }
});

// ── V2 Session Lifecycle Monitor IPC ─────────────────────────────────────────
// Read-only. Disabled by default (v2SessionMonitorEnabled setting).
// No memory access. No injection. No writes to external files.

ipcMain.handle('v2-monitor-start', async (event, payload: unknown) => {
  try {
    const parsed = V2MonitorStartSchema.parse(payload);

    const settingsModule = await import('../src/core/settings/index.js');
    if (!settingsModule.getSetting('v2SessionMonitorEnabled')) {
      return { success: false, error: 'V2 session monitor is disabled. Enable v2SessionMonitorEnabled in settings.' };
    }

    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    const result = getSessionMonitor().start({
      gameId: parsed.gameId,
      executableName: parsed.executableName,
      markerFilePath: parsed.markerFilePath,
      pollIntervalMs: parsed.pollIntervalMs,
    });
    return result;
  } catch (error) {
    console.error('v2-monitor-start error:', error);
    return { success: false, error: String(error).slice(0, 200) };
  }
});

ipcMain.handle('v2-monitor-stop', async () => {
  try {
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    getSessionMonitor().stop('user_stopped');
    return { success: true };
  } catch (error) {
    console.error('v2-monitor-stop error:', error);
    return { success: false, error: String(error).slice(0, 200) };
  }
});

ipcMain.handle('v2-monitor-get-state', async () => {
  try {
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    return getSessionMonitor().getStatus();
  } catch (error) {
    console.error('v2-monitor-get-state error:', error);
    return { state: 'error', snapshot: null, config: null, isRunning: false, startedAt: null, timelineEntryCount: 0 };
  }
});

ipcMain.handle('v2-monitor-clear-timeline', async () => {
  try {
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    getSessionMonitor().clearTimeline();
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error).slice(0, 200) };
  }
});

ipcMain.handle('v2-monitor-export-diagnostics', async () => {
  try {
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    return getSessionMonitor().exportDiagnostics();
  } catch (error) {
    return { error: String(error).slice(0, 200) };
  }
});
