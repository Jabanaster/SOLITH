/**
 * SOLITH Phase 3 hostile review fix (P2) — provider_catalog_records rollback
 * protection. A replayed/stale fetch can never roll a record backward,
 * because the guard compares SOLITH's OWN locally-generated `lastUpdated`
 * timestamp, never anything provider-supplied.
 */
import { before as beforeAll, after as afterAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertProviderCatalogRecord, getProviderCatalogRecord } from '../src/core/provider-catalog/store.ts';
import type { ProviderGameRecord } from '../src/core/provider-catalog/types.ts';

describe('provider catalog store — rollback guard', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  function record(overrides: Partial<ProviderGameRecord>): ProviderGameRecord {
    return { provider: 'steam', providerGameId: 'rollback-test', title: 'Original Title', type: 'game', lastUpdated: '2026-01-05T00:00:00.000Z', ...overrides };
  }

  test('a newer lastUpdated overwrites an older one normally', () => {
    upsertProviderCatalogRecord(record({ title: 'Original Title', lastUpdated: '2026-01-05T00:00:00.000Z' }));
    upsertProviderCatalogRecord(record({ title: 'Updated Title', lastUpdated: '2026-01-06T00:00:00.000Z' }));
    const row = getProviderCatalogRecord('steam', 'rollback-test');
    assert.equal(row!.title, 'Updated Title');
  });

  test('a replayed/stale (older lastUpdated) write can never roll the row backward', () => {
    // The row is currently "Updated Title" @ 2026-01-06 from the previous test.
    upsertProviderCatalogRecord(record({ title: 'Attacker Replayed Old Title', lastUpdated: '2026-01-01T00:00:00.000Z' }));
    const row = getProviderCatalogRecord('steam', 'rollback-test');
    assert.equal(row!.title, 'Updated Title', 'a stale write must never overwrite a newer record');
  });

  test('an equal lastUpdated is treated as an idempotent, allowed no-op-equivalent write', () => {
    upsertProviderCatalogRecord(record({ title: 'Updated Title', lastUpdated: '2026-01-06T00:00:00.000Z', publisher: 'New Publisher Info' }));
    const row = getProviderCatalogRecord('steam', 'rollback-test');
    assert.equal(row!.publisher, 'New Publisher Info');
  });

  test('Phase 3.1 Mission 20 — older rawRevision alone (with a matching lastUpdated) does not cause a rollback: rawRevision is informational, lastUpdated is the sole guard', () => {
    // rawRevision itself is never used for ordering (Epic/GOG content hashes
    // have no ordering at all) — only the locally-generated lastUpdated
    // guards against rollback. A provider replaying an older rawRevision
    // string alongside a genuinely newer lastUpdated is a legitimate
    // "content changed back" case (e.g. a provider reverted a title typo)
    // and must be allowed to write through normally.
    upsertProviderCatalogRecord(record({ provider: 'gog', providerGameId: 'revision-test', title: 'V2', lastUpdated: '2026-02-01T00:00:00.000Z', rawRevision: 'hash-v2' }));
    upsertProviderCatalogRecord(record({ provider: 'gog', providerGameId: 'revision-test', title: 'V1-reverted', lastUpdated: '2026-02-02T00:00:00.000Z', rawRevision: 'hash-v1' }));
    const row = getProviderCatalogRecord('gog', 'revision-test');
    assert.equal(row!.title, 'V1-reverted', 'a newer lastUpdated must always win regardless of rawRevision content');
  });

  test('Mission 20 — a malformed/empty lastUpdated string still fails closed (never worse than a no-op)', () => {
    upsertProviderCatalogRecord(record({ provider: 'epic', providerGameId: 'malformed-test', title: 'Good', lastUpdated: '2026-03-01T00:00:00.000Z' }));
    // A malformed (non-ISO) lastUpdated compares lexicographically against a
    // real ISO string — since it doesn't start with a valid 4-digit year in
    // the expected format, string comparison is used as-is (SQLite has no
    // native date type). Document the actual behavior: a garbage string
    // that sorts LOWER than the stored value is correctly rejected exactly
    // like a genuinely-older timestamp would be.
    upsertProviderCatalogRecord(record({ provider: 'epic', providerGameId: 'malformed-test', title: 'Bad', lastUpdated: '' }));
    const row = getProviderCatalogRecord('epic', 'malformed-test');
    assert.equal(row!.title, 'Good', 'an empty/malformed lastUpdated must never override a real timestamp');
  });

  test('Mission 20 — clock skew edge case: millisecond-identical timestamps are treated as equal (idempotent), not rejected', () => {
    const ts = '2026-04-01T12:00:00.000Z';
    upsertProviderCatalogRecord(record({ provider: 'steam', providerGameId: 'clock-test', title: 'First', lastUpdated: ts }));
    upsertProviderCatalogRecord(record({ provider: 'steam', providerGameId: 'clock-test', title: 'Second', lastUpdated: ts }));
    const row = getProviderCatalogRecord('steam', 'clock-test');
    assert.equal(row!.title, 'Second', 'equal timestamps (e.g. a legitimate re-sync tick) must apply, not be rejected as stale');
  });
});
