import { app, BrowserWindow, ipcMain, Menu, dialog, net, protocol, type IpcMainInvokeEvent } from 'electron';
import type { LifecycleWiring } from '../src/core/v2/lifecycle-wiring.js';
import path, { dirname } from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AddGameSchema,
  UpdateGameSchema,
  ScanGameSchema,
  GetRecipesSchema,
  CreateRecipeSchema,
  DeleteRecipeSchema,
  DeleteGameSchema,
  GetJournalSchema,
  GetProposalsSchema,
  LogEventSchema,
  SetSettingSchema,
  GetBackupsSchema,
  RestoreBackupSchema,
  DetectSaveFilesSchema,
  ParseSaveSchema,
  CompareSavesSchema,
  CompareSavesWithReportSchema,
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
  TrainerHostStartSchema,
  TrainerHostStopSchema,
  TrainerHostGetStatusSchema,
  TrainerHostReadFieldSchema,
  TrainerHostProposeWriteSchema,
  TrainerHostApproveAndWriteSchema,
  TrainerHostRollbackSchema,
  validateIpcPathSafety,
  validateSaveDataFileAccess
} from './ipc-validation.js';
import type { TrainerHostSupervisor } from '../src/core/trainer-host/index.js';
import { registerLiveMemoryIpc, disposeAllLiveMemorySessions, disposeLiveMemorySessionForOwner, setLiveMemorySessionDisposedListener } from './live-memory-ipc.js';
import { registerWispConsentIpc } from './wisp-consent-ipc.js';
import { registerWispE2ETestIpc } from './wisp-e2e-test-ipc.js';
import { registerCheatToggleIpc } from './cheat-toggle-ipc.js';
import { registerTrainerHotkeyIpc, registerTrainerHotkeys, unregisterTrainerHotkeys } from './trainer-hotkeys.js';
import { disposeAdaptiveWispQuickSlotController } from './adaptive-wisp-hotkey-composition.js';
import { disposeCheatSystemInitialization, initializeCheatSystemOnce } from '../src/core/cheat-system/initialization.js';
import { destroyTrainerOverlay } from './trainer-overlay.js';
import { destroyWispOverlay, registerWispOverlayIpc } from './wisp-overlay.js';
import { registerTrainerCatalogIpc, bootstrapTrainerCatalog } from './trainer-catalog-ipc.js';
import { registerCtLibraryIpc } from './ct-library-ipc.js';
import { registerRegistryVerificationIpc } from './registry-verification-ipc.js';
import { registerTrustedSolithWindow, applyWindowNavigationPolicy, validateIpcSender } from './sender-validation.js';
import { registerInstallDiscoveryIpc } from './install-discovery-ipc.js';
import { registerCanonicalGamesIpc } from './canonical-games-ipc.js';
import { registerTrainerDeckIpc } from './trainer-deck-ipc.js';
import { registerTrainerResearchIpc } from './trainer-research-ipc.js';
import { registerLocalOcrIpc } from './local-ocr-ipc.js';
import { registerArtworkCacheIpc } from './artwork-cache-ipc.js';
import { registerCatalogUpdatesIpc } from './catalog-updates-ipc.js';
import { registerAIConfigIpc } from './ai-config-ipc.js';
import { startCatalogProcessWatch } from './catalog-process-watch.js';
import { registerNotificationsIpc, broadcastNotificationCreated } from './notifications-ipc.js';
import {
  reconcileCommunitySyncPolling,
  stopCommunitySyncPolling,
  configureCommunitySyncOrchestrator,
} from './community-sync-orchestrator.js';
import { createNotification } from '../src/core/notifications/index.js';
import { getNotificationsCategoryEnabled } from '../src/core/settings/index.js';
import {
  installLocalCrashHandlers,
  installElectronAppCrashHooks,
} from '../src/core/crash/local-crash-reporter.js';
import {
  resolveGameBarDiscoveryPath,
  startGameBarTransport,
  type GameBarTransport,
} from './gamebar-transport.js';
import { mark } from './startup-timing.js';

mark('module-loaded');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'solith-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

