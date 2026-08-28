import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createWispConsentProposalStore } from '../src/core/adaptive-wisp/consent/proposal-store.ts';
import { createWispConsentService } from '../src/core/adaptive-wisp/consent/consent-service.ts';
import type { WispPendingConsentInfo, WispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.ts';
import type { WispHotkeyActivationResult } from '../src/core/adaptive-wisp/hotkey-types.ts';

function pendingInfo(overrides: Partial<WispPendingConsentInfo> = {}): WispPendingConsentInfo {
  return {
    slot: 1,
    lowLevelProposalId: 'low-1',
    request: { control: 'set', actionId: 'action-1' as never, profileId: 'profile-1' as never, value: 99 },
    requestedValue: 99,
    boundAction: { actionId: 'action-1' as never, entryId: 'entry-1' as never, label: 'Ammo', controlType: 'set', availability: 'available', entryDescriptor: { id: 'entry-1' as never, label: 'Ammo', dataType: 'int32', enabled: true } } as never,
    actionDefinition: { id: 'action-1', label: 'Ammo', controlType: 'set', presets: [{ id: 'default', label: 'Default', value: 99 }] } as never,
    boundProfile: { profileId: 'profile-1' as never, gameId: 'game-1' as never, sessionId: 'session-1', sessionGeneration: 1 } as never,
    context: { gameId: 'game-1' as never, sessionId: 'session-1', sessionGeneration: 1 },
    ...overrides,
  };
}

function makeController(confirmResult: WispHotkeyActivationResult): { controller: WispQuickSlotController; calls: number } {
  const calls = { n: 0 };
  const controller: WispQuickSlotController = {
    activate: async () => { throw new Error('not used in this test'); },
    confirmPending: async () => { calls.n += 1; return confirmResult; },
    dispose: () => {},
  };
  return { controller, calls: calls.n };
}

describe('WispConsentService', () => {
  test('handlePendingConsent creates exactly one pending proposal and audits proposal_created', () => {
    const store = createWispConsentProposalStore();
    const audits: string[] = [];
    const service = createWispConsentService({
      store,
      quickSlotController: makeController({ slot: 1, executed: true, executionStatus: 'applied' }).controller,
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      releaseLowLevelAuthority: () => {},
      recordAuditEvent: (input) => audits.push(input.eventType),
    });
    service.handlePendingConsent(pendingInfo());
    const pending = service.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].status, 'pending');
    assert.deepEqual(audits, ['proposal_created']);
  });

  test('approve() mints a token, calls confirmPending exactly once, and reaches succeeded/consumed on a successful execution', async () => {
    const store = createWispConsentProposalStore();
    const audits: string[] = [];
    let mintCalls = 0;
    const controllerImpl = { calls: 0 };
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => { controllerImpl.calls += 1; return { slot: 1, executed: true, executionStatus: 'applied' }; },
        dispose: () => {},
      },
      mintConsentToken: (input) => {
        mintCalls += 1;
        assert.equal(input.lowLevelProposalId, 'low-1');
        assert.equal(input.operationType, 'write');
        return { tokenId: 'token-1', expiresAt: new Date().toISOString() };
      },
      releaseLowLevelAuthority: () => {},
      recordAuditEvent: (input) => audits.push(input.eventType),
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();

    const result = await service.approve(view.proposalId);
    assert.equal(result.ok, true);
    assert.equal(mintCalls, 1);
    assert.equal(controllerImpl.calls, 1);
    if (result.ok) assert.equal(result.proposal.status, 'consumed');
    assert.deepEqual(audits, ['proposal_created', 'approved', 'execution_started', 'execution_succeeded', 'execution_succeeded']);
  });

  test('approve() on a failed execution reaches failed/consumed, not succeeded, and releases the low-level authority', async () => {
    const store = createWispConsentProposalStore();
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => ({ slot: 1, executed: true, executionStatus: 'rejected', diagnostic: { code: 'WISP_EXECUTION_CONSENT_REJECTED', message: 'x' } as never }),
        dispose: () => {},
      },
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const result = await service.approve(view.proposalId);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.proposal.status, 'consumed');
    assert.deepEqual(released, [{ lowLevelProposalId: 'low-1', operationType: 'write' }], 'a failed confirm attempt must release the staged low-level proposal so it does not remain reusable/replayable');
  });

  test('double approval: second approve() on an already-consumed proposal fails', async () => {
    const store = createWispConsentProposalStore();
    let confirmCalls = 0;
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => { confirmCalls += 1; return { slot: 1, executed: true, executionStatus: 'applied' }; },
        dispose: () => {},
      },
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      releaseLowLevelAuthority: () => {},
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    await service.approve(view.proposalId);
    const second = await service.approve(view.proposalId);
    assert.equal(second.ok, false);
    assert.equal(confirmCalls, 1, 'confirmPending (and therefore any real execution) must never run a second time for the same proposal');
  });

  test('approve() after expiration fails and never mints a token or calls confirmPending; the lazy expiration is audited and releases low-level authority', async () => {
    const store = createWispConsentProposalStore();
    let mintCalls = 0;
    let confirmCalls = 0;
    let fakeNow = Date.now();
    const audits: string[] = [];
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => { confirmCalls += 1; return { slot: 1, executed: true, executionStatus: 'applied' }; },
        dispose: () => {},
      },
      mintConsentToken: () => { mintCalls += 1; return { tokenId: 'token-1', expiresAt: new Date().toISOString() }; },
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: (input) => audits.push(input.eventType),
      ttlMs: 1000,
      nowMs: () => fakeNow,
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    fakeNow += 5000;
    const result = await service.approve(view.proposalId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostic.code, 'WISP_CONSENT_PROPOSAL_EXPIRED');
    assert.equal(mintCalls, 0);
    assert.equal(confirmCalls, 0);
    assert.equal(store.get(view.proposalId)?.status, 'expired', 'the lazy expiration must actually be committed to the store, not just reported to the caller');
    assert.ok(audits.includes('expired'), '"expired" is a required audit event (Section 12/20) — it must not stay silent just because nobody happened to poll before TTL');
    assert.deepEqual(released, [{ lowLevelProposalId: 'low-1', operationType: 'write' }], 'an expired proposal must release its staged low-level authority, not remain indefinitely');
  });

  test('listPending() lazily reaps an expired proposal out of the pending list and audits/releases it exactly once', () => {
    const store = createWispConsentProposalStore();
    let fakeNow = Date.now();
    const audits: string[] = [];
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true }), dispose: () => {} },
      mintConsentToken: () => null,
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: (input) => audits.push(input.eventType),
      ttlMs: 1000,
      nowMs: () => fakeNow,
    });
    service.handlePendingConsent(pendingInfo());
    fakeNow += 5000;
    const pendingAfterExpiry = service.listPending();
    assert.equal(pendingAfterExpiry.length, 0, 'an expired proposal must not still be reported as pending');
    assert.deepEqual(audits.filter((e) => e === 'expired'), ['expired']);
    assert.equal(released.length, 1, 'reaping via listPending() must release the low-level authority exactly once');
    // Calling listPending() again must not double-audit or double-release —
    // the proposal is already terminal ('expired' has no outgoing transitions).
    service.listPending();
    assert.deepEqual(audits.filter((e) => e === 'expired'), ['expired']);
    assert.equal(released.length, 1);
  });

  test('approve() when mintConsentToken returns null (session no longer resolves) invalidates the proposal and never calls confirmPending', async () => {
    const store = createWispConsentProposalStore();
    const audits: string[] = [];
    let confirmCalls = 0;
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => { confirmCalls += 1; return { slot: 1, executed: true, executionStatus: 'applied' }; },
        dispose: () => {},
      },
      mintConsentToken: () => null,
      releaseLowLevelAuthority: () => {},
      recordAuditEvent: (input) => audits.push(input.eventType),
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const result = await service.approve(view.proposalId);
    assert.equal(result.ok, false);
    assert.equal(confirmCalls, 0);
    assert.ok(audits.includes('invalidated'));
    assert.equal(store.get(view.proposalId)?.status, 'invalidated');
  });

  test('reject() transitions a pending proposal, releases the low-level authority, and blocks a later approve()', async () => {
    const store = createWispConsentProposalStore();
    let confirmCalls = 0;
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => { confirmCalls += 1; return { slot: 1, executed: true, executionStatus: 'applied' }; },
        dispose: () => {},
      },
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const rejection = service.reject(view.proposalId);
    assert.equal(rejection.ok, true);
    const approveAfterReject = await service.approve(view.proposalId);
    assert.equal(approveAfterReject.ok, false);
    assert.equal(confirmCalls, 0);
    assert.deepEqual(released, [{ lowLevelProposalId: 'low-1', operationType: 'write' }]);
  });

  test('duplicate reject() on an already-rejected proposal fails (not idempotent — rejection is a one-time decision) and releases exactly once', () => {
    const store = createWispConsentProposalStore();
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true }), dispose: () => {} },
      mintConsentToken: () => null,
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    service.reject(view.proposalId);
    const second = service.reject(view.proposalId);
    assert.equal(second.ok, false);
    assert.equal(released.length, 1, 'a rejection that fails (already-rejected) must not release a second time');
  });

  test('cancel() is idempotent — cancelling an already-cancelled proposal succeeds as a no-op and releases exactly once', () => {
    const store = createWispConsentProposalStore();
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true }), dispose: () => {} },
      mintConsentToken: () => null,
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const first = service.cancel(view.proposalId);
    assert.equal(first.ok, true);
    const second = service.cancel(view.proposalId);
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.proposal.status, 'cancelled');
    assert.equal(released.length, 1, 'the idempotent no-op second cancel() must not release a second time');
  });

  test('cancel() after approval/execution has started is not idempotent-into-cancelled — it just reports current terminal status without touching it, and does not double-release', async () => {
    const store = createWispConsentProposalStore();
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true, executionStatus: 'applied' }), dispose: () => {} },
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    await service.approve(view.proposalId);
    const cancelAfterConsumed = service.cancel(view.proposalId);
    assert.equal(cancelAfterConsumed.ok, true);
    if (cancelAfterConsumed.ok) assert.equal(cancelAfterConsumed.proposal.status, 'consumed', 'cancel on a terminal proposal must not overwrite its real terminal status');
    // A successful execution released nothing (the low-level entry was
    // deleted by the real confirmWrite/startFreezeConfirmed success path
    // instead); cancel() on the already-terminal 'consumed' status is a
    // read-only no-op and must not release again.
    assert.equal(released.length, 0);
  });

  test('handlePresentationStateReset invalidates every pending/approved/executing proposal, releases pending/approved (not executing) low-level authority, and leaves terminal ones untouched', () => {
    const store = createWispConsentProposalStore();
    const audits: string[] = [];
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true }), dispose: () => {} },
      mintConsentToken: () => null,
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: (input) => audits.push(input.eventType),
    });
    service.handlePendingConsent(pendingInfo());
    const [pendingView] = service.listPending();
    service.handlePendingConsent(pendingInfo({ lowLevelProposalId: 'low-2', slot: 2 }));
    const rejected = service.reject(service.listPending().find((p) => p.proposalId !== pendingView.proposalId)!.proposalId);
    assert.equal(rejected.ok, true);
    released.length = 0; // reject() above already released low-2; isolate the reset's own releases below.

    service.handlePresentationStateReset();

    assert.equal(store.get(pendingView.proposalId)?.status, 'invalidated');
    assert.equal(store.get((rejected as { proposal: { proposalId: string } }).proposal.proposalId)?.status, 'rejected', 'a terminal proposal must survive a lifecycle reset untouched');
    assert.ok(audits.includes('invalidated'));
    assert.deepEqual(released, [{ lowLevelProposalId: 'low-1', operationType: 'write' }], 'only the still-pending proposal (low-1) is released by the reset — the already-terminal rejected one (low-2) must not be released a second time');
  });

  test('handlePresentationStateReset does NOT release an executing proposal — an in-flight confirmWrite/confirmFreeze call must not be raced', async () => {
    const store = createWispConsentProposalStore();
    const released: Array<{ lowLevelProposalId: string; operationType: string }> = [];
    let releaseConfirmPending: (() => void) | null = null;
    const confirmGate = new Promise<void>((resolve) => { releaseConfirmPending = resolve; });
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => { await confirmGate; return { slot: 1, executed: true, executionStatus: 'applied' }; },
        dispose: () => {},
      },
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      releaseLowLevelAuthority: (input) => released.push(input),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const approvePromise = service.approve(view.proposalId);
    // approve() has minted the token and moved the proposal to 'executing'
    // (both synchronous before the confirmPending await), but confirmPending
    // itself is still gated — this is the exact "approval/detach race" window.
    assert.equal(store.get(view.proposalId)?.status, 'executing');

    service.handlePresentationStateReset();
    assert.equal(released.length, 0, 'an executing proposal must not be released while its confirm call may still be in flight');

    releaseConfirmPending!();
    await approvePromise;
  });
});
