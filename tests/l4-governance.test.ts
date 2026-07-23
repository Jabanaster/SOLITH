import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialL4GovernanceState,
  l4GovernanceReducer,
  type L4EntryEvidence,
} from '../src/core/registry/l4-governance.ts';

const l3Entry: L4EntryEvidence = {
  ctEntryId: 'entry-health',
  label: 'Health Pointer',
  certificationTier: 'L3',
  moduleTarget: 'Avowed-Win64-Shipping.exe',
  pointerChain: ['0x1234', '0x20'],
  valueType: 'Float',
  l3ArtifactHash: 'a'.repeat(64),
};

describe('L4 governance reducer', () => {
  test('blocks L2 entries from opening the L4 authorization modal', () => {
    const l2Entry: L4EntryEvidence = { ...l3Entry, certificationTier: 'L2', l3ArtifactHash: undefined };
    const state = createInitialL4GovernanceState([l2Entry]);

    assert.throws(
      () => l4GovernanceReducer(state, { type: 'REQUEST_AUTHORIZE', entry: l2Entry }),
      /not L3/,
    );
    assert.equal(state.selectedEntryId, null);
    assert.equal(state.entries[l2Entry.ctEntryId]?.tier, 'L2');
  });

  test('rejects direct L4 promotion without modal confirmation and valid L3 artifact evidence', () => {
    const state = createInitialL4GovernanceState([l3Entry]);
    const missingArtifact: L4EntryEvidence = { ...l3Entry, l3ArtifactHash: undefined };

    assert.throws(
      () =>
        l4GovernanceReducer(state, {
          type: 'PROMOTE_TO_L4',
          entry: missingArtifact,
          modalConfirmed: true,
          auditWriteOk: true,
          timestamp: '2026-07-22T00:00:00.000Z',
        }),
      /missing a valid L3 artifact hash/,
    );

    assert.throws(
      () =>
        l4GovernanceReducer(state, {
          type: 'PROMOTE_TO_L4',
          entry: l3Entry,
          modalConfirmed: false,
          auditWriteOk: true,
          timestamp: '2026-07-22T00:00:00.000Z',
        }),
      /modal confirmation/,
    );

    assert.equal(state.entries[l3Entry.ctEntryId]?.tier, 'L3');
  });

  test('requires authorization audit before activation and records rollback actions', () => {
    const initial = createInitialL4GovernanceState([l3Entry]);

    assert.throws(
      () =>
        l4GovernanceReducer(initial, {
          type: 'TOGGLE_ACTIVE',
          entry: l3Entry,
          active: true,
          auditWriteOk: true,
          timestamp: '2026-07-22T00:00:01.000Z',
        }),
      /not L4/,
    );

    assert.throws(
      () =>
        l4GovernanceReducer(initial, {
          type: 'PROMOTE_TO_L4',
          entry: l3Entry,
          modalConfirmed: true,
          auditWriteOk: false,
          timestamp: '2026-07-22T00:00:02.000Z',
        }),
      /audit log write did not complete/,
    );

    const authorized = l4GovernanceReducer(initial, {
      type: 'PROMOTE_TO_L4',
      entry: l3Entry,
      modalConfirmed: true,
      auditWriteOk: true,
      timestamp: '2026-07-22T00:00:03.000Z',
    });

    assert.equal(authorized.entries[l3Entry.ctEntryId]?.tier, 'L4');
    assert.equal(authorized.entries[l3Entry.ctEntryId]?.snapshotCaptured, true);
    assert.deepEqual(authorized.auditLog.map((entry) => entry.action), ['AUTHORIZED']);

    const active = l4GovernanceReducer(authorized, {
      type: 'TOGGLE_ACTIVE',
      entry: l3Entry,
      active: true,
      auditWriteOk: true,
      timestamp: '2026-07-22T00:00:04.000Z',
    });

    assert.equal(active.entries[l3Entry.ctEntryId]?.active, true);
    assert.deepEqual(active.auditLog.map((entry) => entry.action), ['AUTHORIZED', 'WRITE_TOGGLED']);

    const rolledBack = l4GovernanceReducer(active, {
      type: 'DISABLE_AND_ROLLBACK',
      entry: l3Entry,
      auditWriteOk: true,
      timestamp: '2026-07-22T00:00:05.000Z',
    });

    assert.equal(rolledBack.entries[l3Entry.ctEntryId]?.active, false);
    assert.deepEqual(rolledBack.auditLog.map((entry) => entry.action), [
      'AUTHORIZED',
      'WRITE_TOGGLED',
      'ROLLED_BACK',
    ]);
  });
});
