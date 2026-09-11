/**
 * ROADMAP §online-foundation Phase 1.5 Mission A1 — sync revision
 * monotonicity / anti-rollback adversarial tests.
 *
 * SECURITY CONTEXT (verbatim gap from a prior hostile security review):
 * "applySyncManifestDelta and recordSyncManifestState unconditionally
 * overwrite catalogRevision/trainerRevision with whatever the server just
 * returned, with no comparison against the previously stored cursor. A
 * compromised or malicious sync server can send a revision number OLDER
 * than the client's current cursor, and the client will happily accept
 * it... no `if (newRevision <= storedRevision) reject` anywhere in this
 * path."
 *
 * This file drives that exact attack (and the legitimate edge cases around
 * it — equal/retry, skip-forward, restart-with-persisted-cursor) through
 * the real `fetchSyncManifest` / `applySyncManifestDelta` / `getSyncManifestState`
 * modules against `MockSyncServer`, using its new `_forceNextSyncRevision`
 * test hook to make an otherwise well-behaved mock server misbehave on
 * demand — exercising the CLIENT's defense, not the mock's normal path.
 *
 * Isolated via `resetForTesting()` (in-memory sql.js) per the existing
 * sync-manifest-apply.test.ts pattern, except the final "restart" test,
 * which uses an on-disk DB file per the local-e2e-sync-proof.test.ts
 * pattern, to prove the fix survives a real process boundary.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting, flushPersistence } from '../src/core/database/index.ts';
import { applySyncManifestDelta, fetchSyncManifest } from '../src/core/sync-manifest/client.ts';
import { getSyncManifestState } from '../src/core/sync-manifest/store.ts';
import { getDiscoveryCatalogEntry, countDiscoveryCatalogEntries } from '../src/core/discovery-catalog/store.ts';
import { MockSyncServer } from '../src/core/sync-manifest/mock-server.ts';
import {
  combineSyncRevisionVerdicts,
  compareSyncRevisions,
  isValidSyncRevision,
} from '../src/core/sync-manifest/revision.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';

const SERVICE = 'discovery-catalog';

function entry(id: string): DiscoveryCatalogEntry {
  return {
    solithGameId: id,
    title: `Title ${id}`,
    normalizedTitle: `title ${id}`,
    aliases: [],
    providerIds: {},
    type: 'game',
    genres: [],
    tags: [],
    trainerAvailable: false,
    ctAvailable: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function syncOnce(server: MockSyncServer) {
  const delta = await fetchSyncManifest({
    service: SERVICE,
    endpointUrl: server.syncEndpointUrl,
    fetchImpl: server.fetchImpl,
  });
  assert.ok(!('error' in delta), `fetch must succeed: ${'error' in delta ? delta.error : ''}`);
  if ('error' in delta) throw new Error('unreachable');
  return applySyncManifestDelta(SERVICE, delta);
}

describe('compareSyncRevisions / combineSyncRevisionVerdicts (pure unit tests)', () => {
  test('no prior cursor (null) treats any valid incoming revision as newer', () => {
    assert.equal(compareSyncRevisions(null, '0'), 'newer');
    assert.equal(compareSyncRevisions(null, '999'), 'newer');
  });

  test('numeric comparison is correct even where lexical string comparison would be wrong', () => {
    // "9" > "10" lexically, but 9 < 10 numerically — this is exactly why
    // lexical comparison of unpadded decimal revisions is unsafe.
    assert.equal(compareSyncRevisions('9', '10'), 'newer');
    assert.equal(compareSyncRevisions('10', '9'), 'older');
  });

  test('equal revisions compare as equal', () => {
    assert.equal(compareSyncRevisions('40', '40'), 'equal');
  });

  test('malformed incoming revision is invalid regardless of stored value', () => {
    assert.equal(compareSyncRevisions('5', 'not-a-number'), 'invalid');
    assert.equal(compareSyncRevisions('5', ''), 'invalid');
    assert.equal(compareSyncRevisions('5', '007'), 'invalid', 'leading zeros are not canonical');
    assert.equal(compareSyncRevisions('5', '-1'), 'invalid', 'negative revisions are not canonical');
    assert.equal(compareSyncRevisions('5', 5), 'invalid', 'a number, not a string, is invalid');
    assert.equal(compareSyncRevisions('5', undefined), 'invalid');
    assert.equal(compareSyncRevisions('5', null), 'invalid');
  });

  test('malformed stored revision also fails closed as invalid', () => {
    assert.equal(compareSyncRevisions('not-a-number', '10'), 'invalid');
  });

  test('isValidSyncRevision accepts canonical integers and rejects everything else', () => {
    assert.equal(isValidSyncRevision('0'), true);
    assert.equal(isValidSyncRevision('42'), true);
    assert.equal(isValidSyncRevision('00'), false);
    assert.equal(isValidSyncRevision('3.5'), false);
    assert.equal(isValidSyncRevision('+3'), false);
    assert.equal(isValidSyncRevision(' 3'), false);
    assert.equal(isValidSyncRevision(3), false);
  });

  test('combineSyncRevisionVerdicts: invalid beats everything', () => {
    assert.equal(combineSyncRevisionVerdicts('invalid', 'newer'), 'invalid');
    assert.equal(combineSyncRevisionVerdicts('newer', 'invalid'), 'invalid');
  });

  test('combineSyncRevisionVerdicts: older beats newer/equal (never partially roll back)', () => {
    assert.equal(combineSyncRevisionVerdicts('older', 'newer'), 'older');
    assert.equal(combineSyncRevisionVerdicts('newer', 'older'), 'older');
    assert.equal(combineSyncRevisionVerdicts('older', 'equal'), 'older');
  });

  test('combineSyncRevisionVerdicts: equal only when both sides are equal', () => {
    assert.equal(combineSyncRevisionVerdicts('equal', 'equal'), 'equal');
    assert.equal(combineSyncRevisionVerdicts('equal', 'newer'), 'newer');
  });
});

describe('applySyncManifestDelta anti-rollback defense (adversarial, end-to-end via MockSyncServer)', () => {
  let server: MockSyncServer;

  beforeAll(async () => {
    await resetForTesting();
    server = new MockSyncServer();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('baseline: client advances through several legitimate syncs (0 -> 1 -> 2)', async () => {
    server._seedCatalogEntry(entry('game-a')); // revision 1
    const r1 = await syncOnce(server);
    assert.equal(r1.status, 'applied');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '1');

    server._seedCatalogEntry(entry('game-b')); // revision 2
    const r2 = await syncOnce(server);
    assert.equal(r2.status, 'applied');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '2');
  });

  test('old revision replay: server resends a revision the client already passed -> rejected, local state unchanged', async () => {
    const beforeState = getSyncManifestState(SERVICE);
    const beforeCount = countDiscoveryCatalogEntries();
    assert.equal(beforeState?.catalogRevision, '2');

    server._forceNextSyncRevision({ catalogRevision: '1', trainerRevision: '1' });
    const result = await syncOnce(server);

    assert.equal(result.status, 'rejected');
    assert.equal(result.upsertedCatalogEntries, 0);
    assert.deepEqual(getSyncManifestState(SERVICE), beforeState, 'stored cursor must be byte-for-byte unchanged');
    assert.equal(countDiscoveryCatalogEntries(), beforeCount);
  });

  test('rollback attempt: server at revision 40 territory sends revision 3 -> rejected, getSyncManifestState still reports the advanced cursor', async () => {
    // Fast-forward the client to a much higher revision first.
    for (let i = 0; i < 38; i += 1) {
      server._seedCatalogEntry(entry(`filler-${i}`));
    }
    const advance = await syncOnce(server);
    assert.equal(advance.status, 'applied');
    const advancedState = getSyncManifestState(SERVICE);
    assert.equal(advancedState?.catalogRevision, '40');

    server._forceNextSyncRevision({ catalogRevision: '3', trainerRevision: '3' });
    const attack = await syncOnce(server);

    assert.equal(attack.status, 'rejected');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '40', 'cursor must still report the pre-attack revision');
  });

  test('equal revision: server re-sends the current revision -> explicit no-op success, not an error', async () => {
    const beforeState = getSyncManifestState(SERVICE);
    assert.equal(beforeState?.catalogRevision, '40');

    server._forceNextSyncRevision({ catalogRevision: '40', trainerRevision: '40' });
    const result = await syncOnce(server);

    assert.equal(result.status, 'noop');
    assert.equal(result.upsertedCatalogEntries, 0);
    assert.deepEqual(getSyncManifestState(SERVICE), beforeState, 'no-op must not touch the stored cursor');
  });

  test('next valid revision: applies normally, state advances', async () => {
    server._seedCatalogEntry(entry('game-next')); // revision 41
    const result = await syncOnce(server);

    assert.equal(result.status, 'applied');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '41');
    assert.ok(getDiscoveryCatalogEntry('game-next'));
  });

  test('skipped-forward revision is PERMITTED: a compacted/squashed sync from 41 straight to a much higher revision succeeds', async () => {
    // Forward is always safe — only backward is the attack. Seed many
    // entries WITHOUT syncing in between (as a compacted/squashed catalog
    // snapshot would), so the next sync jumps straight from revision 41 to
    // 99, skipping every intermediate revision the client never saw. This
    // deliberately does NOT use `_forceNextSyncRevision` — it must stay the
    // server's real, honestly-advanced counter, so this test proves the
    // client accepts a genuine forward skip rather than merely trusting an
    // artificial override.
    for (let i = 0; i < 58; i += 1) {
      server._seedCatalogEntry(entry(`skip-${i}`)); // revision -> 42, 43, ..., 99
    }

    const result = await syncOnce(server);

    assert.equal(result.status, 'applied', 'forward skips must be permitted — only backward is the attack');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '99');
  });

  test('malformed revision from the server (garbage string) -> rejected, fail-closed, no state mutation', async () => {
    const beforeState = getSyncManifestState(SERVICE);
    const beforeCount = countDiscoveryCatalogEntries();

    server._forceNextSyncRevision({ catalogRevision: 'not-a-revision', trainerRevision: 'not-a-revision' });
    const result = await syncOnce(server);

    assert.equal(result.status, 'rejected');
    assert.deepEqual(getSyncManifestState(SERVICE), beforeState);
    assert.equal(countDiscoveryCatalogEntries(), beforeCount);
  });

  test('malformed revision from the server (wrong type: a JSON number, not a string) -> rejected at the fetch layer, fail-closed', async () => {
    const beforeState = getSyncManifestState(SERVICE);
    const beforeCount = countDiscoveryCatalogEntries();

    server._forceNextSyncRevision({ catalogRevision: 500, trainerRevision: 500 });
    const delta = await fetchSyncManifest({
      service: SERVICE,
      endpointUrl: server.syncEndpointUrl,
      fetchImpl: server.fetchImpl,
    });

    // A JSON number instead of a string already fails fetchSyncManifest's
    // own shape validation (`typeof record.catalogRevision === 'string'`),
    // so this never even reaches the revision-comparison logic — it is
    // rejected one layer earlier, but the outcome the owner cares about
    // (never applied, no state mutation) holds either way.
    assert.ok('error' in delta, 'a non-string revision must be a typed error, never applied');
    assert.deepEqual(getSyncManifestState(SERVICE), beforeState);
    assert.equal(countDiscoveryCatalogEntries(), beforeCount);
  });

  test('malformed revision from the server (empty string) -> rejected, fail-closed', async () => {
    const beforeState = getSyncManifestState(SERVICE);

    server._forceNextSyncRevision({ catalogRevision: '', trainerRevision: '' });
    const result = await syncOnce(server);

    assert.equal(result.status, 'rejected');
    assert.deepEqual(getSyncManifestState(SERVICE), beforeState);
  });

  test('missing revision: server response omits the revision field entirely -> rejected at the fetch layer, fail-closed', async () => {
    const beforeState = getSyncManifestState(SERVICE);
    const beforeCount = countDiscoveryCatalogEntries();

    server._forceNextSyncRevision({ omitRevision: true });
    const delta = await fetchSyncManifest({
      service: SERVICE,
      endpointUrl: server.syncEndpointUrl,
      fetchImpl: server.fetchImpl,
    });

    // fetchSyncManifest's own shape validation already rejects a response
    // missing a required string field, before applySyncManifestDelta (and
    // therefore before any revision comparison) is ever reached.
    assert.ok('error' in delta, 'a manifest missing its revision fields must be a typed error, never applied');
    assert.deepEqual(getSyncManifestState(SERVICE), beforeState);
    assert.equal(countDiscoveryCatalogEntries(), beforeCount);
  });

  test('server retry/replay: the same exact successful sync request executed twice in a row -> both succeed, second is the equal-revision no-op, no double-application', async () => {
    server._seedCatalogEntry(entry('retry-target')); // advances the server's real revision
    const first = await syncOnce(server);
    assert.equal(first.status, 'applied');
    const countAfterFirst = countDiscoveryCatalogEntries();
    const stateAfterFirst = getSyncManifestState(SERVICE);

    // Immediately re-run the identical sync (simulating a client retrying
    // after e.g. a dropped response) — the server's real state has not
    // moved, so this naturally exercises the equal-revision path with no
    // forced override needed.
    const second = await syncOnce(server);

    assert.equal(second.status, 'noop');
    assert.equal(second.upsertedCatalogEntries, 0, 'the retry must not re-upsert changedCatalogEntries');
    assert.equal(countDiscoveryCatalogEntries(), countAfterFirst, 'no duplicate rows from the replayed sync');
    assert.deepEqual(getSyncManifestState(SERVICE), stateAfterFirst);
  });
});

describe('restart with persisted last-known-good revision (on-disk DB, fresh-process simulation)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-sync-revision-restart-'));
  const dbPath = path.join(tempRoot, 'client.db');

  afterAll(async () => {
    try {
      await resetForTesting();
    } catch { /* ignore */ }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test('a fresh client process re-reading a persisted cursor uses it as the sync baseline, not a reset one', async () => {
    const server = new MockSyncServer();

    // "Process 1": syncs to revision 5 and persists to an on-disk DB file.
    await resetForTesting(dbPath);
    for (let i = 0; i < 5; i += 1) {
      server._seedCatalogEntry(entry(`persisted-${i}`));
    }
    const firstProcessResult = await syncOnce(server);
    assert.equal(firstProcessResult.status, 'applied');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '5');

    // Simulate a full process restart: flush the pending write to disk
    // (mirroring the debounced-persistence behavior a real process exit
    // would need to have completed), then close out this DB handle and
    // re-open the SAME on-disk file as a "fresh" client would on launch.
    // The MockSyncServer instance is intentionally NOT reset — it is the
    // stand-in for an independent remote backend whose state naturally
    // persists across the client's restart.
    await flushPersistence();
    await resetForTesting(dbPath, { preserveExisting: true });

    const restartedState = getSyncManifestState(SERVICE);
    assert.equal(restartedState?.catalogRevision, '5', 'the persisted cursor must survive the simulated restart');

    // A malicious/stale replay of an old revision must still be rejected
    // using the PERSISTED cursor as the baseline, not a fresh/reset one.
    server._forceNextSyncRevision({ catalogRevision: '2', trainerRevision: '2' });
    const rollbackAttempt = await syncOnce(server);
    assert.equal(rollbackAttempt.status, 'rejected', 'restart must not reset the anti-rollback baseline to null');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '5');

    // And a genuinely newer sync after restart applies normally, correctly
    // using the persisted revision 5 (not 0) as its "since" baseline.
    server._seedCatalogEntry(entry('after-restart')); // server revision 6
    const afterRestart = await syncOnce(server);
    assert.equal(afterRestart.status, 'applied');
    assert.equal(getSyncManifestState(SERVICE)?.catalogRevision, '6');
    assert.ok(getDiscoveryCatalogEntry('after-restart'));
  });
});
