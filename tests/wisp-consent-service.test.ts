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

  test('approve() on a failed execution reaches failed/consumed, not succeeded', async () => {
    const store = createWispConsentProposalStore();
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => ({ slot: 1, executed: true, executionStatus: 'rejected', diagnostic: { code: 'WISP_EXECUTION_CONSENT_REJECTED', message: 'x' } as never }),
        dispose: () => {},
      },
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const result = await service.approve(view.proposalId);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.proposal.status, 'consumed');
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
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    await service.approve(view.proposalId);
    const second = await service.approve(view.proposalId);
    assert.equal(second.ok, false);
    assert.equal(confirmCalls, 1, 'confirmPending (and therefore any real execution) must never run a second time for the same proposal');
  });

  test('approve() after expiration fails and never mints a token or calls confirmPending', async () => {
    const store = createWispConsentProposalStore();
    let mintCalls = 0;
    let confirmCalls = 0;
    let fakeNow = Date.now();
    const service = createWispConsentService({
      store,
      quickSlotController: {
        activate: async () => { throw new Error('unused'); },
        confirmPending: async () => { confirmCalls += 1; return { slot: 1, executed: true, executionStatus: 'applied' }; },
        dispose: () => {},
      },
      mintConsentToken: () => { mintCalls += 1; return { tokenId: 'token-1', expiresAt: new Date().toISOString() }; },
      recordAuditEvent: () => {},
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

  test('reject() transitions a pending proposal and blocks a later approve()', async () => {
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
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const rejection = service.reject(view.proposalId);
    assert.equal(rejection.ok, true);
    const approveAfterReject = await service.approve(view.proposalId);
    assert.equal(approveAfterReject.ok, false);
    assert.equal(confirmCalls, 0);
  });

  test('duplicate reject() on an already-rejected proposal fails (not idempotent — rejection is a one-time decision)', () => {
    const store = createWispConsentProposalStore();
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true }), dispose: () => {} },
      mintConsentToken: () => null,
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    service.reject(view.proposalId);
    const second = service.reject(view.proposalId);
    assert.equal(second.ok, false);
  });

  test('cancel() is idempotent — cancelling an already-cancelled proposal succeeds as a no-op', () => {
    const store = createWispConsentProposalStore();
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true }), dispose: () => {} },
      mintConsentToken: () => null,
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    const first = service.cancel(view.proposalId);
    assert.equal(first.ok, true);
    const second = service.cancel(view.proposalId);
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.proposal.status, 'cancelled');
  });

  test('cancel() after approval/execution has started is not idempotent-into-cancelled — it just reports current terminal status without touching it', async () => {
    const store = createWispConsentProposalStore();
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true, executionStatus: 'applied' }), dispose: () => {} },
      mintConsentToken: () => ({ tokenId: 'token-1', expiresAt: new Date().toISOString() }),
      recordAuditEvent: () => {},
    });
    service.handlePendingConsent(pendingInfo());
    const [view] = service.listPending();
    await service.approve(view.proposalId);
    const cancelAfterConsumed = service.cancel(view.proposalId);
    assert.equal(cancelAfterConsumed.ok, true);
    if (cancelAfterConsumed.ok) assert.equal(cancelAfterConsumed.proposal.status, 'consumed', 'cancel on a terminal proposal must not overwrite its real terminal status');
  });

  test('handlePresentationStateReset invalidates every pending/approved/executing proposal and audits it, leaving terminal ones untouched', () => {
    const store = createWispConsentProposalStore();
    const audits: string[] = [];
    const service = createWispConsentService({
      store,
      quickSlotController: { activate: async () => { throw new Error('unused'); }, confirmPending: async () => ({ slot: 1, executed: true }), dispose: () => {} },
      mintConsentToken: () => null,
      recordAuditEvent: (input) => audits.push(input.eventType),
    });
    service.handlePendingConsent(pendingInfo());
    const [pendingView] = service.listPending();
    service.handlePendingConsent(pendingInfo({ lowLevelProposalId: 'low-2', slot: 2 }));
    const rejected = service.reject(service.listPending().find((p) => p.proposalId !== pendingView.proposalId)!.proposalId);
    assert.equal(rejected.ok, true);

    service.handlePresentationStateReset();

    assert.equal(store.get(pendingView.proposalId)?.status, 'invalidated');
    assert.equal(store.get((rejected as { proposal: { proposalId: string } }).proposal.proposalId)?.status, 'rejected', 'a terminal proposal must survive a lifecycle reset untouched');
    assert.ok(audits.includes('invalidated'));
  });
});
