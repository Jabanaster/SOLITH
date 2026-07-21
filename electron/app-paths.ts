/**
 * electron/app-paths.ts
 *
 * Re-exports from src/shared/app-paths so Electron main-process code
 * can import from either location without duplication.
 */
export { getAppPaths, getDevPaths } from '../src/shared/app-paths.js';
export type { SolithAppPaths } from '../src/shared/app-paths.js';
