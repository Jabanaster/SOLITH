import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  buildPersonalGamePriorityFillJobs,
  PERSONAL_GAME_PRIORITY_TIER_MAP,
  type PersonalGameArtworkCandidate,
} from '../src/core/artwork-cache/personal-game-priority-fill.js';
import { artworkCacheKey } from '../src/core/artwork-cache/cache-key.js';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';

function baseEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'stardew-valley',
    displayName: 'Stardew Valley',
    executables: [],
    categories: [],
    verificationStatus: 'verified',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: 'stardew valley',
    ...overrides,
  };
}

function candidate(overrides: Partial<PersonalGameArtworkCandidate> = {}): PersonalGameArtworkCandidate {
  return {
    catalogGameId: 'stardew-valley',
    running: false,
    installed: false,
    confirmedOwned: false,
    favorite: false,
    recentlyDetected: false,
    canonicalConfidence: 'trusted',
    ...overrides,
  };
}

describe('buildPersonalGamePriorityFillJobs', () => {
  test('never queues a weak-identity candidate (no fuzzy-match auto-fetch)', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ running: true, canonicalConfidence: 'weak' })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    assert.deepEqual(jobs, []);
  });

  test('Discovery Master Pass, Stage 2 — a bare { steamAppId } source (no full TrainerCatalogEntry) still derives real Steam CDN urls', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ favorite: true })],
      { 'stardew-valley': { steamAppId: 413150 } },
    );
    const header = jobs.find((j) => j.kind === 'header');
    assert.ok(header, 'expected a header job to be queued from steamAppId alone');
    assert.match(header!.sourceUrl, /cdn\.cloudflare\.steamstatic\.com\/steam\/apps\/413150\/header\.jpg$/);
  });

  test('a { steamAppId } source with no id at all queues nothing (no fabricated urls)', () => {
    const jobs = buildPersonalGamePriorityFillJobs([candidate({ favorite: true })], { 'stardew-valley': {} });
    assert.deepEqual(jobs, []);
  });

  test('never queues a candidate with no catalog entry resolved', () => {
    const jobs = buildPersonalGamePriorityFillJobs([candidate({ running: true })], {});
    assert.deepEqual(jobs, []);
  });

  test('never queues a candidate with no personal-library signal at all', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate()],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    assert.deepEqual(jobs, []);
  });

  test('running maps to the visible tier, and is preferred over other simultaneous signals', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ running: true, installed: true, favorite: true })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    assert.ok(jobs.length > 0);
    for (const job of jobs) assert.equal(job.priority, PERSONAL_GAME_PRIORITY_TIER_MAP.running);
    assert.equal(PERSONAL_GAME_PRIORITY_TIER_MAP.running, 'visible');
  });

  test('installed (without running) maps to the installed tier', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ installed: true, favorite: true })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    for (const job of jobs) assert.equal(job.priority, 'installed');
  });

  test('confirmed-owned (without running/installed) maps to the favorite tier', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ confirmedOwned: true, favorite: true })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    for (const job of jobs) assert.equal(job.priority, 'favorite');
  });

  test('favorite alone maps to the popular tier', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ favorite: true })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    for (const job of jobs) assert.equal(job.priority, 'popular');
  });

  test('recently-detected alone maps to the lowest deep-catalog tier', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ recentlyDetected: true })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    for (const job of jobs) assert.equal(job.priority, 'deep-catalog');
  });

  test('produces exactly one job per known artwork kind, never duplicated across overlapping signals', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ running: true, installed: true, confirmedOwned: true, favorite: true, recentlyDetected: true })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    const kinds = jobs.map((j) => j.kind).sort();
    assert.deepEqual(kinds, ['cover', 'header', 'icon']);
  });

  test('every job carries remote-unverified-rights — same policy the existing manual refresh uses; this module never bypasses the persistent-cache rights gate', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ installed: true })],
      { 'stardew-valley': baseEntry({ steamAppId: 413150 }) },
    );
    assert.ok(jobs.length > 0);
    for (const job of jobs) assert.equal(job.rightsClass, 'remote-unverified-rights');
  });

  test('Mission 6 request-storm guard: a cache key already present in skipCacheKeys (ok, failed, OR rights-blocked) is never re-queued', () => {
    const entry = baseEntry({ steamAppId: 413150 });
    const skip = new Set([
      artworkCacheKey('stardew-valley', 'header'),
      artworkCacheKey('stardew-valley', 'cover'),
      artworkCacheKey('stardew-valley', 'icon'),
    ]);
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ installed: true })],
      { 'stardew-valley': entry },
      { skipCacheKeys: skip },
    );
    assert.deepEqual(jobs, []);
  });

  test('a partially-attempted game only re-queues the kinds not already attempted', () => {
    const entry = baseEntry({ steamAppId: 413150 });
    const skip = new Set([artworkCacheKey('stardew-valley', 'header')]);
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ installed: true })],
      { 'stardew-valley': entry },
      { skipCacheKeys: skip },
    );
    const kinds = jobs.map((j) => j.kind).sort();
    assert.deepEqual(kinds, ['cover', 'icon']);
  });

  test('a curated entry URL is preferred over the Steam-CDN-derived fallback', () => {
    const entry = baseEntry({ steamAppId: 413150, headerUrl: 'https://curated.example.test/header.jpg' });
    const jobs = buildPersonalGamePriorityFillJobs([candidate({ installed: true })], { 'stardew-valley': entry });
    const headerJob = jobs.find((j) => j.kind === 'header');
    assert.equal(headerJob?.sourceUrl, 'https://curated.example.test/header.jpg');
  });

  test('multiple distinct games each get their own ranked jobs', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [
        candidate({ catalogGameId: 'game-a', running: true }),
        candidate({ catalogGameId: 'game-b', recentlyDetected: true }),
      ],
      {
        'game-a': baseEntry({ catalogGameId: 'game-a', steamAppId: 1 }),
        'game-b': baseEntry({ catalogGameId: 'game-b', steamAppId: 2 }),
      },
    );
    const aJobs = jobs.filter((j) => j.catalogGameId === 'game-a');
    const bJobs = jobs.filter((j) => j.catalogGameId === 'game-b');
    assert.ok(aJobs.every((j) => j.priority === 'visible'));
    assert.ok(bJobs.every((j) => j.priority === 'deep-catalog'));
  });

  test('an empty candidate list produces no jobs', () => {
    assert.deepEqual(buildPersonalGamePriorityFillJobs([], {}), []);
  });
});