// Live Memory Trainer IPC — feature-flagged (v2LiveModeEnabled, off by
// default), single-player/offline only (PROJECT_SPEC.md Section 3.1).
// Registered once at module level, same as the other IPC handlers below, so
// it is never duplicated on window recreation.
registerLiveMemoryIpc();
// Phase 2 remediation, Section 5.1 ("Detach while pending") — a real
// live-memory detach must proactively invalidate any open Wisp consent
// dialog rather than leaving it stale until the next hotkey press. Safe
// no-op if the Wisp quick-slot controller was never constructed.
setLiveMemorySessionDisposedListener(disposeAdaptiveWispQuickSlotController);
registerWispConsentIpc();
// Phase 2 remediation, Gap A — test-only Wisp E2E activation seam. Registered
// ONLY when SOLITH_TEST_BUILD=1 (see wisp-e2e-test-ipc.ts's own doc comment);
// a normal production process never calls this, so ipcMain never has these
// channels at all outside a test build.
if (process.env.SOLITH_TEST_BUILD === '1') {
  registerWispE2ETestIpc();
}
registerCheatToggleIpc();
registerTrainerHotkeyIpc();
registerTrainerCatalogIpc();
registerCtLibraryIpc();
registerRegistryVerificationIpc();
registerInstallDiscoveryIpc();
registerCanonicalGamesIpc();
registerTrainerDeckIpc();
registerTrainerResearchIpc();
registerNotificationsIpc();
registerArtworkCacheIpc();
registerCatalogUpdatesIpc();
registerAIConfigIpc();

configureCommunitySyncOrchestrator({
  notifyCatalogUpdate: (importedCount) => {
    try {
      if (!getNotificationsCategoryEnabled('catalog-update')) return;
      const record = createNotification({
        category: 'catalog-update',
        title: 'Catalog updated',
        message: `${importedCount} trainer definition${importedCount === 1 ? '' : 's'} added or refreshed from the community catalog.`,
        severity: 'info',
        action: { type: 'open-view', view: 'trainer-library' },
      });
      broadcastNotificationCreated(record);
    } catch (error) {
      console.error('notifyCatalogUpdate error:', error);
    }
  },
});
registerLocalOcrIpc();
registerWispOverlayIpc();

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

// Bound for the ready-to-show fallback (see createWindow()). Overridable
// only for deterministic test timing; falls back to the 10s default on any
// unset/invalid value.
const READY_TO_SHOW_TIMEOUT_MS = (() => {
  const raw = Number(process.env.SOLITH_READY_TO_SHOW_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
})();

// ── Isolated userData for test runs ─────────────────────────────────────────
// Must run before app.requestSingleInstanceLock() and app.whenReady().
// The E2E test sets ELECTRON_USER_DATA_PATH to a temp dir so every run
// starts from a clean database and never touches production data.
if (process.env.ELECTRON_USER_DATA_PATH) {
  app.setPath('userData', process.env.ELECTRON_USER_DATA_PATH);
}

// Telemetry-free local crash_report.txt under userData/logs (Zero-Input resilience).
const crashLogsDir = path.join(app.getPath('userData'), 'logs');
installLocalCrashHandlers({
  logsDir: crashLogsDir,
  appVersion: app.getVersion(),
});
installElectronAppCrashHooks(app, {
  logsDir: crashLogsDir,
  appVersion: app.getVersion(),
});

// ── Single-instance lock ─────────────────────────────────────────────────────
// Prevents multiple Solith dev instances from stacking up.
// Only terminates OUR second instance — never touches unrelated Electron apps.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[Solith] Another instance is already running. Focusing it and exiting.');
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
let gameBarTransport: GameBarTransport | null = null;
let quittingAfterGameBarTransportStop = false;

// V2 lifecycle wiring — initialised once in app.whenReady(), after the session
// monitor is available. Null until then so IPC handlers can detect unready state.
let lifecycleWiring: LifecycleWiring | null = null;

// TrainerHost supervisor — initialised lazily on first start IPC call.
let trainerHostSupervisor: TrainerHostSupervisor | null = null;
// Tracks the webContentsId that owns the current TrainerHost session.
let trainerHostOwner: number | null = null;

// Real sender identity validation for the destructive TrainerHost write path —
// mirrors requireTrustedSender() in electron/live-memory-ipc.ts. Beyond
// isDestroyed()/ownership, this confirms the sender is a registered Solith
// window, in its own main frame, still showing an allowed URL.
function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

/**
 * Wraps ipcMain.handle with the requireTrustedSender check applied uniformly
 * before the real handler body runs (Phase 7 B2 hardening — closes the class
 * of handlers in this file that previously had no sender-identity check at
 * all, reachable by any trusted-but-wrong-window-type sender).
 */
function handleGuarded(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) {
      return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    }
    return listener(event, ...args);
  });
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveSolithAssetRequestUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== 'solith-asset:' || url.hostname !== 'local') {
    throw new Error('Unsupported Solith asset URL');
  }

  const encodedTarget = url.pathname.replace(/^\/+/, '');
  if (!encodedTarget) throw new Error('Missing Solith asset target');

  const requested = decodeURIComponent(encodedTarget);
  const requestedPath = requested.startsWith('file://')
    ? fileURLToPath(requested)
    : requested;

  if (!path.isAbsolute(requestedPath)) {
    throw new Error('Solith asset target must be an absolute path');
  }

  if (!fs.existsSync(requestedPath)) {
    throw new Error('Solith asset target does not exist');
  }

  const resolvedPath = fs.realpathSync.native(requestedPath);
  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error('Solith asset target must be a file');
  }

  const allowedRoots = [
    app.getPath('userData'),
    path.join(moduleDirectory, 'dist', 'assets'),
  ]
    .filter((root) => fs.existsSync(root))
    .map((root) => fs.realpathSync.native(root));

  const allowed = allowedRoots.some((root) => resolvedPath === root || isPathInside(resolvedPath, root));
  if (!allowed) {
    throw new Error('Solith asset request denied outside approved roots');
  }

  return pathToFileURL(resolvedPath).toString();
}

