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

test('Trainer Library exposes the approved §3.6 slice (33/34) and not the still-blocked value', () => {
  // Owner-directed redesign: the 7 always-visible filter-chip-rows moved into
  // one collapsible popover component (TrainerLibraryFiltersPopover.tsx) —
  // the labels themselves are unchanged, just relocated out of the page file.
  const source =
    read('src/app/pages/TrainerLibraryPage.tsx') +
    read('src/app/pages/TrainerLibraryFiltersPopover.tsx') +
    read('src/core/trainer-catalog/all-games-filters.ts');
  for (const label of [
    'Installed', 'Not installed', 'Has trainer/profile', 'Verified', 'Community/unverified', 'Owned',
    'Single-player', 'Offline co-op', 'Local multiplayer', 'Online features present',
    'Popular', 'New release', 'Niche/deep catalog', 'Recently added', 'All-time classic',
    'Steam', 'GOG', 'Epic Games Store', 'Ubisoft Connect', 'EA app', 'Xbox / Microsoft Store', 'Battle.net', 'Standalone',
  ]) {
    assert.ok(source.includes(label), `expected approved filter label: ${label}`);
  }
  // Offline-only support was left NEEDS OWNER DECISION (Step 10 ambiguity) — not wired.
  for (const deferred of ['Offline-only support']) {
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

test('§3.6 Mode filter uses curated modeCapabilities evidence only, never categories/antiCheat inference', () => {
  const source = read('src/core/trainer-catalog/all-games-filters.ts');
  assert.match(source, /function matchesMode/);
  const matchesModeBody = source.match(/function matchesMode[\s\S]*?\n}/)?.[0] ?? '';
  assert.ok(matchesModeBody.length > 0, 'expected to find matchesMode function body');
  assert.doesNotMatch(matchesModeBody, /entry\.categories/, 'mode matching must not derive from categories');
  assert.doesNotMatch(matchesModeBody, /entry\.antiCheat/, 'mode matching must not derive from antiCheat');
});

test('§3.6 All-time classic is a curated flag, never derived from releaseDate or popularity', () => {
  const source = read('src/core/trainer-catalog/all-games-filters.ts');
  const matchesCatalogBody = source.match(/function matchesCatalog[\s\S]*?\n}/)?.[0] ?? '';
  const classicCase = matchesCatalogBody.match(/case 'all-time-classic':[\s\S]*?(?=case |\n {4}\})/)?.[0] ?? '';
  assert.ok(classicCase.length > 0, 'expected to find the all-time-classic case branch');
  assert.match(classicCase, /entry\.isAllTimeClassic === true/);
});

test('§3.6 Owned is set only via a deliberate local user action, never automatic Installed -> Owned promotion', () => {
  const filtersSource = read('src/core/trainer-catalog/all-games-filters.ts');
  const matchesAvailabilityBody = filtersSource.match(/function matchesAvailability[\s\S]*?\n}/)?.[0] ?? '';
  const ownedCase = matchesAvailabilityBody.match(/case 'owned':[\s\S]*?(?=case |\n {4}\})/)?.[0] ?? '';
  assert.match(ownedCase, /entry\.ownedConfirmed === true/);

  const pageSource = read('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(pageSource, /handleToggleOwned/);
  assert.match(pageSource, /trainerCatalogSetOwned/);
});

test('Mode filter state is remembered via the same trainerLibrary.filters mechanism', () => {
  const source = read('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /mode: modeFilters/);
  assert.match(source, /setModeFilters\(\[\]\)/, 'Reset must clear Mode selections');
});

test('Trainer Library §3.6 UI has result count, Reset, and remembered filter state', () => {
  // Note: the Personal Library Completion pass replaced the flat `visible`
  // array (pre-section-hierarchy) with `total` (the count driving the header
  // summary) plus per-section counts from organizeLibrary. The result-count,
  // Reset, and persisted-filter behavior this test guards is unchanged.
  const source = read('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /total\.toLocaleString\(\)/);
  assert.match(source, />\s*Reset\s*</);
  assert.match(source, /trainerLibrary\.filters/);
});

test('Trainer Library shows exactly the 10 ROADMAP genre values', () => {
  const genres = read('src/core/trainer-catalog/catalog-genres.ts');
  assert.match(genres, /ROADMAP_GENRE_FILTERS/);
  const expected = ['RPG', 'Action', 'Strategy', 'Simulation', 'Adventure', 'Shooter', 'Survival', 'Racing', 'Sports', 'Puzzle'];
  for (const genre of expected) assert.ok(genres.includes(`'${genre}'`), `missing ROADMAP genre ${genre}`);
});
