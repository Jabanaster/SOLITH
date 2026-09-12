import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Core Product Completion audit, Mission 1 — confirms TrainerLibraryPage.tsx
 * actually normalizes every catalog entry's displayName at the renderer's
 * IPC-receipt boundary, not just that the utility function itself works
 * (see tests/safe-display-text.test.ts for that).
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('the page imports and defines a single normalizeCatalogEntryDisplay boundary function', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /import \{ toSafeDisplayText \} from '\.\.\/\.\.\/shared\/safe-display-text\.js';/);
  assert.match(source, /function normalizeCatalogEntryDisplay\(entry: TrainerCatalogEntry\): TrainerCatalogEntry/);
});

test('every IPC-receipt site that populates catalog entries applies normalizeCatalogEntryDisplay', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const occurrences = source.match(/normalizeCatalogEntryDisplay/g) ?? [];
  // 1 definition + at least 3 call sites (fetchPage, fetchAllCandidatePages, the filter-universe effect).
  assert.ok(occurrences.length >= 4, `expected normalizeCatalogEntryDisplay to be both defined and applied at every entries-receipt site, found ${occurrences.length} occurrences`);
  assert.doesNotMatch(source, /all\.push\(\.\.\.result\.entries\)[^.]/, 'a raw, unnormalized entries push would reintroduce the bidi-spoofing gap');
});

test('the unmatched-local-install synthetic display name is also normalized (launcher-supplied string)', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /toSafeDisplayText\(game\.displayName\?\.trim\(\) \|\| ''\)/);
});
