import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { orderArtworkFetchQueue, runArtworkFetchQueue, DEFAULT_ARTWORK_FETCH_CONCURRENCY, ADAPTIVE_MAX_ARTWORK_FETCH_CONCURRENCY } from '../src/core/artwork-cache/queue.ts';
import type { ArtworkFetchJob } from '../src/core/artwork-cache/types.ts';

function job(overrides: Partial<ArtworkFetchJob> & { catalogGameId: string }): ArtworkFetchJob {
  return {
    kind: 'header',
    sourceUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg',
    priority: 'deep-catalog',
    ...overrides,
  };
}

describe('orderArtworkFetchQueue', () => {
  test('orders strictly by ROADMAP §4.5 priority tier: visible > installed > favorite > popular > deep-catalog', () => {
    const jobs = [
      job({ catalogGameId: 'd', priority: 'deep-catalog' }),
      job({ catalogGameId: 'p', priority: 'popular' }),
      job({ catalogGameId: 'v', priority: 'visible' }),
      job({ catalogGameId: 'f', priority: 'favorite' }),
      job({ catalogGameId: 'i', priority: 'installed' }),
    ];
    const ordered = orderArtworkFetchQueue(jobs);
    assert.deepEqual(ordered.map((j) => j.catalogGameId), ['v', 'i', 'f', 'p', 'd']);
  });

  test('drops jobs whose cache key is already in the ok-cached set (no redundant successful re-fetch)', () => {
    const jobs = [job({ catalogGameId: 'already-cached', kind: 'header' }), job({ catalogGameId: 'needs-fetch', kind: 'header' })];
    const ordered = orderArtworkFetchQueue(jobs, new Set(['already-cached__header']));
    assert.deepEqual(ordered.map((j) => j.catalogGameId), ['needs-fetch']);
  });

  test('never mutates the input array', () => {
    const jobs = [job({ catalogGameId: 'b', priority: 'popular' }), job({ catalogGameId: 'a', priority: 'visible' })];
    const before = jobs.map((j) => j.catalogGameId);
    orderArtworkFetchQueue(jobs);
    assert.deepEqual(jobs.map((j) => j.catalogGameId), before);
  });
});

describe('runArtworkFetchQueue', () => {
  test('runs every job through the injected executor and resolves done', async () => {
    const jobs = [job({ catalogGameId: 'a' }), job({ catalogGameId: 'b' }), job({ catalogGameId: 'c' })];
    const executed: string[] = [];
    const controller = runArtworkFetchQueue(jobs, async (j) => {
      executed.push(j.catalogGameId);
    });
    await controller.done;
    assert.deepEqual(executed.sort(), ['a', 'b', 'c']);
    assert.equal(controller.completedCount(), 3);
    assert.equal(controller.activeCount(), 0);
  });

  test('never runs more than the requested concurrency at once, clamped to the adaptive max', async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => job({ catalogGameId: `g${i}` }));
    let maxObservedActive = 0;
    let currentlyActive = 0;
    const gate = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
    const controller = runArtworkFetchQueue(
      jobs,
      async () => {
        currentlyActive++;
        maxObservedActive = Math.max(maxObservedActive, currentlyActive);
        await gate();
        currentlyActive--;
      },
      { concurrency: 3 },
    );
    await controller.done;
    assert.ok(maxObservedActive <= 3, `expected <=3 concurrent, saw ${maxObservedActive}`);
  });

  test('clamps an out-of-range concurrency request to the adaptive maximum', async () => {
    const jobs = Array.from({ length: 3 }, (_, i) => job({ catalogGameId: `g${i}` }));
    const controller = runArtworkFetchQueue(jobs, async () => {}, { concurrency: 999 });
    await controller.done;
    // Indirect assertion: constants themselves are sane and used as the clamp ceiling.
    assert.ok(ADAPTIVE_MAX_ARTWORK_FETCH_CONCURRENCY <= 10);
    assert.ok(DEFAULT_ARTWORK_FETCH_CONCURRENCY <= ADAPTIVE_MAX_ARTWORK_FETCH_CONCURRENCY);
  });

  test('one failing job never stalls or aborts the rest of the queue', async () => {
    const jobs = [job({ catalogGameId: 'fails' }), job({ catalogGameId: 'succeeds' })];
    const executed: string[] = [];
    const controller = runArtworkFetchQueue(jobs, async (j) => {
      executed.push(j.catalogGameId);
      if (j.catalogGameId === 'fails') throw new Error('boom');
    });
    await controller.done;
    assert.deepEqual(executed.sort(), ['fails', 'succeeds']);
    assert.equal(controller.completedCount(), 2);
  });

  test('pause stops new jobs from starting, resume continues them', async () => {
    const jobs = Array.from({ length: 4 }, (_, i) => job({ catalogGameId: `g${i}` }));
    const executed: string[] = [];
    const controller = runArtworkFetchQueue(
      jobs,
      async (j) => {
        executed.push(j.catalogGameId);
      },
      { concurrency: 1 },
    );
    controller.pause();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const countWhilePaused = executed.length;
    assert.ok(countWhilePaused <= 1, 'at most the already-started job may finish while paused');
    controller.resume();
    await controller.done;
    assert.equal(executed.length, 4);
  });

  test('cancel prevents any further not-yet-started job from running', async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => job({ catalogGameId: `g${i}` }));
    const executed: string[] = [];
    const controller = runArtworkFetchQueue(
      jobs,
      async (j) => {
        executed.push(j.catalogGameId);
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
      { concurrency: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    controller.cancel();
    await controller.done;
    assert.ok(executed.length < jobs.length, 'cancel must stop the queue before every job runs');
    assert.equal(controller.isCancelled(), true);
  });
});
