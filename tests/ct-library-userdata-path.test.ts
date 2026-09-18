import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultCtLibraryPaths } from '../src/core/ct-library/search.js';

/**
 * P4-8 §19 fix regression: the personal CT-library read/write base path
 * previously resolved from the compiled module's own directory (the app
 * install/resources tree in a packaged build) instead of Electron's per-user
 * userData directory. `electron/ct-library-ipc.ts` now resolves it via
 * `getAppPaths()` (the same resolver already used for the SQLite DB path)
 * instead of `fileURLToPath(import.meta.url)`-derived module directory.
 */
test('defaultCtLibraryPaths resolves under whatever root it is given (userData-compatible)', () => {
  const userDataRoot = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'Solith');
  const paths = defaultCtLibraryPaths(userDataRoot);
  assert.ok(paths.summaryPath.startsWith(userDataRoot));
  assert.ok(paths.summaryPath.includes(path.join('data', 'ct-library')));
});

test('ct-library-ipc.ts resolves its base path via getAppPaths(), not the compiled module directory', async () => {
  const source = await fs.readFile(new URL('../electron/ct-library-ipc.ts', import.meta.url), 'utf8');
  assert.match(source, /getAppPaths/);
  assert.match(source, /defaultCtLibraryPaths\(userDataRoot\)/);
  // The old defect: resolving a base directory from the compiled module's
  // own location instead of the user data directory.
  assert.ok(!source.includes('fileURLToPath(import.meta.url)'));
});
