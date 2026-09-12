import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAllCatalogProcesses, matchCatalogProcess } from '../src/core/live-memory/process-watcher.ts';
import type { LiveProcessListEntry } from '../src/core/live-memory/native-memory-driver.ts';
import type { CatalogExecutableEntry } from '../src/core/live-memory/process-watcher.ts';

// Regression coverage for the P3 game-detection root causes: the watch used
// to only look at the first 200 catalog rows and only report the first
// matching process, so a running game outside that window (or a second
// running game) was silently invisible.

const CATALOG: CatalogExecutableEntry[] = [
  { catalogGameId: 'dredge', displayName: 'Dredge', executables: ['DREDGE.exe'] },
  { catalogGameId: 'palworld', displayName: 'Palworld', executables: ['Palworld-Win64-Shipping.exe'] },
];

function proc(pid: number, name: string): LiveProcessListEntry {
  return { pid, name } as LiveProcessListEntry;
}

describe('matchAllCatalogProcesses', () => {
  test('finds a catalog match regardless of catalog list position', () => {
    // A big catalog where the matching entry is far past any fixed page size.
    const bigCatalog: CatalogExecutableEntry[] = Array.from({ length: 500 }, (_, i) => ({
      catalogGameId: `filler-${i}`,
      displayName: `Filler ${i}`,
      executables: [`filler-${i}.exe`],
    }));
    bigCatalog.push(CATALOG[0]);

    const result = matchAllCatalogProcesses([proc(100, 'DREDGE.exe')], bigCatalog);
    assert.equal(result.length, 1);
    assert.equal(result[0].catalogGameId, 'dredge');
  });

  test('reports every running catalog game, not just the first', () => {
    const result = matchAllCatalogProcesses(
      [proc(100, 'DREDGE.exe'), proc(200, 'Palworld-Win64-Shipping.exe')],
      CATALOG,
    );
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((r) => r.catalogGameId).sort(),
      ['dredge', 'palworld'],
    );
  });

  test('matchCatalogProcess still returns a single first match for back-compat callers', () => {
    const result = matchCatalogProcess([proc(100, 'DREDGE.exe')], CATALOG);
    assert.equal(result?.catalogGameId, 'dredge');
  });

  test('no match returns an empty list, not null/throw', () => {
    const result = matchAllCatalogProcesses([proc(1, 'notepad.exe')], CATALOG);
    assert.deepEqual(result, []);
  });
});
