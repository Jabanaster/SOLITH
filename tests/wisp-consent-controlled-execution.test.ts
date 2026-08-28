import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { observeProcess } from '../src/core/v2/observers/process-observer.ts';
import { issueWriteConsent, consumeWriteConsent, type WriteConsentBinding } from '../src/core/consent/write-consent.ts';
import { createWispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.ts';
import { createWispConsentProposalStore } from '../src/core/adaptive-wisp/consent/proposal-store.ts';
import { createWispConsentService } from '../src/core/adaptive-wisp/consent/consent-service.ts';
import { createExplicitGameIdentityBridge } from '../src/core/adaptive-wisp/game-identity-bridge.ts';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.ts';
import { WISP_PROFILE_SCHEMA_VERSION, type WispActionDefinition, type WispGameProfile, type WispTrainerEntryLookup, type WispTrainerExecutionAdapter, type WispCanonicalWriteOutcome, type WispBoundEntryDescriptor } from '../src/core/adaptive-wisp/index.ts';
import type { WispRuntimeContext } from '../src/core/adaptive-wisp/runtime-types.ts';

/**
 * Adaptive Wisp Phase 1 — Section 18/19 controlled execution certification.
 *
 * Real, with no substitution:
 *   - a genuine OS process (ping.exe), spawned and owned by this test
 *   - the REAL `observeProcess()` — actual Get-CimInstance query
 *   - the REAL consent proposal store + consent service (this closeout's
 *     own new code, entirely unmocked)
 *   - the REAL `WispQuickSlotController` (Increment 5, unmodified logic)
 *   - the REAL `executeWispAction` (Increment 4, unmodified), reached
 *     transitively through the controller — never called directly
 *   - the REAL one-use write-consent token mechanism
 *     (`issueWriteConsent`/`consumeWriteConsent`, unmodified) — genuinely
 *     minted and genuinely consumed, not stubbed
 *
 * Test-doubled, per Section 18's explicitly-authorized fallback (matching
 * the SAME convention already established by Increment 4/5/6's own tests —
 * see adaptive-wisp-process-backed-certification.test.ts): the deepest
 * layer, `WispTrainerExecutionAdapter`, which would otherwise perform real
 * cross-process ReadProcessMemory/WriteProcessMemory against ping.exe (a
 * genuinely dangerous and unnecessary thing for a test to do to a live
 * system process). The double owns a controlled in-memory "ammo" value and
 * self-verifies every write via a real read-back — this is adapter-level
 * certification, not real process-memory certification, and is labeled as
 * such throughout.
 */

const GAME_ID = 'controlled-game' as never;
const CATALOG_GAME_ID = 'controlled-catalog-game';
const ACTION_ID = 'set-ammo';
const ENTRY_ID = 'ammo';

function isWindows(): boolean {
  return os.platform() === 'win32';
}

function controlledGameProfile(): WispGameProfile {
  const actions: WispActionDefinition[] = [{ id: ACTION_ID, entryId: ENTRY_ID, label: 'Ammo', controlType: 'set', slot: 1, presets: [{ id: 'p-99', label: '99', value: 99 }] }];
  return { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'controlled-profile', gameId: GAME_ID, source: 'builtin', groups: [], actions };
}

function entryLookup(): WispTrainerEntryLookup {
  const descriptor: WispBoundEntryDescriptor = { id: ENTRY_ID as never, label: 'Ammo', dataType: 'int32', enabled: true };
  return { resolveEntry: () => descriptor };
}

interface ControlledMemory {
  ammo: number;
  otherStat: number;
}

/** Adapter-level double — see this file's top-of-file doc comment. Every write goes through the REAL write-consent token mechanism; only the actual memory read/write is simulated. */
function createControlledTrainerAdapter(memory: ControlledMemory, sessionIdentity: { pid: number; executablePath: string; processStartTime: string; executableName: string }) {
  const pending = new Map<string, { requestedValue: number }>();
  let seq = 0;
  const consumedTokens: string[] = [];

  const adapter: WispTrainerExecutionAdapter = {
    getCurrentState: () => ({ currentValue: memory.ammo, dataType: 'int32', supportsControls: ['set'] }),
    proposeWrite: (_gameId, _entryId, requestedValue) => {
      seq += 1;
      const proposalId = `controlled-proposal-${seq}`;
      pending.set(proposalId, { requestedValue: requestedValue as number });
      return { proposalId };
    },
    confirmWrite: async (proposalId, consentToken) => {
      const proposal = pending.get(proposalId);
      if (!proposal) return { ok: false, status: 'rejected', reason: 'unknown_or_consumed_proposal' };
      const binding: WriteConsentBinding = {
        operation: 'live_memory_confirm_write',
        sessionKey: 'wisp-controlled-cert',
        proposalId,
        attachedPid: sessionIdentity.pid,
        attachedExecutableName: sessionIdentity.executableName,
        executablePath: sessionIdentity.executablePath,
        processStartTime: sessionIdentity.processStartTime,
        address: `controlled:${ENTRY_ID}`,
        dataType: 'int32',
        currentValue: memory.ammo,
        requestedValue: proposal.requestedValue,
      };
      const result = consumeWriteConsent(consentToken, binding);
      if (!result.ok) return { ok: false, status: 'rejected', reason: result.reason };
      consumedTokens.push(consentToken);
      const before = memory.otherStat;
      memory.ammo = proposal.requestedValue;
      pending.delete(proposalId);
      // Real read-back verification within the double, plus proof an
      // unrelated controlled value was never touched (Section 19).
      assert.equal(memory.ammo, proposal.requestedValue, 'read-back after write must match the approved value exactly');
      assert.equal(memory.otherStat, before, 'an unrelated controlled value must never change from an ammo write');
      return { ok: true, status: 'applied', currentValue: memory.ammo };
    },
    proposeFreeze: () => null,
    confirmFreeze: async () => ({ ok: false, status: 'rejected', reason: 'not_used_in_this_certification' }),
    stopFreeze: () => ({ ok: false, status: 'rejected', reason: 'not_used_in_this_certification' }),
  };
  return { adapter, pending, consumedTokens };
}

function mintTokenFor(sessionIdentity: { pid: number; executablePath: string; processStartTime: string; executableName: string }, memory: ControlledMemory) {
  return (input: { lowLevelProposalId: string }, requestedValue: number) => {
    const binding: WriteConsentBinding = {
      operation: 'live_memory_confirm_write',
      sessionKey: 'wisp-controlled-cert',
      proposalId: input.lowLevelProposalId,
      attachedPid: sessionIdentity.pid,
      attachedExecutableName: sessionIdentity.executableName,
      executablePath: sessionIdentity.executablePath,
      processStartTime: sessionIdentity.processStartTime,
      address: `controlled:${ENTRY_ID}`,
      dataType: 'int32',
      currentValue: memory.ammo,
      requestedValue,
    };
    const artifact = issueWriteConsent(binding);
    return { tokenId: artifact.tokenId, expiresAt: artifact.expiresAt };
  };
}

/** Builds one full real harness (store + service + controller) bound to one controlled memory instance and one real process identity. */
function buildHarness(sessionIdentity: { pid: number; executablePath: string; processStartTime: string; executableName: string }) {
  const memory: ControlledMemory = { ammo: 0, otherStat: 42 };
  const { adapter, pending } = createControlledTrainerAdapter(memory, sessionIdentity);
  const identityBridge = createExplicitGameIdentityBridge({ [GAME_ID]: CATALOG_GAME_ID });
  let context: WispRuntimeContext | null = { gameId: GAME_ID, sessionId: `session:${sessionIdentity.pid}`, sessionGeneration: 1 };

  const activeProfileProvider = createWispActiveProfileProvider({
    getCurrentContext: () => context,
    resolveProfile: async (c) => (c.gameId === GAME_ID ? { ok: true, profile: controlledGameProfile() } : { ok: false }),
    entryLookup: entryLookup(),
  });

  const store = createWispConsentProposalStore();
  let consentService: ReturnType<typeof createWispConsentService>;
  const mint = mintTokenFor(sessionIdentity, memory);
  const pendingRequestedValueByLowId = new Map<string, number>();

  const controller = createWispQuickSlotController({
    activeProfileProvider,
    getCurrentContext: () => context,
    executorDeps: { entryLookup: entryLookup(), identityBridge, trainerAdapter: adapter },
    onPendingConsent: (info) => {
      pendingRequestedValueByLowId.set(info.lowLevelProposalId, info.requestedValue as number);
      consentService.handlePendingConsent(info);
    },
    onPresentationStateReset: () => consentService.handlePresentationStateReset(),
  });

  consentService = createWispConsentService({
    store,
    quickSlotController: controller,
    mintConsentToken: (input) => {
      const requestedValue = pendingRequestedValueByLowId.get(input.lowLevelProposalId);
      if (requestedValue === undefined) return null;
      return mint(input, requestedValue);
    },
    recordAuditEvent: () => {},
  });

  return {
    memory,
    pendingLowLevel: pending,
    controller,
    consentService,
    setContext: (next: WispRuntimeContext | null) => { context = next; },
  };
}

describe('Phase 1 controlled execution certification (real process, real consent domain, adapter-level memory double)', { skip: !isWindows() ? 'process-observer.ts requires win32' : false }, () => {
  let child: ChildProcess | null = null;
  let sessionIdentity: { pid: number; executablePath: string; processStartTime: string; executableName: string };

  before(async () => {
    child = spawn('ping.exe', ['-n', '20', '127.0.0.1'], { windowsHide: true });
    assert.ok(child.pid, 'the controlled process must actually start');
    await new Promise((r) => setTimeout(r, 800));
    const observation = await observeProcess('ping.exe');
    assert.equal(observation.availability, 'available');
    assert.ok(observation.identity);
    assert.equal(observation.identity!.pid, child.pid, 'the real OS observer must independently confirm the same PID spawn() reported');
    sessionIdentity = {
      pid: observation.identity!.pid,
      executablePath: observation.identity!.executablePath!,
      processStartTime: observation.identity!.startTime!,
      executableName: 'ping.exe',
    };
  });

  after(() => {
    if (child?.pid && !child.killed) {
      try { child.kill(); } catch { /* already exited */ }
    }
  });

  test('one set/write operation: real proposal -> real approval -> real one-use token -> real (adapter-level) write -> real read-back', async () => {
    const h = buildHarness(sessionIdentity);
    const activation = await h.controller.activate(1);
    assert.equal(activation.executionStatus, 'pending-consent');
    const [pendingView] = h.consentService.listPending();
    assert.ok(pendingView);

    const result = await h.consentService.approve(pendingView.proposalId);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.proposal.status, 'consumed');
      assert.equal(result.execution?.executionStatus, 'applied');
    }
    assert.equal(h.memory.ammo, 99, 'the controlled memory must reflect the real approved write');
  });

  test('one rejected proposal: rejection blocks execution; the controlled memory is never touched', async () => {
    const h = buildHarness(sessionIdentity);
    await h.controller.activate(1);
    const [pendingView] = h.consentService.listPending();
    const rejection = h.consentService.reject(pendingView.proposalId);
    assert.equal(rejection.ok, true);
    const approveAfterReject = await h.consentService.approve(pendingView.proposalId);
    assert.equal(approveAfterReject.ok, false);
    assert.equal(h.memory.ammo, 0, 'rejected proposal must never write');
  });

  test('one cancelled proposal: cancellation blocks execution; the controlled memory is never touched', async () => {
    const h = buildHarness(sessionIdentity);
    await h.controller.activate(1);
    const [pendingView] = h.consentService.listPending();
    const cancellation = h.consentService.cancel(pendingView.proposalId);
    assert.equal(cancellation.ok, true);
    const approveAfterCancel = await h.consentService.approve(pendingView.proposalId);
    assert.equal(approveAfterCancel.ok, false);
    assert.equal(h.memory.ammo, 0);
  });

  test('one expired proposal: approval at/after expiration fails and never writes', async () => {
    const store = createWispConsentProposalStore();
    let fakeNow = Date.now();
    const h = buildHarness(sessionIdentity);
    // Rebuild the service on this harness's store/controller with a short TTL and controllable clock.
    const shortLivedService = createWispConsentService({
      store,
      quickSlotController: h.controller,
      mintConsentToken: () => ({ tokenId: 'unused', expiresAt: new Date().toISOString() }),
      recordAuditEvent: () => {},
      ttlMs: 500,
      nowMs: () => fakeNow,
    });
    // Drive the controller directly and register the resulting pending-consent with THIS service instance.
    const activation = await h.controller.activate(1);
    assert.equal(activation.executionStatus, 'pending-consent');
    // handlePendingConsent already ran against h.consentService via the controller's onPendingConsent wiring;
    // exercise expiry against an equivalent record created directly for a controllable clock.
    shortLivedService.handlePendingConsent({
      slot: 1,
      lowLevelProposalId: 'expiry-fixture-low-id',
      request: { control: 'set', actionId: ACTION_ID as never, profileId: 'controlled-profile' as never, value: 99 },
      requestedValue: 99,
      boundAction: { actionId: ACTION_ID as never, entryId: ENTRY_ID as never, label: 'Ammo', controlType: 'set', availability: 'available' } as never,
      actionDefinition: controlledGameProfile().actions[0],
      boundProfile: { profileId: 'controlled-profile' as never, gameId: GAME_ID, sessionId: 'session', sessionGeneration: 1 } as never,
      context: { gameId: GAME_ID, sessionId: 'session', sessionGeneration: 1 },
    });
    const [pendingView] = shortLivedService.listPending();
    fakeNow += 5000;
    const result = await shortLivedService.approve(pendingView.proposalId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostic.code, 'WISP_CONSENT_PROPOSAL_EXPIRED');
  });

  test('one duplicate approval attempt: the second approve() on an already-consumed proposal fails and the memory is written exactly once', async () => {
    const h = buildHarness(sessionIdentity);
    await h.controller.activate(1);
    const [pendingView] = h.consentService.listPending();
    const first = await h.consentService.approve(pendingView.proposalId);
    assert.equal(first.ok, true);
    assert.equal(h.memory.ammo, 99);
    h.memory.ammo = 0; // prove a second approval does not write again, not just that it errors
    const second = await h.consentService.approve(pendingView.proposalId);
    assert.equal(second.ok, false);
    assert.equal(h.memory.ammo, 0, 'a rejected duplicate approval must never re-write the controlled memory');
  });

  test('one detach-before-approval case: clearing the session context invalidates the proposal via the real epoch/lifecycle mechanism', async () => {
    const h = buildHarness(sessionIdentity);
    await h.controller.activate(1);
    const [pendingView] = h.consentService.listPending();
    assert.equal(pendingView.status, 'pending');

    h.setContext(null); // detach
    await h.controller.activate(1); // any controller call re-syncs context identity, triggering the reset callback

    assert.equal(h.consentService.get(pendingView.proposalId)?.status, 'invalidated');
    const approveAfterDetach = await h.consentService.approve(pendingView.proposalId);
    assert.equal(approveAfterDetach.ok, false);
  });

  test('one process-replacement case: a changed session identity (new sessionId) invalidates the prior proposal', async () => {
    const h = buildHarness(sessionIdentity);
    await h.controller.activate(1);
    const [pendingView] = h.consentService.listPending();

    h.setContext({ gameId: GAME_ID, sessionId: 'a-different-process-session', sessionGeneration: 1 });
    await h.controller.activate(1);

    assert.equal(h.consentService.get(pendingView.proposalId)?.status, 'invalidated');
  });

  test('one session-generation-change case: an incremented generation on the SAME sessionId still invalidates the prior proposal', async () => {
    const h = buildHarness(sessionIdentity);
    await h.controller.activate(1);
    const [pendingView] = h.consentService.listPending();

    h.setContext({ gameId: GAME_ID, sessionId: `session:${sessionIdentity.pid}`, sessionGeneration: 2 });
    await h.controller.activate(1);

    assert.equal(h.consentService.get(pendingView.proposalId)?.status, 'invalidated');
  });

  test('one wrong-value-tampering attempt: a token minted for one requested value cannot confirm a forged different value', async () => {
    const memory: ControlledMemory = { ammo: 0, otherStat: 42 };
    const { adapter } = createControlledTrainerAdapter(memory, sessionIdentity);
    const proposal = adapter.proposeWrite(GAME_ID, ENTRY_ID as never, 99)!;
    const binding: WriteConsentBinding = {
      operation: 'live_memory_confirm_write',
      sessionKey: 'wisp-controlled-cert',
      proposalId: proposal.proposalId,
      attachedPid: sessionIdentity.pid,
      attachedExecutableName: sessionIdentity.executableName,
      executablePath: sessionIdentity.executablePath,
      processStartTime: sessionIdentity.processStartTime,
      address: `controlled:${ENTRY_ID}`,
      dataType: 'int32',
      currentValue: 0,
      requestedValue: 99,
    };
    const artifact = issueWriteConsent(binding);
    // The token was minted for requestedValue=99, but confirmWrite's binding
    // is always rebuilt from the CANONICAL pending proposal, not from any
    // renderer-suppliable value — simulate a forged attempt directly against
    // the token/binding hash check.
    const tamperedResult = await consumeWriteConsent(artifact.tokenId, { ...binding, requestedValue: 12345 });
    assert.equal(tamperedResult.ok, false, 'a binding hash mismatch (tampered requestedValue) must be rejected');
  });

  test('one wrong-action-substitution attempt: a token minted for one low-level proposalId cannot confirm a different proposalId', async () => {
    const memory: ControlledMemory = { ammo: 0, otherStat: 42 };
    const binding: WriteConsentBinding = {
      operation: 'live_memory_confirm_write',
      sessionKey: 'wisp-controlled-cert',
      proposalId: 'proposal-A',
      attachedPid: sessionIdentity.pid,
      attachedExecutableName: sessionIdentity.executableName,
      executablePath: sessionIdentity.executablePath,
      processStartTime: sessionIdentity.processStartTime,
      address: `controlled:${ENTRY_ID}`,
      dataType: 'int32',
      currentValue: memory.ammo,
      requestedValue: 99,
    };
    const artifact = issueWriteConsent(binding);
    const substituted = consumeWriteConsent(artifact.tokenId, { ...binding, proposalId: 'proposal-B' });
    assert.equal(substituted.ok, false, 'a token minted for proposal-A must not confirm proposal-B');
  });

  test('one replay attempt: a successfully consumed token can never be consumed a second time', async () => {
    const memory: ControlledMemory = { ammo: 0, otherStat: 42 };
    const binding: WriteConsentBinding = {
      operation: 'live_memory_confirm_write',
      sessionKey: 'wisp-controlled-cert',
      proposalId: 'proposal-replay',
      attachedPid: sessionIdentity.pid,
      attachedExecutableName: sessionIdentity.executableName,
      executablePath: sessionIdentity.executablePath,
      processStartTime: sessionIdentity.processStartTime,
      address: `controlled:${ENTRY_ID}`,
      dataType: 'int32',
      currentValue: memory.ammo,
      requestedValue: 99,
    };
    const artifact = issueWriteConsent(binding);
    const first = consumeWriteConsent(artifact.tokenId, binding);
    assert.equal(first.ok, true);
    const replay = consumeWriteConsent(artifact.tokenId, binding);
    assert.equal(replay.ok, false, 'a consumed token must never be usable again');
  });

  test('the real controlled process is confirmed still running, untouched, after the full certification', async () => {
    const observation = await observeProcess('ping.exe');
    assert.ok(observation.identity, 'the controlled process must still be running');
    assert.equal(observation.identity!.pid, sessionIdentity.pid, 'same process, not a restart');
  });
});
