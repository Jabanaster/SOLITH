/**
 * Discovery Catalog — real on-disk storage footprint measurement
 * (Mission 22 partial, Phase 1 online-foundation).
 *
 * Seeds discovery_catalog_entries with 10,000 / 50,000 / 100,000 synthetic
 * records, each against a fresh on-disk sql.js database file (via
 * resetForTesting(tempPath) — see src/core/database/index.ts), flushes
 * pending persistence, then measures the REAL persisted file size with
 * fs.statSync(path).size. No estimation — this reads the actual bytes on
 * disk after each size tier.
 *
 * NOT wired into the default `npm test` run (package.json's "test" script)
 * — seeding 100k rows through sql.js is slow enough that it does not belong
 * in the fast feedback loop. Run explicitly:
 *   npx tsx --test tests/discovery-catalog-storage-footprint.test.ts
 */
import { after as afterAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting, flushPersistence, closeDatabaseSafely } from '../src/core/database/index.ts';
import { upsertDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';

function syntheticEntry(i: number): DiscoveryCatalogEntry {
  return {
    solithGameId: `synthetic-${i}`,
    title: `Synthetic Game Number ${i}`,
    normalizedTitle: `synthetic game number ${i}`,
    aliases: [`SG${i}`, `synth-${i}`],
    providerIds: { steam: String(1000000 + i), gog: String(2000000 + i) },
    type: 'game',
    releaseDate: `${2000 + (i % 25)}-01-15`,
    releaseYear: 2000 + (i % 25),
    genres: i % 7 === 0 ? ['Simulation', 'Farming'] : ['Action', 'Adventure'],
    tags: ['synthetic-fixture', `batch-${i % 10}`],
    trainerAvailable: i % 3 === 0,
    ctAvailable: i % 5 === 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const tempRoot = path.join(os.tmpdir(), `solith-discovery-catalog-footprint-${Date.now()}`);

const results: Array<{ rowCount: number; bytes: number }> = [];

async function measureAtScale(rowCount: number): Promise<{ rowCount: number; bytes: number }> {
  const dbPath = path.join(tempRoot, `discovery-catalog-${rowCount}.db`);
  await resetForTesting(dbPath);

  for (let i = 0; i < rowCount; i += 1) {
    upsertDiscoveryCatalogEntry(syntheticEntry(i));
  }

  await flushPersistence();
  await closeDatabaseSafely();

  const bytes = fs.statSync(dbPath).size;
  return { rowCount, bytes };
}

describe('discovery catalog — real on-disk storage footprint', () => {
  afterAll(async () => {
    try {
      await resetForTesting();
    } catch { /* ignore */ }
    try {
      if (fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Storage footprint test cleanup failed:', error);
    }
  });

  test('measures real persisted bytes at 10,000 rows', async () => {
    const measurement = await measureAtScale(10_000);
    results.push(measurement);
    console.log(`[discovery-catalog-footprint] 10,000 rows -> ${measurement.bytes} bytes on disk`);
    assert.ok(measurement.bytes > 0);
  });

  test('measures real persisted bytes at 50,000 rows', async () => {
    const measurement = await measureAtScale(50_000);
    results.push(measurement);
    console.log(`[discovery-catalog-footprint] 50,000 rows -> ${measurement.bytes} bytes on disk`);
    assert.ok(measurement.bytes > 0);
  });

  test('measures real persisted bytes at 100,000 rows', async () => {
    const measurement = await measureAtScale(100_000);
    results.push(measurement);
    console.log(`[discovery-catalog-footprint] 100,000 rows -> ${measurement.bytes} bytes on disk`);
    assert.ok(measurement.bytes > 0);
  });

  test('storage grows monotonically with row count and reports a summary', () => {
    assert.equal(results.length, 3, 'all three scale measurements must have run');
    const sorted = [...results].sort((a, b) => a.rowCount - b.rowCount);
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(
        sorted[i].bytes > sorted[i - 1].bytes,
        `expected ${sorted[i].rowCount}-row file (${sorted[i].bytes}B) to exceed ${sorted[i - 1].rowCount}-row file (${sorted[i - 1].bytes}B)`,
      );
    }
    console.log('[discovery-catalog-footprint] SUMMARY:', JSON.stringify(sorted));
  });
});
