import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Mission 16 hostile-review follow-up: personal-library-ipc.ts (Favorites +
 * Support Requests) previously accepted any renderer-supplied canonicalGameId
 * string with no check it corresponds to a real catalog entry. Low blast
 * radius (no memory/process access — only local rows) but still a real gap
 * against the hostile-review checklist item "unsupported-game-becomes-
 * trusted-canonical" (here: nonexistent-game-becomes-a-real-row). Static
 * source inspection matches this project's established convention for
 * verifying Electron IPC wiring without a full Electron test harness.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('favorite-game and request-game-support reject an unknown canonicalGameId before writing any row', () => {
  const source = readSource('electron/personal-library-ipc.ts');
  assert.match(source, /import \{ getCatalogEntry \} from '\.\.\/src\/core\/trainer-catalog\/store\.js';/);
  assert.match(source, /function requireKnownCatalogGameId/);

  const favoriteHandler = source.match(/guardedHandle\('favorite-game'[\s\S]*?\n {2}\}\);/)?.[0] ?? '';
  assert.match(favoriteHandler, /requireKnownCatalogGameId\(parsed\.canonicalGameId\)/);
  assert.match(favoriteHandler, /if \(!known\.ok\) return \{ success: false, error: known\.error \};/);

  const requestSupportHandler = source.match(/guardedHandle\('request-game-support'[\s\S]*?\n {2}\}\);/)?.[0] ?? '';
  assert.match(requestSupportHandler, /requireKnownCatalogGameId\(parsed\.canonicalGameId\)/);
});

test('the known-game check uses getCatalogEntry, which includes unsupported games — Mission 7 must still work', () => {
  const source = readSource('electron/personal-library-ipc.ts');
  const storeSource = readSource('src/core/trainer-catalog/store.ts');
  assert.match(source, /getCatalogEntry\(canonicalGameId\)/);
  // getCatalogEntry queries trainer_catalog_games unconditionally on catalogGameId —
  // no trainer/mod-pack-support filter — so a real-but-unsupported game still passes.
  const entryFn = storeSource.match(/export function getCatalogEntry\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(entryFn.length > 0);
  assert.doesNotMatch(entryFn, /hasModPack|hasTrainerSupport/i, 'must not filter by trainer support');
});

test('unfavorite-game stays unguarded by the known-game check (removing a nonexistent favorite is a harmless no-op)', () => {
  const source = readSource('electron/personal-library-ipc.ts');
  const unfavoriteHandler = source.match(/guardedHandle\('unfavorite-game'[\s\S]*?\n {2}\}\);/)?.[0] ?? '';
  assert.doesNotMatch(unfavoriteHandler, /requireKnownCatalogGameId/);
});
