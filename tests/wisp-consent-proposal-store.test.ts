import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createWispConsentProposalStore } from '../src/core/adaptive-wisp/consent/proposal-store.ts';
import type { WispConsentProposal } from '../src/core/adaptive-wisp/consent/proposal-types.ts';

function baseInput(overrides: Partial<Omit<WispConsentProposal, 'proposalId' | 'status'>> = {}) {
  const nowMs = Date.now();
  return {
    slot: 1 as const,
    lowLevelProposalId: 'low-1',
    operationType: 'write' as const,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 10 * 60_000).toISOString(),
    canonicalGameId: 'game-1' as never,
    profileId: 'profile-1' as never,
    actionId: 'action-1' as never,
    entryId: 'entry-1' as never,
    dataType: 'int32',
    operationDetail: { kind: 'write' as const, requestedValue: 99 },
    session: { sessionId: 'session-1', sessionGeneration: 1 },
    safeDescription: 'Set ammo to 99',
    ...overrides,
  };
}

describe('WispConsentProposalStore — state machine', () => {
  test('create() starts a proposal in pending', () => {
    const store = createWispConsentProposalStore();
    const proposal = store.create(baseInput());
    assert.equal(proposal.status, 'pending');
    assert.ok(proposal.proposalId);
  });

  test('valid transition pending -> approved -> executing -> succeeded -> consumed', () => {
    const store = createWispConsentProposalStore();
    const proposal = store.create(baseInput());
    assert.equal(store.transition(proposal.proposalId, 'approved').ok, true);
    assert.equal(store.transition(proposal.proposalId, 'executing').ok, true);
    assert.equal(store.transition(proposal.proposalId, 'succeeded').ok, true);
    assert.equal(store.transition(proposal.proposalId, 'consumed').ok, true);
    assert.equal(store.get(proposal.proposalId)?.status, 'consumed');
  });

  for (const forbidden of ['approved', 'executing', 'succeeded', 'failed', 'consumed'] as const) {
    test(`rejected -> ${forbidden} is forbidden`, () => {
      const store = createWispConsentProposalStore();
      const proposal = store.create(baseInput());
      assert.equal(store.transition(proposal.proposalId, 'rejected').ok, true);
      const result = store.transition(proposal.proposalId, forbidden);
      assert.equal(result.ok, false);
      assert.equal(store.get(proposal.proposalId)?.status, 'rejected');
    });
  }

  for (const forbidden of ['approved', 'executing', 'succeeded', 'failed', 'consumed'] as const) {
    test(`expired -> ${forbidden} is forbidden`, () => {
      const store = createWispConsentProposalStore();
      const proposal = store.create(baseInput());
      assert.equal(store.transition(proposal.proposalId, 'expired').ok, true);
      const result = store.transition(proposal.proposalId, forbidden);
      assert.equal(result.ok, false);
    });
  }

  test('cancelled -> executing is forbidden', () => {
    const store = createWispConsentProposalStore();
    const proposal = store.create(baseInput());
    store.transition(proposal.proposalId, 'cancelled');
    const result = store.transition(proposal.proposalId, 'executing');
    assert.equal(result.ok, false);
  });

  test('consumed -> approved (re-approval after consumption) is forbidden', () => {
    const store = createWispConsentProposalStore();
    const proposal = store.create(baseInput());
    store.transition(proposal.proposalId, 'approved');
    store.transition(proposal.proposalId, 'executing');
    store.transition(proposal.proposalId, 'succeeded');
    store.transition(proposal.proposalId, 'consumed');
    const result = store.transition(proposal.proposalId, 'approved');
    assert.equal(result.ok, false);
  });

  test('failed -> failed (silent retry) is forbidden', () => {
    const store = createWispConsentProposalStore();
    const proposal = store.create(baseInput());
    store.transition(proposal.proposalId, 'approved');
    store.transition(proposal.proposalId, 'executing');
    store.transition(proposal.proposalId, 'failed');
    const result = store.transition(proposal.proposalId, 'executing');
    assert.equal(result.ok, false);
  });

  test('succeeded -> executing (execute again) is forbidden', () => {
    const store = createWispConsentProposalStore();
    const proposal = store.create(baseInput());
    store.transition(proposal.proposalId, 'approved');
    store.transition(proposal.proposalId, 'executing');
    store.transition(proposal.proposalId, 'succeeded');
    const result = store.transition(proposal.proposalId, 'executing');
    assert.equal(result.ok, false);
  });

  test('transition against an unknown proposalId fails', () => {
    const store = createWispConsentProposalStore();
    const result = store.transition('does-not-exist', 'approved');
    assert.equal(result.ok, false);
  });

  test('backend-time authority: getLive() lazily expires a pending proposal once its TTL has passed, independent of any renderer-supplied clock', () => {
    const store = createWispConsentProposalStore();
    const nowMs = 1_000_000;
    const proposal = store.create(baseInput({ createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 1000).toISOString() }));
    const stillPending = store.getLive(proposal.proposalId, nowMs + 500);
    assert.equal(stillPending?.status, 'pending');
    const nowExpired = store.getLive(proposal.proposalId, nowMs + 1001);
    assert.equal(nowExpired?.status, 'expired');
  });

  test('approval attempted at/after expiration fails: transition() also lazily expires before checking the requested transition', () => {
    const store = createWispConsentProposalStore();
    const nowMs = 1_000_000;
    const proposal = store.create(baseInput({ createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 1000).toISOString() }));
    const result = store.transition(proposal.proposalId, 'approved', nowMs + 5000);
    assert.equal(result.ok, false);
    assert.equal(store.get(proposal.proposalId)?.status, 'expired');
  });

  test('invalidateWhere() sweeps every matching non-terminal proposal and skips terminal ones', () => {
    const store = createWispConsentProposalStore();
    const a = store.create(baseInput({ session: { sessionId: 'sA', sessionGeneration: 1 } }));
    const b = store.create(baseInput({ session: { sessionId: 'sA', sessionGeneration: 1 } }));
    const c = store.create(baseInput({ session: { sessionId: 'sB', sessionGeneration: 1 } }));
    store.transition(b.proposalId, 'rejected');

    const count = store.invalidateWhere((p) => p.session.sessionId === 'sA');
    assert.equal(count, 1, 'only proposal a is non-terminal and matches sessionId sA; b matches but is already terminal (rejected)');
    assert.equal(store.get(a.proposalId)?.status, 'invalidated');
    assert.equal(store.get(b.proposalId)?.status, 'rejected', 'terminal proposals must never be touched by a lifecycle sweep');
    assert.equal(store.get(c.proposalId)?.status, 'pending', 'non-matching proposal must be left alone');
  });

  test('list() returns every stored proposal', () => {
    const store = createWispConsentProposalStore();
    store.create(baseInput());
    store.create(baseInput());
    assert.equal(store.list().length, 2);
  });

  test('clear() empties the store', () => {
    const store = createWispConsentProposalStore();
    store.create(baseInput());
    store.clear();
    assert.equal(store.list().length, 0);
  });
});
