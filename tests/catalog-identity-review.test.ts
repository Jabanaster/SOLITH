import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import {
  detectIdentityCollision,
  computeIdentityReviewFingerprint,
  buildSeparateIdentityCatalogGameId,
} from '../src/core/trainer-catalog/identity-review.ts';
import {
  getCatalogEntry,
  getPendingIdentityReviewCount,
  listPendingIdentityReviewItems,
  resolveIdentityReviewItem,
  upsertCatalogEntry,
  upsertCatalogEntryWithIdentityReview,
} from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function makeEntry(
  catalogGameId: string,
  displayName: string,
  overrides: Partial<TrainerCatalogEntry> = {},
): TrainerCatalogEntry {
  return {
    catalogGameId,
    displayName,
    executables: ['Test.exe'],
    categories: ['Action'],
    verificationStatus: 'community',
    sources: [{ provider: 'mrantifun', url: `https://mrantifun.net/${catalogGameId}` }],
    hasModPack: false,
    cheatCount: 0,
    searchableText: displayName.toLowerCase(),
    ...overrides,
  };
}

describe('catalog identity review — detection', () => {
  test('same id + same source → no review', () => {
    const existing = makeEntry('doom', 'DOOM');
    const collision = detectIdentityCollision(existing, {
      entry: makeEntry('doom', 'DOOM'),
      provider: 'mrantifun',
      sourceUrl: 'https://mrantifun.net/doom',
    });
    assert.equal(collision, null);
  });

  test('same id + conflicting title from a new source → review', () => {
    const existing = makeEntry('resident-evil-4', 'Resident Evil 4');
    const collision = detectIdentityCollision(existing, {
      entry: makeEntry('resident-evil-4', 'Resident Evil 4 Remake'),
      provider: 'fling',
      sourceUrl: 'https://flingtrainer.com/re4-remake',
    });
    assert.ok(collision);
    assert.equal(collision?.reason, 'title-source-ambiguity');
  });

  test('normalized-title exact duplicate (whitespace only) → no review', () => {
    const existing = makeEntry('cyberpunk-2077', 'Cyberpunk 2077');
    const collision = detectIdentityCollision(existing, {
      entry: makeEntry('cyberpunk-2077', '  Cyberpunk    2077  '),
      provider: 'fling',
      sourceUrl: 'https://flingtrainer.com/cyberpunk',
    });
    assert.equal(collision, null);
  });

  test('same normalized title + conflicting steam app id → metadata-conflict review', () => {
    const existing = makeEntry('doom', 'DOOM', { steamAppId: 379720 });
    const collision = detectIdentityCollision(existing, {
      entry: makeEntry('doom', 'DOOM', { steamAppId: 2280 }),
      provider: 'fling',
      sourceUrl: 'https://flingtrainer.com/doom',
    });
    assert.ok(collision);
    assert.equal(collision?.reason, 'metadata-conflict');
  });

  test('punctuation-only slug collision with different source → slug-collision review', () => {
    const existing = makeEntry(
      'nier-replicant-ver-1-22474487139',
      'NieR Replicant ver.1.22474487139...',
    );
    const collision = detectIdentityCollision(existing, {
      entry: makeEntry(
        'nier-replicant-ver-1-22474487139',
        'NieR Replicant ver 1 22474487139',
      ),
      provider: 'plitch',
      sourceUrl: 'https://plitch.com/nier-replicant-alt',
    });
    assert.ok(collision);
    assert.equal(collision?.reason, 'slug-collision');
  });

  test('malformed title rejected before review (normalizeCatalogTitle already null)', () => {
    const existing = makeEntry('foo-bar', 'Foo Bar');
    const collision = detectIdentityCollision(existing, {
      entry: makeEntry('foo-bar', 'a href="https://x.test" class="menu"'),
      provider: 'mrantifun',
      sourceUrl: 'https://mrantifun.net/foo-bar-alt',
    });
    // Still flagged as a collision (existing vs incoming differ) — but this is exactly
    // why title hygiene must run upstream: the ingestion pipeline's normalizeCatalogTitle()
    // rejects this value before it ever reaches remoteTrainerToCatalogEntry/this function.
    assert.ok(collision);
  });

  test('repeat sync of the same record does not duplicate a review item', () => {
    const fingerprintA = computeIdentityReviewFingerprint('doom', 'fling', 'https://flingtrainer.com/doom');
    const fingerprintB = computeIdentityReviewFingerprint('doom', 'fling', 'https://flingtrainer.com/doom');
    assert.equal(fingerprintA, fingerprintB);
  });

  test('ordinary update with unchanged identity (same provider url) → no review', () => {
    const existing = makeEntry('doom', 'DOOM', {
      sources: [{ provider: 'fling', url: 'https://flingtrainer.com/doom' }],
    });
    const collision = detectIdentityCollision(existing, {
      entry: makeEntry('doom', 'DOOM (2016)'),
      provider: 'fling',
      sourceUrl: 'https://flingtrainer.com/doom',
    });
    assert.equal(collision, null);
  });
});

