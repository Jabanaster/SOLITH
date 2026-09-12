import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { sortTrainerLibraryFlatEntries } from '../src/app/pages/trainer-library-sort-options.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

/**
 * REVERSAL NOTICE (2026-09-10, Gate 2.5 doc-audit pass): the Mission 3/24
 * freeze this file used to enforce ("the 10-mode sort UI is retired, do not
 * re-add it") has been EXPLICITLY OVERRIDDEN by the owner. The section
 * hierarchy (library-sections.ts's organizeLibrary) stays exactly as it
 * was — Installed > Owned-Supported > Owned-Unsupported > Other > Missing,
 * A-Z within each section — but a real Sort control is back on top of the
 * flat/All-Games browse view (TrainerLibrarySortMenu.tsx), because "MY
 * games and MY trainers first" still needs a way to reorder the flat catalog
 * browse itself. This file now tests THAT control instead of asserting sort
 * modes must never return.
 *
 * Scope decision (see trainer-library-sort-options.ts's header comment):
 * sort applies to the flat view only. It can never contradict or reorder
 * the 5-section hierarchy, because it is never applied across section
 * boundaries — each section still sorts A-Z internally, unconditionally.
 *
 * SECOND REVERSAL NOTICE (2026-09-10, Personal Library Completion — Final
 * Closure Pass, Mission 2): the "recommended matches all-games-sorting.ts's
 * own recommended output verbatim" test below (previously proving 'recommended'
 * delegated unchanged to all-games-sorting.ts's installed/popularity-only
 * ranking model) has been REPLACED. The owner rejected that behavior
 * specifically: it had no owned/favorite/trainerAccuracy concept, so an
 * unowned catalog game with a great trainer could outrank an installed or
 * confirmed-owned game in the real rendered page even though the standalone
 * personal-priority-comparator.ts unit tests proved that could never happen
 * in isolation. 'recommended' now routes through
 * personal-priority-catalog-adapter.ts's sortCatalogEntriesByPersonalPriority
 * (see that file's header comment), which delegates to the SAME
 * personal-priority-comparator.ts policy already unit-tested in
 * tests/personal-priority-comparator.test.ts — nothing here reinvents that
 * comparator's logic, this only proves it is actually wired into the real
 * sort pipeline the page calls.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

function baseEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'test-game',
    displayName: 'Test Game',
    executables: ['Test.exe'],
    categories: ['Action'],
    verificationStatus: 'metadata-only',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: 'test game',
    ...overrides,
  };
}

test('the page renders a real Sort control (TrainerLibrarySortMenu), not the retired always-A-Z-only design', () => {
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(pageSource, /TrainerLibrarySortMenu/);
  assert.match(pageSource, /sortOption/);
});

test('Recommended is the default sort option', () => {
  const optionsSource = readSource('src/app/pages/trainer-library-sort-options.ts');
  assert.match(optionsSource, /DEFAULT_TRAINER_LIBRARY_SORT_OPTION[^=]*=\s*'recommended'/);
});

test('every required sort option is selectable: Recommended, A-Z, Z-A, Recently added, Trainer quality', () => {
  const optionsSource = readSource('src/app/pages/trainer-library-sort-options.ts');
  for (const option of ['recommended', 'a-z', 'z-a', 'recently-added', 'trainer-quality']) {
    assert.ok(optionsSource.includes(`'${option}'`), `expected sort option "${option}" to be defined`);
  }
});

test('the section hierarchy (organizeLibrary) is untouched — sort never drives the primary section organization', () => {
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(pageSource, /organizeLibrary\(favoriteFilteredEvidence\)/);
  // The frozen flat-A-Z baseline expression is still the literal source of
  // truth for the flat view before the newly-restored sort control reorders
  // it — proves sort is layered ON TOP OF, not INSTEAD OF, the existing
  // frozen flat-view branch.
  assert.match(pageSource, /flatAZView \? sortLibraryAZ\(favoriteFilteredEvidence\) : null/);
});

test('all-games-sorting.ts module is reused (not reinvented) for Recently added, and personal-priority-catalog-adapter.ts is reused (not reinvented) for Recommended', () => {
  const optionsSource = readSource('src/app/pages/trainer-library-sort-options.ts');
  assert.match(optionsSource, /from '\.\.\/\.\.\/core\/trainer-catalog\/all-games-sorting\.js'/);
  assert.match(optionsSource, /sortAllGamesEntries\(entries, 'recently-added', context\)/);
  assert.match(optionsSource, /from '\.\.\/\.\.\/core\/trainer-catalog\/personal-priority-catalog-adapter\.js'/);
  assert.match(optionsSource, /sortCatalogEntriesByPersonalPriority\(entries, priorityContext\)/);
});

test('comparator: a-z sorts by display name ascending, tie-broken by catalogGameId', () => {
  const entries = [
    baseEntry({ catalogGameId: 'b', displayName: 'Beta' }),
    baseEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    baseEntry({ catalogGameId: 'z2', displayName: 'Same' }),
    baseEntry({ catalogGameId: 'z1', displayName: 'Same' }),
  ];
  const sorted = sortTrainerLibraryFlatEntries(entries, 'a-z');
  assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'b', 'z1', 'z2']);
});

test('comparator: z-a is the exact reverse of a-z', () => {
  const entries = [
    baseEntry({ catalogGameId: 'b', displayName: 'Beta' }),
    baseEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    baseEntry({ catalogGameId: 'c', displayName: 'Gamma' }),
  ];
  const az = sortTrainerLibraryFlatEntries(entries, 'a-z').map((e) => e.catalogGameId);
  const za = sortTrainerLibraryFlatEntries(entries, 'z-a').map((e) => e.catalogGameId);
  assert.deepEqual(za, [...az].reverse());
});

test('comparator: trainer quality ranks verified > community > metadata-only, then hasModPack, then cheatCount', () => {
  const entries = [
    baseEntry({ catalogGameId: 'meta', displayName: 'Meta', verificationStatus: 'metadata-only' }),
    baseEntry({ catalogGameId: 'verified-low', displayName: 'VerifiedLow', verificationStatus: 'verified', hasModPack: true, cheatCount: 1 }),
    baseEntry({ catalogGameId: 'community', displayName: 'Community', verificationStatus: 'community', hasModPack: true, cheatCount: 50 }),
    baseEntry({ catalogGameId: 'verified-high', displayName: 'VerifiedHigh', verificationStatus: 'verified', hasModPack: true, cheatCount: 10 }),
  ];
  const sorted = sortTrainerLibraryFlatEntries(entries, 'trainer-quality');
  assert.deepEqual(sorted.map((e) => e.catalogGameId), ['verified-high', 'verified-low', 'community', 'meta']);
});

test('comparator: recommended puts installed ahead of a merely-popular unowned catalog entry (personal-priority-comparator.ts policy, not the retired popularity-only model)', () => {
  const entries = [
    // Unowned, not installed, not running, not favorited — but "great trainer"
    // (verified + LOCALLY_VERIFIED-caliber accuracy evidence via hasModPack).
    baseEntry({ catalogGameId: 'x', displayName: 'X', verificationStatus: 'verified', hasModPack: true, cheatCount: 999 }),
    // Installed, but weaker trainer evidence (metadata-only, no mod pack).
    baseEntry({ catalogGameId: 'y', displayName: 'Y', verificationStatus: 'metadata-only', hasModPack: false }),
  ];
  const installedCatalogGameIds = new Set(['y']);
  const sorted = sortTrainerLibraryFlatEntries(entries, 'recommended', { installedCatalogGameIds });
  assert.deepEqual(
    sorted.map((e) => e.catalogGameId),
    ['y', 'x'],
    'an installed game must never be outranked by an unowned catalog game, no matter how strong its trainer evidence',
  );
});

test('comparator: recommended end-to-end pipeline exercises the full RUNNING > INSTALLED > CONFIRMED_OWNED > FAVORITE_OR_RECENT > UNOWNED_CATALOG tier order via the real sort pipeline the page calls', () => {
  const entries = [
    baseEntry({ catalogGameId: 'unowned', displayName: 'Unowned' }),
    baseEntry({ catalogGameId: 'favorite', displayName: 'Favorite' }),
    baseEntry({ catalogGameId: 'owned', displayName: 'Owned', ownedConfirmed: true }),
    baseEntry({ catalogGameId: 'installed', displayName: 'Installed' }),
    baseEntry({ catalogGameId: 'running', displayName: 'Running' }),
  ];
  const sorted = sortTrainerLibraryFlatEntries(entries, 'recommended', {
    installedCatalogGameIds: new Set(['installed', 'running']),
    runningCatalogGameIds: new Set(['running']),
    favoriteCatalogGameIds: new Set(['favorite']),
  });
  assert.deepEqual(
    sorted.map((e) => e.catalogGameId),
    ['running', 'installed', 'owned', 'favorite', 'unowned'],
  );
});

test('all-games-sorting.ts module itself is NOT deleted (other callers may still need it)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/core/trainer-catalog/all-games-sorting.ts')));
});
