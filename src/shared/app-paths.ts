/**
 * src/shared/app-paths.ts
 *
 * Shared path resolver accessible from both src/core and electron/.
 * Does NOT import from Electron directly — uses dynamic import with fallback
 * so it works in tests (tsx), dev, and Electron runtime equally.
 */

import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

// Project root: go up from src/shared/ → src/ → project root
const projectRoot = path.resolve(moduleDirectory, '..', '..');

export interface ResourceForgeAppPaths {
  appRoot: string;
  resourcesRoot: string;
  userDataRoot: string;
  databasePath: string;
  demoFixtureRoot: string;
}

export async function getAppPaths(): Promise<ResourceForgeAppPaths> {
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
    databasePath: path.join(userDataRoot, 'resourceforge.db'),
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
    databasePath: path.join(projectRoot, 'data', 'resourceforge.db'),
    demoFixtureRoot: path.resolve(projectRoot, 'demo-game')
  };
}
