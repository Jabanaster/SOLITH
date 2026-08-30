/**
 * src/shared/app-paths.ts
 *
 * Shared path resolver accessible from both src/core and electron/.
 * Does NOT import from Electron directly — uses dynamic import with fallback
 * so it works in tests (tsx), dev, and Electron runtime equally.
 */

import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { reconcileStorageClasses } from './storage-classes.js';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

// Project root: go up from src/shared/ → src/ → project root
const projectRoot = path.resolve(moduleDirectory, '..', '..');

export interface SolithAppPaths {
  appRoot: string;
  resourcesRoot: string;
  userDataRoot: string;
  databasePath: string;
  demoFixtureRoot: string;
  /** MP-P0.3 — cache/thumbnails/temporary-scans/transient-logs. Safe to wipe. */
  disposableRoot: string;
  /** MP-P0.3 — Recovery Ledger, transaction journal/receipts, backup ownership
   *  metadata, trusted catalog state, definitions, recovery-required research
   *  metadata. Must survive routine cleanup and uninstall. */
  durableRoot: string;
}

function resolveDatabasePath(durableRoot: string): string {
  // MP-P0.3 — solith.db is the Recovery Ledger / trusted catalog / backup
  // ownership metadata store itself, unambiguously durable. Migration of any
  // pre-existing solith.db at the legacy userDataRoot location into
  // durableRoot happens inside reconcileStorageClasses() (the
  // 'solith-db-to-durable-v1' entry), which getAppPaths() always calls
  // before this function, so the file is already in place by the time this
  // path is handed to database/index.ts's initDatabase().
  return path.join(durableRoot, 'solith.db');
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
}

function resolveFallbackUserDataRoot(): string {
  if (process.env.ELECTRON_USER_DATA_PATH) {
    return process.env.ELECTRON_USER_DATA_PATH;
  }
  if (process.env.SOLITH_TEST_USER_DATA_PATH) {
    return process.env.SOLITH_TEST_USER_DATA_PATH;
  }
  if (isTestRuntime()) {
    return path.join(os.tmpdir(), 'solith-test-runtime', String(process.pid), 'userData');
  }
  return path.join(projectRoot, 'data');
}

export async function getAppPaths(): Promise<SolithAppPaths> {
  let appRoot = projectRoot;
  let userDataRoot = resolveFallbackUserDataRoot();

  try {
    const { app } = await import('electron');
    if (app && typeof app.getAppPath === 'function') {
      appRoot = app.getAppPath();
      userDataRoot = app.getPath('userData');
    }
  } catch {
    // Not running inside Electron — use filesystem-relative fallback (tests / dev)
  }

  const resourcesRoot = (process as any).resourcesPath || appRoot;
  const { disposableRoot, durableRoot } = reconcileStorageClasses(userDataRoot);

  return {
    appRoot,
    resourcesRoot,
    userDataRoot,
    databasePath: resolveDatabasePath(durableRoot),
    demoFixtureRoot: path.resolve(appRoot, 'demo-game'),
    disposableRoot,
    durableRoot
  };
}

/**
 * Synchronous resolver for use in non-async contexts.
 * Returns dev/test fallback paths. For production, call getAppPaths() instead.
 */
export function getDevPaths() {
  const userDataRoot = resolveFallbackUserDataRoot();
  const { durableRoot } = reconcileStorageClasses(userDataRoot);
  return {
    appRoot: projectRoot,
    userDataRoot,
    databasePath: resolveDatabasePath(durableRoot),
    demoFixtureRoot: path.resolve(projectRoot, 'demo-game')
  };
}
