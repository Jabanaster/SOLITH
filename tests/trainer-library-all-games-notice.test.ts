import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Supersedes the pre-freeze "All Games first-use notice" reconciliation
 * tests. ROADMAP §3.4 now records that view/notice as RETIRED — the section
 * hierarchy (§3.3) makes the underlying concern (accidentally scrolling the
 * whole catalog) moot by collapsing "All Other Games" by default instead.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('ROADMAP §3.4 is marked RETIRED', () => {
  const roadmap = readSource('ROADMAP.md');
  assert.match(roadmap, /## 3\.4 All Games — RETIRED/);
});

test('the page no longer renders the retired All Games first-use notice', () => {
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.doesNotMatch(pageSource, /ALL_GAMES_NOTICE_TEXT/);
  assert.doesNotMatch(pageSource, /allGamesNoticeDismissed/i);
});

test('"All Other Games" section is collapsed by default and shows a count instead', () => {
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const librarySectionsSource = readSource('src/core/trainer-catalog/library-sections.ts');
  assert.match(librarySectionsSource, /LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT[\s\S]*?'other'/);
  assert.match(pageSource, /games\.length\.toLocaleString\(\)/, 'section header must show a count');
});
