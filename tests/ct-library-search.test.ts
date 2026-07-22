import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCtLibraryGameDetail,
  searchCtLibrary,
  type CtLibrarySearchResult,
} from '../src/core/ct-library/search.ts';
import type { CtLibrarySummaryIndex } from '../src/core/ct-library/types.ts';

async function makeLibraryFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'solith-ct-library-'));
  const shardPath = path.join(root, 'avowed.ct-library.json');
  const summaryPath = path.join(root, 'summary.json');
  const summary: CtLibrarySummaryIndex = {
    schemaVersion: 1,
    source: { kind: 'zip-archive', path: 'fixture.zip', sha256: 'a'.repeat(64) },
    generatedAt: '2026-07-20T00:00:00.000Z',
    safety: {
      executableScripts: false,
      memoryWrites: false,
      processAttach: false,
      certificationLevel: 'L0',
      verificationStatus: 'metadata-only',
    },
    totals: {
      ctFiles: 1,
      compiledTables: 1,
      rejectedTables: 0,
      pointers: 1,
      scripts: 1,
      aobSignatures: 1,
      cheats: 3,
    },
    games: [{
      gameId: 'avowed',
      displayName: 'Avowed',
      tableCount: 1,
      cheatCount: 3,
      pointerCount: 1,
      scriptCount: 1,
      aobSignatureCount: 1,
      warningCount: 0,
      rejectionCount: 0,
      sourceTables: ['Avowed/Avowed-Win64-Shipping.CT'],
    }],
    shards: [{
      gameId: 'avowed',
      displayName: 'Avowed',
      tableCount: 1,
      cheatCount: 3,
      path: shardPath,
    }],
  };
  await writeFile(summaryPath, JSON.stringify(summary), 'utf8');
  await writeFile(shardPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: summary.generatedAt,
    safety: summary.safety,
    game: summary.games[0],
    tables: [{
      archivePath: 'Avowed/Avowed-Win64-Shipping.CT',
      game: 'Avowed',
      tableName: 'Avowed Win64 Shipping',
      sourceSha256: 'b'.repeat(64),
      sourceBytes: 1234,
      counts: {
        pointers: 1,
        scripts: 1,
        aobSignatures: 1,
        rejections: 1,
        warnings: 0,
        duplicates: 0,
      },
      rejectedEntries: [
        { name: 'Unsafe Missing Address', reason: 'Missing address; retained as rejected metadata.' },
      ],
      cheats: [
        {
          id: 'ptr-health',
          name: 'Health',
          kind: 'pointer',
          executable: false,
          certificationLevel: 'L0',
          metadata: {
            dataType: 'float',
            moduleName: 'Avowed-Win64-Shipping.exe',
            rawAddress: '"Avowed-Win64-Shipping.exe"+1234',
            baseOffset: '0x1234',
            pointerChain: [16, 32],
            liveResolution: 'resolvable',
          },
        },
        {
          id: 'script-stamina',
          name: 'Stamina script',
          kind: 'script',
          executable: false,
          certificationLevel: 'L0',
          metadata: {
            scriptType: 'AutoAssembler_Script',
            scriptExcerpt: '[ENABLE]',
          },
        },
        {
          id: 'aob-gold',
          name: 'Gold AOB',
          kind: 'aob',
          executable: false,
          certificationLevel: 'L0',
          metadata: {
            symbol: 'goldAob',
            moduleName: 'Avowed-Win64-Shipping.exe',
            scanType: 'aobscanmodule',
            pattern: '48 8B ?? 89',
            sourceEntry: 'Gold script',
            lineNumber: 12,
            warnings: [],
            completeness: 'complete',
          },
        },
      ],
    }],
  }), 'utf8');
  return { summaryPath };
}

describe('CT Library search', () => {
  test('reports unavailable when no CT Library metadata has been imported', async () => {
    const result = await searchCtLibrary({ summaryPath: path.join(os.tmpdir(), 'missing-solith-ct-library.json') });
    assert.equal(result.available, false);
    assert.equal(result.total, 0);
    assert.deepEqual(result.results, []);
    assert.equal(result.error, 'ct_library_not_imported');
  });

  test('searches table metadata and keeps all entries inert', async () => {
    const paths = await makeLibraryFixture();
    const result = await searchCtLibrary(paths, { query: 'gold', kind: 'aob' });
    assert.equal(result.available, true);
    assert.equal(result.total, 1);
    assert.equal(result.results[0]?.title, 'Gold AOB');
    assert.equal(result.results[0]?.type, 'aob');
    assert.equal(result.results[0]?.executable, false);
    assert.equal(result.results[0]?.certificationLevel, 'L0');
  });

  test('searches inert AOB metadata without creating executable records', async () => {
    const paths = await makeLibraryFixture();
    const result = await searchCtLibrary(paths, { query: '48 8B ?? 89', kind: 'aob' });
    assert.equal(result.available, true);
    assert.equal(result.total, 1);
    assert.equal(result.results[0]?.title, 'Gold AOB');
    assert.equal(result.results[0]?.executable, false);
  });

  test('filters by game and exposes table detail for inspection', async () => {
    const paths = await makeLibraryFixture();
    const result = await searchCtLibrary(paths, { gameId: 'avowed' });
    assert.equal(result.total, 3);
    assert.ok(result.results.every((entry: CtLibrarySearchResult) => entry.gameId === 'avowed'));

    const detail = await getCtLibraryGameDetail(paths, 'avowed');
    assert.equal(detail.available, true);
    assert.equal(detail.game?.displayName, 'Avowed');
    assert.equal(detail.tables[0]?.counts.scripts, 1);
    assert.equal(detail.tables[0]?.rejectedEntries?.[0]?.reason, 'Missing address; retained as rejected metadata.');
    assert.equal(detail.tables[0]?.cheats.find((cheat) => cheat.kind === 'aob')?.metadata?.pattern, '48 8B ?? 89');
    assert.equal(detail.tables[0]?.cheats.find((cheat) => cheat.kind === 'pointer')?.metadata?.moduleName, 'Avowed-Win64-Shipping.exe');
  });
});