describe('catalog identity review — persistence + write boundary', () => {
  before(async () => {
    await initDatabase();
  });

  test('fresh catalogGameId writes normally with no review created', () => {
    const id = `fresh-${Date.now()}`;
    const result = upsertCatalogEntryWithIdentityReview({
      entry: makeEntry(id, 'Fresh Game'),
      provider: 'mrantifun',
      sourceUrl: `https://mrantifun.net/${id}`,
    });
    assert.equal(result.deferred, false);
    assert.ok(getCatalogEntry(id));
  });

  test('colliding write is deferred, existing record preserved, review item created', () => {
    const id = `collide-${Date.now()}`;
    upsertCatalogEntry(makeEntry(id, 'Original Title', {
      sources: [{ provider: 'mrantifun', url: `https://mrantifun.net/${id}` }],
    }));

    const result = upsertCatalogEntryWithIdentityReview({
      entry: makeEntry(id, 'Original Title Remastered'),
      provider: 'fling',
      sourceUrl: `https://flingtrainer.com/${id}`,
    });

    assert.equal(result.deferred, true);
    assert.ok(result.reviewId);
    const preserved = getCatalogEntry(id);
    assert.equal(preserved?.displayName, 'Original Title');

    const pending = listPendingIdentityReviewItems();
    assert.ok(pending.some((item) => item.id === result.reviewId));
  });

  test('re-syncing the same unresolved collision reuses one review item', () => {
    const id = `reuse-${Date.now()}`;
    upsertCatalogEntry(makeEntry(id, 'Original Title'));

    const first = upsertCatalogEntryWithIdentityReview({
      entry: makeEntry(id, 'Original Title Remastered'),
      provider: 'fling',
      sourceUrl: `https://flingtrainer.com/${id}`,
    });
    const second = upsertCatalogEntryWithIdentityReview({
      entry: makeEntry(id, 'Original Title Remastered'),
      provider: 'fling',
      sourceUrl: `https://flingtrainer.com/${id}`,
    });

    assert.equal(first.reviewId, second.reviewId);
    const pendingCount = listPendingIdentityReviewItems().filter((item) => item.id === first.reviewId).length;
    assert.equal(pendingCount, 1);
  });

  test('pending count reflects only pending items and deterministic ordering holds', () => {
    const before = getPendingIdentityReviewCount();
    const id = `count-${Date.now()}`;
    upsertCatalogEntry(makeEntry(id, 'Count Game'));
    upsertCatalogEntryWithIdentityReview({
      entry: makeEntry(id, 'Count Game Remastered'),
      provider: 'fling',
      sourceUrl: `https://flingtrainer.com/${id}`,
    });
    assert.equal(getPendingIdentityReviewCount(), before + 1);

    const items = listPendingIdentityReviewItems();
    for (let i = 1; i < items.length; i += 1) {
      assert.ok(items[i - 1].createdAt <= items[i].createdAt);
    }
  });

  test('malformed/missing review id resolves to null safely', () => {
    const result = resolveIdentityReviewItem('does-not-exist', 'keep-existing');
    assert.equal(result, null);
  });

  test('a corrupted leftRecordJson/rightRecordJson row is skipped, not thrown', async () => {
    const dbModule = await import('../src/core/database/index.ts');
    const raw = dbModule.default;
    const id = `corrupt-${Date.now()}`;
    raw
      .prepare(
        `INSERT INTO catalog_identity_review (id, reason, status, leftRecordJson, rightRecordJson)
         VALUES (?, 'identity-conflict', 'pending', 'not-json', 'also-not-json')`,
      )
      .run(id);

    assert.doesNotThrow(() => listPendingIdentityReviewItems());
    const items = listPendingIdentityReviewItems();
    assert.ok(!items.some((item) => item.id === id));
  });
});

