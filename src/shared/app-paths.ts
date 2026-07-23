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
}

function resolveDatabasePath(userDataRoot: string): string {
  return path.join(userDataRoot, 'solith.db');
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

  return {
    appRoot,
    resourcesRoot,
    userDataRoot,
    databasePath: resolveDatabasePath(userDataRoot),
    demoFixtureRoot: path.resolve(appRoot, 'demo-game')
  };
}

/**
 * Synchronous resolver for use in non-async contexts.
 * Returns dev/test fallback paths. For production, call getAppPaths() instead.
 */
export function getDevPaths() {
  const userDataRoot = resolveFallbackUserDataRoot();
  return {
    appRoot: projectRoot,
    userDataRoot,
    databasePath: resolveDatabasePath(userDataRoot),
    demoFixtureRoot: path.resolve(projectRoot, 'demo-game')
  };
}
