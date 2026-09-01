import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  // Normalize CRLF to LF — core.autocrlf can materialize tracked files with
  // CRLF on Windows checkouts, and this file's regexes are LF-anchored.
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('ROADMAP §3.5 lists exactly 10 sort keys, and all 10 are wired as functional sort buttons', () => {
  const roadmap = readSource('ROADMAP.md');
  const section = roadmap.match(/## 3\.5 Sorting\n([\s\S]*?)\n## 3\.6/);
  assert.ok(section, 'ROADMAP.md §3.5 section not found');
  const keys = section![1].split('\n').filter((line) => line.startsWith('- '));
  assert.equal(keys.length, 10, 'ROADMAP §3.5 key count changed — re-run reconciliation before trusting this test');

  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const modeToLabel: Record<string, string> = {
    recommended: 'Recommended',
    'popular-now': 'Popular now',
    'all-time-popular': 'All-time popular',
    'newest-release': 'Newest release',
    'recently-added': 'Recently added to SOLITH',
    'recently-updated': 'Recently updated',
    'a-z': 'A–Z',
    'installed-first': 'Installed first',
    'verified-first': 'Verified first',
    'most-trainer-options': 'Most trainer options',
  };
  assert.equal(Object.keys(modeToLabel).length, 10);
  for (const [mode, label] of Object.entries(modeToLabel)) {
    assert.ok(pageSource.includes(`setSortMode('${mode}')`), `"${mode}" must be wired as a functional sort button`);
    assert.ok(pageSource.includes(label), `expected sort label "${label}" (exact ROADMAP terminology) in TrainerLibraryPage.tsx`);
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
