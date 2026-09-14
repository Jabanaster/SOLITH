import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ALL_GAMES_SORT_MODE_LABELS } from '../src/core/trainer-catalog/all-games-sorting.js';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  // Normalize CRLF to LF — core.autocrlf can materialize tracked files with
  // CRLF on Windows checkouts, and this file's regexes are LF-anchored.
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('every AllGamesSortMode key has a functional, correctly labeled sort button', () => {
  // Source of truth is the exported, TypeScript-checked registry in
  // all-games-sorting.ts (Record<AllGamesSortMode, string>) — not ROADMAP.md
  // prose. The compiler itself already refuses to build if a sort mode is
  // ever added to AllGamesSortMode without a label here, which the old
  // roadmap-parsing version of this test could not guarantee. See
  // Docs/roadmap/STEP_0.14.1_ROADMAP_CONTRACT_REPAIR.md.
  const modeToLabel = ALL_GAMES_SORT_MODE_LABELS;
  assert.equal(Object.keys(modeToLabel).length, 10, 'AllGamesSortMode key count changed — update this test\'s expectations deliberately');

  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  for (const [mode, label] of Object.entries(modeToLabel)) {
    assert.ok(pageSource.includes(`setSortMode('${mode}')`), `"${mode}" must be wired as a functional sort button`);
    assert.ok(pageSource.includes(label), `expected sort label "${label}" (from ALL_GAMES_SORT_MODE_LABELS) in TrainerLibraryPage.tsx`);
  }
});

test('Sort controls only render in All Games view and never in Popular', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /\{viewMode === 'all' && \(\s*\n\s*<div className=\{styles\.filterSection\}>\s*\n\s*<span className=\{styles\.filterLabel\}>Sort<\/span>/);
});

test('All Games sorting uses the derived sortAllGamesEntries projection, not an inline sort', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /sortAllGamesEntries\(filteredEntries, sortMode, \{/);
  assert.doesNotMatch(source, /filteredEntries\s*\n\s*\.slice\(\)\s*\n\s*\.sort\(/);
});

test('Popular view still uses projectPopularTrainerEntries — Phase 3B ranking is untouched by §3.5', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /viewMode === 'popular'\s*\n\s*\? projectPopularTrainerEntries\(filteredEntries, \{/);
});

test('Phase 3C All Games first-use notice remains intact (no regression)', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /viewMode === 'all' && !allGamesNoticeDismissed/);
  assert.match(source, /ALL_GAMES_NOTICE_DISMISSED_KEY = 'trainerLibrary\.allGamesNoticeDismissed'/);
});

test('Default sort mode remains installed-first — Recommended is not defaulted by inference', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /useState<SortMode>\('installed-first'\)/);
});
