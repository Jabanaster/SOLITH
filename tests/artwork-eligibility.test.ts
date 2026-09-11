import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  buildPersonalGamePriorityFillJobs,
  type PersonalGameArtworkCandidate,
} from '../src/core/artwork-cache/personal-game-priority-fill.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

/**
 * ROADMAP Phase 1 online-foundation, Mission 14 — proves the artwork
 * eligibility guarantee against the REAL job builder
 * (personal-game-priority-fill.ts#buildPersonalGamePriorityFillJobs), not a
 * reimplementation: a Discovery-only (non-personal) game must never produce
 * a fetch job, while a favorited or installed game must.
 */

function catalogEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
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
    steamAppId: 413150,
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

describe('Mission 14 artwork eligibility (real job-builder output)', () => {
  test('Discovery-only game (no personal-library signal at all) -> no artwork download attempted', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate()], // running/installed/confirmedOwned/favorite/recentlyDetected all false
      { 'stardew-valley': catalogEntry() },
    );
    assert.deepEqual(jobs, []);
  });

  test('Favorite game -> artwork eligible (real builder emits jobs)', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ favorite: true })],
      { 'stardew-valley': catalogEntry() },
    );
    assert.ok(jobs.length > 0, 'expected at least one fetch job for a favorited game');
    for (const job of jobs) {
      assert.equal(job.catalogGameId, 'stardew-valley');
      assert.equal(job.priority, 'popular'); // PERSONAL_GAME_PRIORITY_TIER_MAP.favorite
    }
  });

  test('Installed game -> artwork eligible (real builder emits jobs)', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [candidate({ installed: true })],
      { 'stardew-valley': catalogEntry() },
    );
    assert.ok(jobs.length > 0, 'expected at least one fetch job for an installed game');
    for (const job of jobs) {
      assert.equal(job.catalogGameId, 'stardew-valley');
      assert.equal(job.priority, 'installed');
    }
  });

  test('a Discovery-only game mixed with a favorited game only produces jobs for the favorited one', () => {
    const jobs = buildPersonalGamePriorityFillJobs(
      [
        candidate({ catalogGameId: 'discovery-only-game' }),
        candidate({ catalogGameId: 'stardew-valley', favorite: true }),
      ],
      {
        'discovery-only-game': catalogEntry({ catalogGameId: 'discovery-only-game', steamAppId: 999 }),
        'stardew-valley': catalogEntry(),
      },
    );
    const gameIds = new Set(jobs.map((j) => j.catalogGameId));
    assert.equal(gameIds.has('discovery-only-game'), false);
    assert.equal(gameIds.has('stardew-valley'), true);
  });
});