describe('catalog identity review — resolution actions', () => {
  before(async () => {
    await initDatabase();
  });

  function deferCollision(id: string, incomingTitle: string, provider = 'fling'): string {
    upsertCatalogEntry(makeEntry(id, 'Original Title'));
    const result = upsertCatalogEntryWithIdentityReview({
      entry: makeEntry(id, incomingTitle),
      provider,
      sourceUrl: `https://${provider}.test/${id}`,
    });
    assert.equal(result.deferred, true);
    return result.reviewId as string;
  }

  test('keep existing: existing record untouched, no unrelated records mutated', () => {
    const id = `keep-${Date.now()}`;
    const reviewId = deferCollision(id, 'Original Title Remastered');
    const otherId = `unrelated-${Date.now()}`;
    upsertCatalogEntry(makeEntry(otherId, 'Unrelated Game'));

    const resolved = resolveIdentityReviewItem(reviewId, 'keep-existing');
    assert.equal(resolved?.status, 'resolved');
    assert.equal(getCatalogEntry(id)?.displayName, 'Original Title');
    assert.equal(getCatalogEntry(otherId)?.displayName, 'Unrelated Game');
  });

  test('accept incoming: stored record updates to the incoming entry', () => {
    const id = `accept-${Date.now()}`;
    const reviewId = deferCollision(id, 'Original Title Remastered');

    const resolved = resolveIdentityReviewItem(reviewId, 'accept-incoming');
    assert.equal(resolved?.status, 'resolved');
    assert.equal(getCatalogEntry(id)?.displayName, 'Original Title Remastered');
  });

  test('treat separate: incoming written under a distinct deterministic id, existing untouched', () => {
    const id = `separate-${Date.now()}`;
    const reviewId = deferCollision(id, 'Original Title Remastered', 'fling');

    const resolved = resolveIdentityReviewItem(reviewId, 'treat-separate');
    assert.equal(resolved?.status, 'resolved');
    assert.equal(getCatalogEntry(id)?.displayName, 'Original Title');

    const separateId = buildSeparateIdentityCatalogGameId(id, 'fling');
    assert.equal(getCatalogEntry(separateId)?.displayName, 'Original Title Remastered');
  });

  test('ignore/defer: leaves item ignored, no catalog mutation, unresolved state preserved', () => {
    const id = `ignore-${Date.now()}`;
    const reviewId = deferCollision(id, 'Original Title Remastered');

    const resolved = resolveIdentityReviewItem(reviewId, 'ignore');
    assert.equal(resolved?.status, 'ignored');
    assert.equal(getCatalogEntry(id)?.displayName, 'Original Title');
  });

  test('resolving an already-resolved item is a no-op (returns null, no double mutation)', () => {
    const id = `double-${Date.now()}`;
    const reviewId = deferCollision(id, 'Original Title Remastered');

    resolveIdentityReviewItem(reviewId, 'accept-incoming');
    const secondAttempt = resolveIdentityReviewItem(reviewId, 'keep-existing');
    assert.equal(secondAttempt, null);
    assert.equal(getCatalogEntry(id)?.displayName, 'Original Title Remastered');
  });

  test('once resolved accept-incoming, a later matching sync applies automatically without re-flagging', () => {
    const id = `auto-apply-${Date.now()}`;
    const reviewId = deferCollision(id, 'Original Title Remastered', 'fling');
    resolveIdentityReviewItem(reviewId, 'accept-incoming');

    const nextSync = upsertCatalogEntryWithIdentityReview({
      entry: makeEntry(id, 'Original Title Remastered'),
      provider: 'fling',
      sourceUrl: `https://fling.test/${id}`,
    });
    assert.equal(nextSync.deferred, false);
  });
});