function registerSolithAssetProtocol(): void {
  protocol.handle('solith-asset', async (request) => {
    try {
      const fileUrl = resolveSolithAssetRequestUrl(request.url);
      return net.fetch(fileUrl);
    } catch (error) {
      console.error('[Solith Asset] Rejected local asset request:', error);
      return new Response('Not found', { status: 404 });
    }
  });
}

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    path.join(moduleDirectory, 'dist', 'solith-icon.png'),
    path.join(process.cwd(), 'public', 'solith-icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createWindow() {
  mark('create-window-start');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Solith',
    autoHideMenuBar: true,
    icon: resolveWindowIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      // tsup bundles preload.ts as CJS into dist-electron/preload.cjs
      // (CJS is required for sandbox:true + contextIsolation:true to work)
      preload: path.join(moduleDirectory, 'preload.cjs')
    },
    backgroundColor: '#080b12',
    titleBarStyle: 'hiddenInset',
    frame: true,
    show: false
  });

  mark('browserwindow-constructed');
  const readyToShowWindow = mainWindow;
  let shown = false;
  const showOnce = (reason: string) => {
    if (shown || readyToShowWindow.isDestroyed()) return;
    shown = true;
    mark(reason);
    readyToShowWindow.show();
    // Kick off deferred, non-critical catalog bootstrap only once the
    // window is actually being shown (real ready-to-show signal, or the
    // fallback timeout if the renderer never signals). Starting it earlier
    // (e.g. right after window construction) let it compete with the
    // renderer's own startup work for the same process's I/O, which showed
    // up as a several-second ready-to-show delay in measurement. Same
    // operations and error handling as before — only the kick-off point
    // moved.
    void runDeferredTrainerCatalogBootstrap();
  };
  readyToShowWindow.once('ready-to-show', () => showOnce('ready-to-show'));
  // Fallback: if the renderer never signals ready (crash, hang, missing
  // asset), still show the window instead of leaving the app invisible with
  // no window at all — a controlled, visible failure beats a silent one.
  // Bound is explicit and overridable (test-only) via
  // SOLITH_READY_TO_SHOW_TIMEOUT_MS; defaults to 10s in normal operation.
  const readyToShowFallback = setTimeout(() => showOnce('ready-to-show-fallback-timeout'), READY_TO_SHOW_TIMEOUT_MS);
  readyToShowWindow.once('closed', () => clearTimeout(readyToShowFallback));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

  const isDev =
    process.argv.includes('--dev') ||
    process.env.SOLITH_DEV === '1';
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

  // Packaged builds must only trust the packaged file:// route — the dev-server
  // origin is attacker-bindable on any machine and must never be trusted once
  // shipped (isDev is the same flag already used to choose what to load above).
  const mainAllowedUrlPrefixes = isDev
    ? ['http://localhost:3000']
    : [pathToFileURL(path.join(moduleDirectory, 'dist/index.html')).href];
  registerTrustedSolithWindow(mainWindow.webContents, 'main', mainAllowedUrlPrefixes);
  applyWindowNavigationPolicy(mainWindow.webContents, mainAllowedUrlPrefixes);

  mainWindow.webContents.on('did-finish-load', () => {
    mark('renderer-did-finish-load');
    mainWindow?.setMenuBarVisibility(false);
    mainWindow?.setMenu(null);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The trainer overlay is hidden (not destroyed) during normal use so it
    // reopens instantly. A hidden BrowserWindow still counts toward Electron's
    // window-all-closed check, so without this the app would never reach
    // app.quit() after the overlay had ever been shown.
    destroyTrainerOverlay();
  });

  // Wire per-window lifecycle (idempotent — WeakSet guard inside wiring).
  // Must happen after mainWindow is assigned so the reference is valid.
  if (lifecycleWiring) lifecycleWiring.wireWindow(mainWindow);
}

