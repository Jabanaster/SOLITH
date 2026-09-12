/**
 * SOLITH Phase 3.1, Mission 4/5/6 — REAL provider-catalog scale
 * certification at 10k/50k/100k/250k, using the batched import path
 * (provider-catalog/batch-import.ts) that fixed the sql.js statement-handle
 * exhaustion found in Phase 3's original per-row import pattern.
 *
 * NOT wired into the default `npm test` run — even with the batched fix,
 * 250k rows still takes real wall-clock time. Run explicitly:
 *   npx tsx --test tests/provider-catalog-scale-performance.test.ts
 *
 * All numbers below are REAL measurements. No extrapolation — Mission 4
 * explicitly requires all four tiers to actually run.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting, flushPersistence, closeDatabaseSafely } from '../src/core/database/index.ts';
import { importProviderCatalogRecordsBatch, importDiscoveryCatalogEntriesBatch, importCanonicalProviderLinksBatch } from '../src/core/provider-catalog/batch-import.ts';
import { queryDiscoveryCatalog } from '../src/core/discovery-catalog/query.ts';
import type { ProviderGameRecord } from '../src/core/provider-catalog/types.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';
import type { CanonicalProviderLink } from '../src/core/canonical-games/provider-link-store.ts';

const tempRoot = path.join(os.tmpdir(), `solith-provider-scale-${Date.now()}`);

interface ScaleReport {
  rowCount: number;
  bytes: number;
  importMs: number;
  importThroughputRowsPerSec: number;
  peakRssMB: number;
  timings: Record<string, number>;
}

const reports: ScaleReport[] = [];

function providerRecord(provider: 'steam' | 'epic' | 'gog', i: number): ProviderGameRecord {
  return {
    provider,
    providerGameId: `${provider}-${i}`,
    title: `Provider Game Number ${i}`,
    type: 'game',
    developer: `Dev Studio ${i % 200}`,
    publisher: `Publisher ${i % 100}`,
    genres: i % 7 === 0 ? ['Simulation', 'Farming'] : ['Action', 'Adventure'],
    releaseDate: `${2000 + (i % 25)}-01-15`,
    lastUpdated: new Date().toISOString(),
  };
}

function discoveryEntry(i: number, merged: boolean): DiscoveryCatalogEntry {
  return {
    solithGameId: `canonical-perf-${i}`,
    title: `Provider Game Number ${i}`,
    normalizedTitle: `provider game number ${i}`,
    aliases: [],
    providerIds: merged ? { steam: `steam-${i}`, epic: `epic-${i}`, gog: `gog-${i}` } : { steam: `steam-${i}` },
    type: 'game',
    releaseDate: `${2000 + (i % 25)}-01-15`,
    releaseYear: 2000 + (i % 25),
    genres: i % 7 === 0 ? ['Simulation', 'Farming'] : ['Action', 'Adventure'],
    tags: [],
    trainerAvailable: i % 3 === 0,
    ctAvailable: i % 5 === 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function timeIt(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function rssMB(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function measureAtScale(rowCount: number): Promise<ScaleReport> {
  const dbPath = path.join(tempRoot, `provider-scale-${rowCount}.db`);
  await resetForTesting(dbPath);

  const providerRecords: ProviderGameRecord[] = [];
  const discoveryEntries: DiscoveryCatalogEntry[] = [];
  const links: Omit<CanonicalProviderLink, 'linkedAt'>[] = [];

  for (let i = 0; i < rowCount; i += 1) {
    const merged = i % 3 === 0;
    providerRecords.push(providerRecord('steam', i));
    links.push({ provider: 'steam', providerGameId: `steam-${i}`, canonicalGameId: `canonical-perf-${i}`, confidence: 'EXACT', evidence: [] });
    if (merged) {
      providerRecords.push(providerRecord('epic', i));
      providerRecords.push(providerRecord('gog', i));
      links.push({ provider: 'epic', providerGameId: `epic-${i}`, canonicalGameId: `canonical-perf-${i}`, confidence: 'EXACT', evidence: [] });
      links.push({ provider: 'gog', providerGameId: `gog-${i}`, canonicalGameId: `canonical-perf-${i}`, confidence: 'EXACT', evidence: [] });
    }
    discoveryEntries.push(discoveryEntry(i, merged));
  }

  let peakRssMB = rssMB();
  const trackPeak = () => {
    peakRssMB = Math.max(peakRssMB, rssMB());
  };

  const importStart = performance.now();
  importProviderCatalogRecordsBatch(providerRecords);
  trackPeak();
  importDiscoveryCatalogEntriesBatch(discoveryEntries);
  trackPeak();
  importCanonicalProviderLinksBatch(links);
  trackPeak();
  const importMs = performance.now() - importStart;

  await flushPersistence();
  const bytes = fs.statSync(dbPath).size;

  const timings: Record<string, number> = {};
  timings['exact-title'] = timeIt(() => queryDiscoveryCatalog({ text: 'Provider Game Number 42' }));
  timings['prefix-search'] = timeIt(() => queryDiscoveryCatalog({ text: 'Provider Game Number 4' }));
  timings['substring-search'] = timeIt(() => queryDiscoveryCatalog({ text: 'Number 4' }));
  timings['provider-filter'] = timeIt(() => queryDiscoveryCatalog({ providers: ['epic'] }));
  timings['trainer-status-filter'] = timeIt(() => queryDiscoveryCatalog({ trainerAvailable: true }));
  timings['release-year-filter'] = timeIt(() => queryDiscoveryCatalog({ releaseYear: 2015 }));
  timings['genre-filter'] = timeIt(() => queryDiscoveryCatalog({ genre: 'Action' }));
  timings['combined-filters'] = timeIt(() =>
    queryDiscoveryCatalog({ providers: ['steam', 'gog'], trainerAvailable: true, releaseYear: 2015, genre: 'Action' }),
  );
  trackPeak();

  await flushPersistence();
  await closeDatabaseSafely();

  return {
    rowCount,
    bytes,
    importMs,
    importThroughputRowsPerSec: Math.round((providerRecords.length + discoveryEntries.length + links.length) / (importMs / 1000)),
    peakRssMB,
    timings,
  };
}

describe('Phase 3.1 — REAL provider catalog scale certification (Mission 4/5/6, no extrapolation)', () => {
  test('10,000 canonical games: real storage + search latency + memory', async () => {
    const report = await measureAtScale(10_000);
    reports.push(report);
    assert.ok(report.bytes > 0);
    for (const [name, ms] of Object.entries(report.timings)) {
      assert.ok(ms < 200, `${name} took ${ms}ms at 10k rows, expected < 200ms`);
    }
  });

  test('50,000 canonical games: real storage + search latency + memory', async () => {
    const report = await measureAtScale(50_000);
    reports.push(report);
    assert.ok(report.bytes > 0);
    for (const [name, ms] of Object.entries(report.timings)) {
      assert.ok(ms < 500, `${name} took ${ms}ms at 50k rows, expected < 500ms`);
    }
  });

  test('100,000 canonical games: real storage + search latency + memory', async () => {
    const report = await measureAtScale(100_000);
    reports.push(report);
    assert.ok(report.bytes > 0);
    for (const [name, ms] of Object.entries(report.timings)) {
      assert.ok(ms < 1000, `${name} took ${ms}ms at 100k rows, expected < 1000ms`);
    }
  });

  test('250,000 canonical games: real storage + search latency + memory (Mission 4 ceiling)', async () => {
    const report = await measureAtScale(250_000);
    reports.push(report);
    assert.ok(report.bytes > 0);
    for (const [name, ms] of Object.entries(report.timings)) {
      assert.ok(ms < 2000, `${name} took ${ms}ms at 250k rows, expected < 2000ms`);
    }
  });

  test('report all real measurements (no extrapolation)', () => {
    assert.equal(reports.length, 4);
    console.log('\n=== Phase 3.1 REAL catalog scale certification (all 4 tiers actually run) ===');
    for (const r of reports) {
      console.log(
        `rows=${r.rowCount} bytes=${r.bytes} (${(r.bytes / 1024 / 1024).toFixed(2)} MiB) ` +
          `importMs=${r.importMs.toFixed(0)} throughput=${r.importThroughputRowsPerSec} rows/sec ` +
          `peakRSS=${r.peakRssMB}MB timings(ms)=${JSON.stringify(
            Object.fromEntries(Object.entries(r.timings).map(([k, v]) => [k, Number(v.toFixed(2))])),
          )}`,
      );
    }
  });
});
