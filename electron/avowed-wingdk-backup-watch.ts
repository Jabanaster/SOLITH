/**
 * Avowed WinGDK save/config backup orchestrator (Electron main process).
 *
 * - Watches Packages\Microsoft.Avowed*\SystemAppData\wgs via fs.watch
 * - One-time Alabama Config\WinGDK snapshot on Avowed attach
 * - READ + COPY into userData/backups/avowed-wingdk only
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { reconcileStorageClasses } from '../src/shared/storage-classes.js';
import {
  isAvowedAttachExecutable,
  isAvowedWingdkExecutable,
  resolveAvowedWingdkWgsDir,
  snapshotAvowedAlabamaConfig,
  snapshotAvowedWingdkSaves,
  type AvowedWingdkSnapshotResult,
} from '../src/core/backups/avowed-wingdk.js';

const SAVE_DEBOUNCE_MS = 1500;

export interface AvowedWingdkAttachContext {
  executableName: string;
  catalogGameId?: string;
}

let watcher: fs.FSWatcher | null = null;
let watchedWgsDir: string | null = null;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let configSnapshotDoneForSession = false;
let activeSessionKey: string | null = null;
let lastSaveResult: AvowedWingdkSnapshotResult | null = null;
let lastConfigResult: AvowedWingdkSnapshotResult | null = null;

// MP-P0.3 — Avowed WinGDK save/config backups are durable recovery state
// (not disposable). All three uses of this helper feed the backup-root
// chain (resolveAvowedWingdkBackupRoots / the status report below), so it
// now returns the durable root rather than raw userData.
function avowedWingdkBackupRoot(): string {
  return reconcileStorageClasses(app.getPath('userData')).durableRoot;
}

function log(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.info(`[avowed-wingdk-backup] ${message}`, detail);
  } else {
    console.info(`[avowed-wingdk-backup] ${message}`);
  }
}

function clearSaveDebounce(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
}

export function stopAvowedWingdkSaveWatcher(): void {
  clearSaveDebounce();
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore close races
    }
    watcher = null;
  }
  watchedWgsDir = null;
}

export function resetAvowedWingdkBackupSession(): void {
  stopAvowedWingdkSaveWatcher();
  configSnapshotDoneForSession = false;
  activeSessionKey = null;
}

function scheduleSaveSnapshot(reason: string): void {
  clearSaveDebounce();
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    const result = snapshotAvowedWingdkSaves({
      userDataRoot: avowedWingdkBackupRoot(),
      label: `autosave-${reason}-${Date.now()}`,
    });
    lastSaveResult = result;
    if (result.success) {
      log(`save snapshot ok (${result.filesCopied} files) → ${result.destDir}`);
    } else if (result.skipped) {
      log(`save snapshot skipped: ${result.reason}`);
    } else {
      log(`save snapshot failed: ${result.error}`);
    }
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Start recursive fs.watch on the WinGDK wgs container (autosave detection).
 */
export function startAvowedWingdkSaveWatcher(): boolean {
  const wgsDir = resolveAvowedWingdkWgsDir();
  if (!wgsDir) {
    log('wgs watch not started — package/wgs path not found');
    return false;
  }

  if (watcher && watchedWgsDir === wgsDir) {
    return true;
  }

  stopAvowedWingdkSaveWatcher();

  try {
    watcher = fs.watch(wgsDir, { recursive: true }, (eventType) => {
      if (eventType !== 'change' && eventType !== 'rename') return;
      scheduleSaveSnapshot(eventType);
    });
    watchedWgsDir = wgsDir;
    watcher.on('error', (err) => {
      log('wgs watcher error', err instanceof Error ? err.message : String(err));
      stopAvowedWingdkSaveWatcher();
    });
    log(`watching wgs: ${wgsDir}`);
    return true;
  } catch (err) {
    log('failed to start wgs watcher', err instanceof Error ? err.message : String(err));
    watcher = null;
    watchedWgsDir = null;
    return false;
  }
}

/**
 * One-time launch config snapshot (Alabama WinGDK) before memory toggles.
 */
export function takeAvowedLaunchConfigSnapshot(force = false): AvowedWingdkSnapshotResult {
  if (configSnapshotDoneForSession && !force) {
    return (
      lastConfigResult ?? {
        success: true,
        kind: 'config',
        sourceDir: null,
        destDir: null,
        filesCopied: 0,
        skipped: true,
        reason: 'already_snapshotted',
      }
    );
  }

  const result = snapshotAvowedAlabamaConfig({
    userDataRoot: avowedWingdkBackupRoot(),
    label: `launch-${Date.now()}`,
  });
  lastConfigResult = result;
  configSnapshotDoneForSession = true;

  if (result.success) {
    log(`config launch snapshot ok (${result.filesCopied} files) → ${result.destDir}`);
  } else if (result.skipped) {
    log(`config launch snapshot skipped: ${result.reason}`);
  } else {
    log(`config launch snapshot failed: ${result.error}`);
  }
  return result;
}

/**
 * Called when ProcessWatcher / live-memory attach confirms an Avowed process.
 * Takes config snapshot first, then starts wgs monitoring for WinGDK.
 */
export function onAvowedProcessAttached(ctx: AvowedWingdkAttachContext): {
  config: AvowedWingdkSnapshotResult | null;
  watcherStarted: boolean;
} {
  if (!isAvowedAttachExecutable(ctx.executableName) && ctx.catalogGameId !== 'avowed') {
    return { config: null, watcherStarted: false };
  }

  const sessionKey = `${ctx.catalogGameId ?? 'avowed'}:${ctx.executableName}`;
  if (activeSessionKey !== sessionKey) {
    // New attach session — allow another one-time config snapshot.
    configSnapshotDoneForSession = false;
    activeSessionKey = sessionKey;
  }

  // Config rollback point BEFORE any memory feature toggles.
  const config = takeAvowedLaunchConfigSnapshot();

  let watcherStarted = false;
  if (isAvowedWingdkExecutable(ctx.executableName) || resolveAvowedWingdkWgsDir()) {
    watcherStarted = startAvowedWingdkSaveWatcher();
  }

  return { config, watcherStarted };
}

/**
 * MemoryManager write-confirmed hook — refresh save snapshot while attached.
 * Debounced; does not write into game directories.
 */
export function onAvowedMemoryManagerSnapshotEvent(): void {
  if (!activeSessionKey) return;
  if (!watchedWgsDir && !resolveAvowedWingdkWgsDir()) return;
  if (!watcher) {
    startAvowedWingdkSaveWatcher();
  }
  scheduleSaveSnapshot('memory-write');
}

export function getAvowedWingdkBackupDebugState(): {
  watching: boolean;
  watchedWgsDir: string | null;
  activeSessionKey: string | null;
  configSnapshotDoneForSession: boolean;
  lastSaveResult: AvowedWingdkSnapshotResult | null;
  lastConfigResult: AvowedWingdkSnapshotResult | null;
  backupRoot: string;
} {
  return {
    watching: watcher != null,
    watchedWgsDir,
    activeSessionKey,
    configSnapshotDoneForSession,
    lastSaveResult,
    lastConfigResult,
    backupRoot: path.join(avowedWingdkBackupRoot(), 'backups', 'avowed-wingdk'),
  };
}
