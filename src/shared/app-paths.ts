/**
 * src/shared/app-paths.ts
 *
 * Shared path resolver accessible from both src/core and electron/.
 * Does NOT import from Electron directly — uses dynamic import with fallback
 * so it works in tests (tsx), dev, and Electron runtime equally.
 */

import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

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

/** Prefer solith.db; migrate/rename legacy resourceforge.db when present. */
function resolveDatabasePath(userDataRoot: string): string {
  const preferred = path.join(userDataRoot, 'solith.db');
  const legacy = path.join(userDataRoot, 'resourceforge.db');
  try {
    if (!fs.existsSync(preferred) && fs.existsSync(legacy)) {
      fs.renameSync(legacy, preferred);
    }
  } catch {
    // Fall through — callers can still open whichever file exists.
  }
  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(legacy)) return legacy;
  return preferred;
}

export async function getAppPaths(): Promise<SolithAppPaths> {
  let appRoot = projectRoot;
  let userDataRoot = path.join(projectRoot, 'data');

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
  return {
    appRoot: projectRoot,
    databasePath: resolveDatabasePath(path.join(projectRoot, 'data')),
    demoFixtureRoot: path.resolve(projectRoot, 'demo-game')
  };
}
