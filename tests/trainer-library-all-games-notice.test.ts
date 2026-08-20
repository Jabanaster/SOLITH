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

test('ROADMAP §3.4 All Games first-use notice text matches the page implementation exactly', () => {
  const roadmap = readSource('ROADMAP.md');
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');

  const roadmapMatch = roadmap.match(/> (All Games includes SOLITH.s full eligible catalog[^\n]*)/);
  assert.ok(roadmapMatch, 'ROADMAP.md §3.4 notice text not found');
  const roadmapNotice = roadmapMatch![1];

  assert.match(pageSource, /ALL_GAMES_NOTICE_TEXT =\s*\n?\s*'([^']*All Games includes SOLITH[^']*)'/);
  const pageMatch = pageSource.match(/ALL_GAMES_NOTICE_TEXT =\s*\n?\s*'([^']*)'/);
  assert.ok(pageMatch, 'ALL_GAMES_NOTICE_TEXT constant not found in TrainerLibraryPage.tsx');

  assert.equal(pageMatch![1], roadmapNotice);
});

test('All Games notice only renders in All Games view and is dismissible', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');

  assert.match(source, /viewMode === 'all' && !allGamesNoticeDismissed/);
  assert.match(source, /aria-label="Dismiss All Games notice"/);
  assert.match(source, /handleDismissAllGamesNotice/);
});

test('All Games notice dismissal persists via localStorage, independent of view-mode state', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');

  assert.match(source, /ALL_GAMES_NOTICE_DISMISSED_KEY = 'trainerLibrary\.allGamesNoticeDismissed'/);
  assert.match(source, /window\.localStorage\.getItem\(ALL_GAMES_NOTICE_DISMISSED_KEY\)/);
  assert.match(source, /window\.localStorage\.setItem\(ALL_GAMES_NOTICE_DISMISSED_KEY, '1'\)/);
  // Notice persistence key must be distinct from any selected-view persistence key.
  assert.doesNotMatch(source, /ALL_GAMES_NOTICE_DISMISSED_KEY[\s\S]{0,80}viewMode/);
});

test('Popular remains the default view and All Games is a selectable secondary view', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');

  assert.match(source, /useState<ViewMode>\('popular'\)/);
  assert.match(source, /id="trainer-library-view-popular"/);
  assert.match(source, /id="trainer-library-view-all"/);
});

test('All Games search results flow through the centralized eligibility boundary, not a redeclared one', () => {
  const storeSource = readSource('src/core/trainer-catalog/store.ts');
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');

  assert.match(storeSource, /filterEligibleForTrainerLibrary\(rows\.map\(rowToEntry\)\)/);
  assert.doesNotMatch(pageSource, /function filterEligible/);
});

test('All Games ordering is deterministic and reuses the existing sort model, not a new sort control', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');

  assert.match(source, /viewMode === 'all' &&[\s\S]{0,40}<div className=\{styles\.filterSection\}>\s*<span className=\{styles\.filterLabel\}>Sort<\/span>/);
  assert.doesNotMatch(source, /SortMode = 'installed-first' \| 'a-z' \| /);
});
