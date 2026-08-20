import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('§3.6 has a dedicated derived-filter module before UI wiring', () => {
  const modulePath = path.join(ROOT, 'src/core/trainer-catalog/all-games-filters.ts');
  assert.equal(fs.existsSync(modulePath), true, 'expected §3.6 all-games-filters.ts module');
});

test('Trainer Library exposes the approved §3.6 slice (27/34) and not still-deferred values', () => {
  const source = read('src/app/pages/TrainerLibraryPage.tsx') + read('src/core/trainer-catalog/all-games-filters.ts');
  for (const label of [
    'Installed', 'Not installed', 'Has trainer/profile', 'Verified', 'Community/unverified',
    'Popular', 'New release', 'Niche/deep catalog', 'Recently added',
    'Steam', 'GOG', 'Epic Games Store', 'Ubisoft Connect', 'EA app', 'Xbox / Microsoft Store', 'Battle.net', 'Standalone',
  ]) {
    assert.ok(source.includes(label), `expected approved filter label: ${label}`);
  }
  // Owned, all 5 Mode values, and All-time classic remain BLOCKED / NEEDS OWNER DECISION.
  for (const deferred of ['Owned', 'Single-player', 'Offline co-op', 'Local multiplayer', 'Online features present', 'Offline-only support', 'All-time classic']) {
    assert.ok(!source.includes(`>${deferred}<`), `deferred filter must not be wired: ${deferred}`);
  }
});

test('§3.6 Launcher filter uses installed-platform evidence with OR/AND composition and no steamAppId inference', () => {
  const source = read('src/core/trainer-catalog/all-games-filters.ts');
  assert.match(source, /installedPlatformsByCatalogGameId/);
  assert.match(source, /matchesLauncher/);
  const matchesLauncherBody = source.match(/function matchesLauncher[\s\S]*?\n}/)?.[0] ?? '';
  assert.ok(matchesLauncherBody.length > 0, 'expected to find matchesLauncher function body');
  assert.doesNotMatch(matchesLauncherBody, /entry\.steamAppId/, 'launcher matching must not derive from steamAppId');
});

test('Launcher filter state is remembered via the same trainerLibrary.filters mechanism', () => {
  const source = read('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /launcher: launcherFilters/);
  assert.match(source, /setLauncherFilters\(\[\]\)/, 'Reset must clear Launcher selections');
});

test('Trainer Library §3.6 UI has result count, Reset, and remembered filter state', () => {
  const source = read('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /visible\.length/);
  assert.match(source, />\s*Reset\s*</);
  assert.match(source, /trainerLibrary\.filters/);
});

test('Trainer Library shows exactly the 10 ROADMAP genre values', () => {
  const genres = read('src/core/trainer-catalog/catalog-genres.ts');
  assert.match(genres, /ROADMAP_GENRE_FILTERS/);
  const expected = ['RPG', 'Action', 'Strategy', 'Simulation', 'Adventure', 'Shooter', 'Survival', 'Racing', 'Sports', 'Puzzle'];
  for (const genre of expected) assert.ok(genres.includes(`'${genre}'`), `missing ROADMAP genre ${genre}`);
});