let trainerCatalogBootstrapStarted = false;
function runDeferredTrainerCatalogBootstrap(): Promise<void> {
  if (trainerCatalogBootstrapStarted) return Promise.resolve();
  trainerCatalogBootstrapStarted = true;
  mark('trainer-catalog-bootstrap-start');
  return (async () => {
    try {
      await bootstrapTrainerCatalog();
      await reconcileCommunitySyncPolling();
      await startCatalogProcessWatch();
      mark('trainer-catalog-bootstrap-done');
    } catch (error) {
      console.error('Trainer catalog bootstrap failed:', error);
    }
  })();
}

app.whenReady().then(async () => {
  mark('app-ready');
  registerSolithAssetProtocol();

  try {
    mark('gamebar-transport-start');
    gameBarTransport = await startGameBarTransport({
      discoveryPath: resolveGameBarDiscoveryPath(),
    });
    mark('gamebar-transport-done');
  } catch (error) {
    mark('gamebar-transport-failed');
    console.error('[GameBar Transport] Startup failed; transport remains unavailable:', error);
  }

  try {
    mark('db-init-start');
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    mark('db-init-done');

    const { unlockTrainerCapabilities } = await import('../src/core/settings/unlock-trainer-capabilities.js');
    unlockTrainerCapabilities();

    // Cheat-system initialization must run before registerTrainerHotkeys()
    // — Wisp hotkey actions resolve availability through the cheat-system
    // entry lookup, which was permanently empty in production before this
    // closeout (initializeCheatSystem had zero real callers). Failure is
    // logged, not thrown — an initialization failure here must not prevent
    // the rest of app startup (unrelated trainer hotkeys/overlay features)
    // from working.
    const cheatSystemInit = initializeCheatSystemOnce();
    if (cheatSystemInit.state !== 'ready') {
      console.error('[cheat-system] initialization failed:', cheatSystemInit.error);
    } else if (cheatSystemInit.mappingDiagnostics.length > 0) {
      console.warn('[cheat-system] mapping diagnostics:', cheatSystemInit.mappingDiagnostics);
    }

    registerTrainerHotkeys();

    // Non-critical and network-bound (remote catalog sync): measured at
    // 1.3s-12.3s across repeated launches, versus <200ms combined for every
    // other startup step. Kicked off from showOnce() (in createWindow, once
    // the window is actually being shown) instead of here, so it neither
    // gates window creation nor competes with the renderer's own startup
    // work for first paint. Same operations, same try/catch/console.error
    // handling as before — only the kick-off point moved.

    mark('crash-recovery-start');
    const operationsModule = await import('../src/core/safety/operations.js');
    await operationsModule.recoverInterruptedOperations();
    mark('crash-recovery-done');
  } catch (error) {
    console.error('Failed to run crash recovery on startup:', error);
  }

  // Initialise V2 lifecycle wiring once, before the window is created.
  // ipcMain.handle registrations for V2 channels are at module level (below)
  // so they are never duplicated on window recreation.
  try {
    const { createLifecycleWiring } = await import('../src/core/v2/lifecycle-wiring.js');
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    lifecycleWiring = createLifecycleWiring(getSessionMonitor(), app);
  } catch (error) {
    console.error('Failed to initialise V2 lifecycle wiring:', error);
  }
  mark('lifecycle-wiring-done');

  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('render-process-gone', (_event, webContents) => {
  disposeLiveMemorySessionForOwner(webContents.id);
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (!gameBarTransport || quittingAfterGameBarTransportStop) return;
  event.preventDefault();
  const transport = gameBarTransport;
  gameBarTransport = null;
  void transport.stop()
    .catch((error) => {
      console.error('[GameBar Transport] Shutdown failed:', error);
    })
    .finally(() => {
      quittingAfterGameBarTransportStop = true;
      app.quit();
    });
});

app.on('will-quit', () => {
  unregisterTrainerHotkeys();
  disposeCheatSystemInitialization();
  destroyTrainerOverlay();
  destroyWispOverlay();
  stopCommunitySyncPolling();
  const cleanupResults = disposeAllLiveMemorySessions();
  const failures = cleanupResults.filter((result) => !result.success).length;
  if (failures > 0) console.error('live_memory_cleanup_failed', { failedOwners: failures });
});

// Remove the app-level 'before-quit' listener installed by lifecycle wiring.
// This prevents a stale listener from being invoked if the wiring object is
// ever recreated during the same process lifetime (e.g. in E2E tests that
// reconstruct the app). Called on will-quit, which fires on all platforms
// after all windows are closed and just before the process exits.
app.on('will-quit', () => {
  if (lifecycleWiring) lifecycleWiring.dispose();
  if (trainerHostSupervisor) trainerHostSupervisor.verifyExitOrKill();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Database & Core Operations
handleGuarded('get-games', async () => {
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

handleGuarded('pick-game-folder', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: 'Select game install folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, folderPath: result.filePaths[0] };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

handleGuarded('pick-game-executable', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: 'Select game executable',
      properties: ['openFile'],
      filters: [{ name: 'Windows executables', extensions: ['exe'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const filePath = result.filePaths[0];
    return { success: true, filePath, folderPath: path.dirname(filePath) };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

handleGuarded('add-game', async (event, gameData) => {
  try {
    const parsed = AddGameSchema.parse(gameData);
    const safetyModule = await import('../src/core/safety/path-safety.js');
    const safety = safetyModule.validatePathSafety(parsed.path);
    if (!safety.safe) {
      return { error: `Path safety violation: ${safety.reason}` };
    }
    // Finding 4 (independent security review, ef254d1): executablePath was
    // shape-validated (a string, zod) but never checked against `path` — a
    // renderer could record an arbitrary local .exe (e.g. a Windows system
    // binary) as this game's launch target. `path`, once validated above, is
    // the owner-approved root for this game going forward; bind
    // executablePath's containment to it here, at persistence time, in
    // addition to the launch-time check in canonical-games-ipc.ts.
    if (parsed.executablePath) {
      const executableSafety = safetyModule.validatePathSafety(parsed.executablePath, [parsed.path]);
      if (!executableSafety.safe) {
        return { error: `Executable path safety violation: ${executableSafety.reason}` };
      }
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

handleGuarded('update-game', async (_event, gameData) => {
  try {
    const parsed = UpdateGameSchema.parse(gameData);
    const safetyModule = await import('../src/core/safety/path-safety.js');
    const safety = safetyModule.validatePathSafety(parsed.path);
    if (!safety.safe) {
      return { success: false, error: `Path safety violation: ${safety.reason}` };
    }
    // See add-game above — same Finding 4 fix.
    if (parsed.executablePath) {
      const executableSafety = safetyModule.validatePathSafety(parsed.executablePath, [parsed.path]);
      if (!executableSafety.safe) {
        return { success: false, error: `Executable path safety violation: ${executableSafety.reason}` };
      }
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const gamesModule = await import('../src/core/games/index.js');
    const game = gamesModule.updateGame(parsed.gameId, {
      name: parsed.name,
      path: parsed.path,
      engine: parsed.engine,
      executablePath: parsed.executablePath,
      coverPath: parsed.coverPath,
      iconPath: parsed.iconPath,
      saveLocations: parsed.saveLocations,
      notes: parsed.notes,
      metadataId: parsed.metadataId,
      launcher: parsed.launcher,
    });
    if (!game) return { success: false, error: 'Game not found' };
    return { success: true, game };
  } catch (error) {
    console.error('update-game error:', error);
    return { success: false, error: String(error) };
  }
});

handleGuarded('scan-game', async (event, gameId: string) => {
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

handleGuarded('delete-game', async (event, gameId: string) => {
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

handleGuarded('get-recipes', async (event, gameId: string) => {
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

handleGuarded('create-recipe', async (event, recipeData) => {
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

handleGuarded('get-journal', async (event, gameId?: string) => {
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

handleGuarded('get-proposals', async (event, gameId?: string) => {
  try {
    const parsed = GetProposalsSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const proposalsModule = await import('../src/core/proposals/index.js');
    return { success: true, proposals: proposalsModule.getProposals(parsed.gameId) };
  } catch (error) {
    console.error('get-proposals error:', error);
    return { success: false, error: String(error) };
  }
});

handleGuarded('log-event', async (event, eventData) => {
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

handleGuarded('get-app-version', () => app.getVersion());

handleGuarded('get-settings', async () => {
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

handleGuarded('set-setting', async (event, key: any, value: any) => {
  try {
    const parsed = SetSettingSchema.parse({ key, value });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const settingsModule = await import('../src/core/settings/index.js');
    settingsModule.setSetting(parsed.key as any, parsed.value);

    // If the V2 feature flag was just disabled, stop any active monitoring session
    // immediately in the main process — do not rely solely on renderer cleanup.
    if (parsed.key === 'v2SessionMonitorEnabled' && parsed.value === false && lifecycleWiring) {
      lifecycleWiring.notifyFeatureChanged(false);
    }

    // Community Hub poller must mount/unmount immediately with the opt-in flag.
    if (parsed.key === 'communitySyncEnabled') {
      void reconcileCommunitySyncPolling();
    }

    return { success: true };
  } catch (error) {
    console.error('set-setting error:', error);
    return { error: String(error) };
  }
});

handleGuarded('delete-recipe', async (event, recipeId: string) => {
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

handleGuarded('get-backups', async (event, gameId: string) => {
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

handleGuarded('restore-backup', async (event, backupId: string) => {
  try {
    const parsed = RestoreBackupSchema.parse({ backupId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    const dbInstance = dbModule.default;
    
    // Retrieve backup details before restore to log to the journal
    const backupRow = dbInstance.prepare('SELECT gameId, recipeId, metadata FROM backups WHERE id = ?').get(parsed.backupId);
    
    const backupsModule = await import('../src/core/backups/index.js');
    const success = backupsModule.restoreBackupById(parsed.backupId);
    
    if (success && backupRow) {
      const journalModule = await import('../src/core/journal/index.js');
      const metadata = JSON.parse(backupRow.metadata || '{}');
      journalModule.logEvent({
        gameId: backupRow.gameId || undefined,
        recipeId: backupRow.recipeId || undefined,
        type: 'rollback',
        description: `Restored backup: ${path.basename(metadata.filePath || '')}`,
        details: JSON.stringify({
          backupId: parsed.backupId,
          filePath: metadata.filePath,
          originalHash: metadata.originalHash
        })
      });
    }
    
    return { success };
  } catch (error) {
    console.error('restore-backup error:', error);
    return { success: false, error: String(error) };
  }
});

// Saves & Discovery & Proposals Operations
handleGuarded('detect-save-files', async (event, gameId: string) => {
  try {
    const parsed = DetectSaveFilesSchema.parse({ gameId });
    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();
    
    const settingsModule = await import('../src/core/settings/index.js');
    const externalScanEnabled = settingsModule.getSetting('externalSaveScanEnabled') === true;
    
    const scannerModule = await import('../src/core/scanner/index.js');
    const locationsModule = await import('../src/core/saves/locations.js');
    const gamesModule = await import('../src/core/games/index.js');
    const game = gamesModule.getGameById(parsed.gameId);

    const files = new Set<string>();
    if (game?.path) {
      for (const f of scannerModule.findSaveFiles(game.path, externalScanEnabled)) {
        files.add(f);
      }
    }

    const approved = locationsModule.getSaveLocations(parsed.gameId).filter(
      (loc) => loc.approvalState === 'Approved',
    );
    for (const loc of approved) {
      for (const f of scannerModule.findSaveFiles(loc.canonicalPath, true)) {
        files.add(f);
      }
    }

    return [...files];
  } catch (error) {
    console.error('detect-save-files error:', error);
    return [];
  }
});

handleGuarded('pick-save-file', async (event, gameId: string) => {
  try {
    const parsed = DetectSaveFilesSchema.parse({ gameId });
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: 'Select save or data file',
      properties: ['openFile'],
      filters: [
        { name: 'Save / data files', extensions: ['xml', 'json', 'sav', 'dat', 'ini', 'cfg', 'csv', 'txt', 'yml', 'yaml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { success: false, canceled: true };
    }
    const filePath = result.filePaths[0];
    const locationsModule = await import('../src/core/saves/locations.js');
    const parentDir = path.dirname(filePath);
    const locResult = locationsModule.addUserSelectedLocation(parsed.gameId, parentDir);
    if (!locResult.success) {
      return { success: false, error: locResult.error ?? 'Could not approve folder for this game.' };
    }
    return { success: true, filePath };
  } catch (error) {
    console.error('pick-save-file error:', error);
    return { success: false, error: String(error) };
  }
});

handleGuarded('parse-save', async (event, gameId: string, filePath: string) => {
  try {
    const parsedInput = ParseSaveSchema.parse({ gameId, filePath });
    
    const safety = validateSaveDataFileAccess(parsedInput.gameId, parsedInput.filePath);
    if (!safety.safe) {
      console.error('parse-save blocked: file is not approved for this game.');
      return { error: safety.error || 'File is not approved for this game.' };
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

handleGuarded('compare-saves', async (event, savePathA: string, savePathB: string, gameId?: string, knownOldValue?: any, knownNewValue?: any) => {
  try {
    const parsed = CompareSavesSchema.parse({ savePathA, savePathB, gameId, knownOldValue, knownNewValue });
    
    const safetyA = validateSaveDataFileAccess(parsed.gameId, parsed.savePathA);
    const safetyB = validateSaveDataFileAccess(parsed.gameId, parsed.savePathB);
    if (!safetyA.safe || !safetyB.safe) {
      console.error('compare-saves blocked: one or more files are not approved for this game.');
      return { error: 'One or more files are not approved for this game.' };
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

handleGuarded('compare-saves-report', async (event, savePathA: string, savePathB: string, gameId?: string, knownOldValue?: any, knownNewValue?: any) => {
  try {
    const parsed = CompareSavesWithReportSchema.parse({ savePathA, savePathB, gameId, knownOldValue, knownNewValue });

    const safetyA = validateSaveDataFileAccess(parsed.gameId, parsed.savePathA);
    const safetyB = validateSaveDataFileAccess(parsed.gameId, parsed.savePathB);
    if (!safetyA.safe || !safetyB.safe) {
      console.error('compare-saves-report blocked: one or more files are not approved for this game.');
      return { error: 'One or more files are not approved for this game.' };
    }

    const dbModule = await import('../src/core/database/index.js');
    await dbModule.initDatabase();

    const savesModule = await import('../src/core/saves/index.js');
    const saveA = savesModule.parseSaveFile(parsed.savePathA);
    const saveB = savesModule.parseSaveFile(parsed.savePathB);
    if (!saveA || !saveB) return { results: [], report: null };

    const discoveryModule = await import('../src/core/discovery/index.js');
    const analysis = discoveryModule.compareSavesWithReport(saveA, saveB, parsed.gameId, parsed.knownOldValue, parsed.knownNewValue);
    return analysis;
  } catch (error) {
    console.error('compare-saves-report error:', error);
    return { results: [], report: null };
  }
});

handleGuarded('create-proposal-for-edit', async (event, gameId: string, filePath: string, pathStr: string, oldValue: any, newValue: any, recipeId?: string) => {
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

handleGuarded('apply-proposal', async (event, proposal: any) => {
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

handleGuarded('suggest-data-edits', async (event, gameId: string, filePath: string) => {
  try {
    const parsed = SuggestDataEditsSchema.parse({ gameId, filePath });
    
    const safety = validateSaveDataFileAccess(parsed.gameId, parsed.filePath);
    if (!safety.safe) {
      console.error('suggest-data-edits blocked: file is not approved for this game.');
      return { error: safety.error || 'File is not approved for this game.' };
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

handleGuarded('discover-save-locations', async (event, gameId: string) => {
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

handleGuarded('get-save-locations', async (event, gameId: string) => {
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

handleGuarded('approve-save-location', async (event, locationId: string) => {
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

handleGuarded('revoke-save-location', async (event, locationId: string) => {
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

handleGuarded('add-user-selected-location', async (event, gameId: string, path: string) => {
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

handleGuarded('check-game-running', async (event, gameId: string) => {
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

handleGuarded('get-compatibility-profile', async (event, gameId: string) => {
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

handleGuarded('get-all-profiles', async () => {
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
//
// OWNERSHIP: event.sender.id is used as the owner identifier — never a value
// supplied in the IPC payload. This prevents one renderer from impersonating
// another or interfering with its monitoring session.
//
// These handlers are registered exactly once at module level. Recreating a
// BrowserWindow does not re-register them.

handleGuarded('v2-monitor-start', async (event, payload: unknown) => {
  try {
    if (!lifecycleWiring) {
      return { success: false, error: 'Monitor not initialised yet.' };
    }

    // Reject destroyed senders before parsing the payload.
    if (event.sender.isDestroyed()) {
      return { success: false, error: 'sender_invalid' };
    }

    const parsed = V2MonitorStartSchema.parse(payload);

    const settingsModule = await import('../src/core/settings/index.js');
    // sql.js stores boolean true as integer 1 in some paths; accept both.
    const rawFeatureFlag = settingsModule.getSetting('v2SessionMonitorEnabled');
    const featureEnabled = rawFeatureFlag === true || rawFeatureFlag === 1;

    // senderId is derived from the Electron IPC event, never from payload.
    return lifecycleWiring.handleStart(event.sender.id, {
      gameId: parsed.gameId,
      executableName: parsed.executableName,
      markerFilePath: parsed.markerFilePath,
      pollIntervalMs: parsed.pollIntervalMs,
    }, { featureEnabled, senderValid: true });
  } catch (error) {
    // Return a normalised error — no stack traces, paths, or usernames.
    return { success: false, error: 'start_failed' };
  }
});

handleGuarded('v2-monitor-stop', async (event) => {
  try {
    if (!lifecycleWiring) {
      return { success: false, error: 'Monitor not initialised yet.' };
    }
    if (event.sender.isDestroyed()) {
      return { success: false, error: 'sender_invalid' };
    }
    return lifecycleWiring.handleStop(event.sender.id);
  } catch (error) {
    return { success: false, error: 'stop_failed' };
  }
});

handleGuarded('v2-monitor-get-state', async () => {
  try {
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    return getSessionMonitor().getStatus();
  } catch (error) {
    return { state: 'error', snapshot: null, config: null, isRunning: false, startedAt: null, timelineEntryCount: 0 };
  }
});

handleGuarded('v2-monitor-clear-timeline', async () => {
  try {
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    getSessionMonitor().clearTimeline();
    return { success: true };
  } catch (error) {
    return { success: false, error: 'clear_failed' };
  }
});

handleGuarded('v2-monitor-export-diagnostics', async () => {
  try {
    const { getSessionMonitor } = await import('../src/core/v2/session-monitor.js');
    return getSessionMonitor().exportDiagnostics();
  } catch (error) {
    return { error: 'export_failed' };
  }
});

// ── TrainerHost IPC Handlers ──────────────────────────────────────────────────
//
// Ownership model mirrors V2 session monitor: event.sender.id is the sole
// owner identifier — never a value supplied in the IPC payload.
// No memory access. No injection. File reads only from approved paths.

handleGuarded('trainer-host-start', async (event, payload: unknown) => {
  try {
    if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
    TrainerHostStartSchema.parse(payload);

    // Lazy-initialise supervisor on first call
    if (!trainerHostSupervisor) {
      const { getTrainerHostSupervisor } = await import('../src/core/trainer-host/index.js');
      trainerHostSupervisor = getTrainerHostSupervisor();
    }

    const result = await trainerHostSupervisor.start();
    if (result.success) {
      trainerHostOwner = event.sender.id;
    }
    return result;
  } catch {
    return { success: false, error: 'start_failed' };
  }
});

handleGuarded('trainer-host-stop', async (event) => {
  try {
    if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
    if (trainerHostOwner !== null && trainerHostOwner !== event.sender.id) {
      return { success: false, error: 'not_owner' };
    }
    if (!trainerHostSupervisor) return { success: true };
    await trainerHostSupervisor.stop();
    trainerHostOwner = null;
    return { success: true };
  } catch {
    return { success: false, error: 'stop_failed' };
  }
});

handleGuarded('trainer-host-get-status', async () => {
  try {
    if (!trainerHostSupervisor) return { running: false, pid: null, capabilities: [] };
    return trainerHostSupervisor.getStatus();
  } catch {
    return { running: false, pid: null, capabilities: [] };
  }
});

handleGuarded('trainer-host-read-field', async (event, payload: unknown) => {
  try {
    if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
    if (trainerHostOwner !== null && trainerHostOwner !== event.sender.id) {
      return { success: false, error: 'not_owner' };
    }
    if (!trainerHostSupervisor) return { success: false, error: 'not_running' };

    const parsed = TrainerHostReadFieldSchema.parse(payload);
    // Path approval is enforced inside supervisor.readField() via isPathApproved()
    return await trainerHostSupervisor.readField(parsed.gameId, parsed.filePath, parsed.field);
  } catch {
    return { success: false, error: 'read_failed' };
  }
});

// Propose a write — validates params and current value, creates a pending proposal.
// The proposal must be explicitly approved by calling trainer-host-approve-and-write.
handleGuarded('trainer-host-propose-write', async (event, payload: unknown) => {
  try {
    if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
    if (trainerHostOwner !== null && trainerHostOwner !== event.sender.id) {
      return { success: false, error: 'not_owner' };
    }
    if (!trainerHostSupervisor) return { success: false, error: 'not_running' };

    const parsed = TrainerHostProposeWriteSchema.parse(payload);
    return await trainerHostSupervisor.proposeWrite(
      parsed.gameId, parsed.filePath, parsed.field,
      parsed.currentValue, parsed.newValue,
    );
  } catch {
    return { success: false, error: 'propose_failed' };
  }
});

// Execute a previously proposed write. The proposalId must exist in the supervisor's
// pending-proposal map — consuming it is the approval gate.
ipcMain.handle('trainer-host-approve-and-write', async (event, payload: unknown) => {
  try {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    if (trainerHostOwner !== null && trainerHostOwner !== event.sender.id) {
      return { success: false, error: 'not_owner' };
    }
    if (!trainerHostSupervisor) return { success: false, error: 'not_running' };

    const parsed = TrainerHostApproveAndWriteSchema.parse(payload);
    return await trainerHostSupervisor.approveAndWrite(parsed.proposalId);
  } catch {
    return { success: false, error: 'write_failed' };
  }
});

// Roll back a completed write using the backup created during execute.
ipcMain.handle('trainer-host-rollback', async (event, payload: unknown) => {
  try {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    if (trainerHostOwner !== null && trainerHostOwner !== event.sender.id) {
      return { success: false, error: 'not_owner' };
    }
    if (!trainerHostSupervisor) return { success: false, error: 'not_running' };

    const parsed = TrainerHostRollbackSchema.parse(payload);
    return await trainerHostSupervisor.rollback(
      parsed.filePath, parsed.backupPath, parsed.field, parsed.gameId,
    );
  } catch {
    return { success: false, error: 'rollback_failed' };
  }
});
