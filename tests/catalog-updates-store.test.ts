import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  getCatalogUpdateState,
  updateCatalogUpdateState,
  recordCatalogUpdateHistory,
  listCatalogUpdateHistory,
  getCatalogUpdateHistoryEntry,
  markCatalogUpdateHistoryRolledBack,
} from '../src/core/catalog-updates/store.ts';

describe('catalog_update_state', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('defaults to version 0, auto-update on, no snapshot-only, no artwork opt-out', () => {
    const state = getCatalogUpdateState();
    assert.equal(state.currentVersion, 0);
    assert.equal(state.lastSuccessAt, null);
    assert.equal(state.autoUpdateEnabled, true);
    assert.equal(state.bundledSnapshotOnly, false);
    assert.equal(state.artworkNetworkOptOut, false);
  });

  test('a partial update only changes the supplied fields', () => {
    updateCatalogUpdateState({ currentVersion: 3, lastSuccessAt: '2026-01-01T00:00:00.000Z' });
    const afterFirst = getCatalogUpdateState();
    assert.equal(afterFirst.currentVersion, 3);
    assert.equal(afterFirst.autoUpdateEnabled, true);

    updateCatalogUpdateState({ autoUpdateEnabled: false });
    const afterSecond = getCatalogUpdateState();
    assert.equal(afterSecond.autoUpdateEnabled, false);
    assert.equal(afterSecond.currentVersion, 3, 'unrelated fields must be preserved across a partial update');
  });

  test('bundledSnapshotOnly and artworkNetworkOptOut are independently settable', () => {
    updateCatalogUpdateState({ bundledSnapshotOnly: true });
    assert.equal(getCatalogUpdateState().bundledSnapshotOnly, true);
    assert.equal(getCatalogUpdateState().artworkNetworkOptOut, false, 'these two toggles must be independent');
  });
});

describe('catalog_update_history', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('records and lists an applied entry', () => {
    const id = recordCatalogUpdateHistory({
      version: 1,
      appliedAt: '2026-01-01T00:00:00.000Z',
      recordCount: 2,
      notice: 'Catalog updated — 2 games added.',
      status: 'applied',
      rollback: [{ catalogGameId: 'a', previousEntryJson: null }],
    });
    const list = listCatalogUpdateHistory();
    assert.equal(list[0].id, id);
    assert.equal(list[0].status, 'applied');
    assert.equal(list[0].version, 1);
  });

  test('records a rejected entry with a reject reason', () => {
    recordCatalogUpdateHistory({
      version: 1,
      appliedAt: '2026-01-02T00:00:00.000Z',
      recordCount: 0,
      notice: '',
      status: 'rejected',
      rejectReason: 'signature verification failed',
    });
    const list = listCatalogUpdateHistory();
    assert.equal(list[0].status, 'rejected');
    assert.equal(list[0].rejectReason, 'signature verification failed');
  });

  test('getCatalogUpdateHistoryEntry returns the exact rollback snapshot', () => {
    const id = recordCatalogUpdateHistory({
      version: 2,
      appliedAt: '2026-01-03T00:00:00.000Z',
      recordCount: 1,
      notice: 'x',
      status: 'applied',
      rollback: [{ catalogGameId: 'game-x', previousEntryJson: JSON.stringify({ catalogGameId: 'game-x', displayName: 'Old Name' }) }],
    });
    const found = getCatalogUpdateHistoryEntry(id);
    assert.ok(found);
    assert.equal(found!.rollback[0].catalogGameId, 'game-x');
    assert.match(found!.rollback[0].previousEntryJson ?? '', /Old Name/);
  });

  test('markCatalogUpdateHistoryRolledBack flips the status', () => {
    const id = recordCatalogUpdateHistory({
      version: 3,
      appliedAt: '2026-01-04T00:00:00.000Z',
      recordCount: 1,
      notice: 'x',
      status: 'applied',
    });
    markCatalogUpdateHistoryRolledBack(id);
    assert.equal(getCatalogUpdateHistoryEntry(id)!.entry.status, 'rolled-back');
  });

  test('history list is bounded and most-recent-first', () => {
    const list = listCatalogUpdateHistory(2);
    assert.equal(list.length, 2);
    assert.ok(list[0].id > list[1].id);
  });
});
