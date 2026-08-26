import { describe, test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.js';
import { upsertCanonicalGame } from '../src/core/canonical-games/store.js';
import { upsertDefinitionPayload } from '../src/core/trainer-catalog/store.js';
import type { CanonicalGame } from '../src/core/canonical-games/types.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';
import { MemoryAuditLog } from '../src/core/live-memory/audit-log.js';
import { MemoryManager } from '../src/core/live-memory/memory-manager.js';
import { LiveMemorySession, MAX_FREEZE_DURATION_MS } from '../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from './fixtures/fake-memory-driver.js';
import { issueWriteConsent } from '../src/core/consent/write-consent.js';
import { _clearActiveFreezesForTests } from '../src/core/live-memory/freeze-concurrency-registry.js';
import {
  createLiveMemoryWispTrainerExecutionAdapter,
  ADAPTIVE_WISP_CONSENT_SESSION_KEY,
  type LiveMemoryWispSessionBundle,
} from '../src/core/live-memory/adaptive-wisp-live-adapter.js';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.js';
import type { WispGameIdentityBridge } from '../src/core/adaptive-wisp/game-identity-bridge.js';
import { executeWispAction } from '../src/core/adaptive-wisp/wisp-action-executor.js';
import type { WispTrainerEntryLookup } from '../src/core/adaptive-wisp/entry-lookup.js';
import type { WispActionDefinition } from '../src/core/adaptive-wisp/types.js';
import type { WispRuntimeBinding, WispRuntimeContext } from '../src/core/adaptive-wisp/runtime-types.js';
import type { WispActionExecutionRequest } from '../src/core/adaptive-wisp/execution-types.js';

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now()}-${uid}`;
}

before(async () => {
  await initDatabase();
});

beforeEach(() => {
  _clearActiveFreezesForTests();
});

function seedDefinition(catalogGameId: string, executableName: string, entryId: string, address: bigint): void {
  const definition: SolithDefinitionV1 = {
    schemaVersion: 1,
    id: catalogGameId,
    title: catalogGameId,
    gameVersion: '1.0.0',
    executableHashPrefixes: [],
    author: 'test',
    safety: { requiresApproval: false, requiresOfflineConfirm: true, verificationStatus: 'verified' },
    target: { executables: [executableName], arch: 'x64' },
    memoryFeatures: [
      {
        id: entryId,
        name: entryId,
        category: 'stat',
        type: 'write_once',
        dataType: 'int32',
        defaultValue: 0,
        resolution: { moduleName: executableName, baseOffset: `0x${(address - 0x1000n).toString(16)}` },
      },
    ],
  };
  upsertDefinitionPayload(
    nextId('pack'),
    catalogGameId,
    JSON.stringify(definition),
    'verified',
    'bundled',
    new Date().toISOString(),
  );
}

function seedCanonicalGame(catalogGameId: string): string {
  const id = nextId('canon');
  const now = new Date(0).toISOString();
  const game: CanonicalGame = {
    id,
    displayName: id,
    normalizedTitle: id.toLowerCase(),
    aliases: [],
    genres: [],
    playModes: [],
    eligibility: 'eligible',
    supportState: 'supported',
    catalogGameId,
    identityStatus: 'verified',
    createdAt: now,
    updatedAt: now,
  };
  upsertCanonicalGame(game);
  return id;
}

function writeBindingFor(
  bundle: LiveMemoryWispSessionBundle,
  proposalId: string,
  pending: { target: { address: bigint; dataType: string }; currentValue: number; requestedValue: number },
) {
  const identity = bundle.session.getAttachedIdentity()!;
  return {
    operation: 'live_memory_confirm_write' as const,
    sessionKey: ADAPTIVE_WISP_CONSENT_SESSION_KEY,
    proposalId,
    attachedPid: identity.pid,
    attachedExecutableName: identity.executableName,
    executablePath: identity.executablePath,
    processStartTime: identity.startTime,
    volumeSerialNumber: identity.volumeSerialNumber,
    fileIndex: identity.fileIndex,
    attachedExeSha256: identity.exeSha256,
    address: pending.target.address.toString(),
    dataType: pending.target.dataType,
    currentValue: pending.currentValue,
    requestedValue: pending.requestedValue,
  };
}

function freezeBindingFor(
  bundle: LiveMemoryWispSessionBundle,
  proposalId: string,
  pending: { target: { address: bigint; dataType: string }; value: number; intervalMs: number },
) {
  const identity = bundle.session.getAttachedIdentity()!;
  return {
    operation: 'live_memory_freeze_start' as const,
    sessionKey: ADAPTIVE_WISP_CONSENT_SESSION_KEY,
    proposalId,
    attachedPid: identity.pid,
    attachedExecutableName: identity.executableName,
    executablePath: identity.executablePath,
    processStartTime: identity.startTime,
    volumeSerialNumber: identity.volumeSerialNumber,
    fileIndex: identity.fileIndex,
    attachedExeSha256: identity.exeSha256,
    address: pending.target.address.toString(),
    dataType: pending.target.dataType,
    freezeValue: pending.value,
    freezeIntervalMs: pending.intervalMs,
    freezeMaxDurationMs: MAX_FREEZE_DURATION_MS,
  };
}

async function makeAttachedBundle(executableName: string): Promise<{ bundle: LiveMemoryWispSessionBundle; driver: FakeMemoryDriver }> {
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(1234, executableName);
  driver.setProcessExecutablePath(1234, `C:\\Games\\${executableName}`);
  driver.setProcessStartTime(1234, '2026-07-01T00:00:00.000Z');
  driver.addModule(executableName, 0x1000n, 0x9999);
  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => ({
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: new Date().toISOString(),
  }));
  const attach = await session.attach(
    { pid: 1234, executableName, executablePath: `C:\\Games\\${executableName}`, startTime: '2026-07-01T00:00:00.000Z' },
    true,
  );
  assert.equal(attach.success, true);
  const audit = new MemoryAuditLog();
  const manager = new MemoryManager(session, audit);
  return { bundle: { manager, session }, driver };
}

describe('Adaptive Wisp Increment 4B — real production execution adapter', () => {
  test('getCurrentState resolves a real address through the catalog identity bridge and returns the live value', async () => {
    const executableName = 'demo-4b.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'health';
    const address = 0x1010n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);

    const { bundle, driver } = await makeAttachedBundle(executableName);
    driver.setValue(address, 42);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const state = adapter.getCurrentState(canonicalGameId, entryId);

    assert.ok(state, 'expected a resolved state');
    assert.equal(state!.currentValue, 42);
    assert.equal(state!.dataType, 'int32');
    assert.equal(state!.frozen, false);
  });

  test('canonical game with no authoritative catalog mapping fails closed — no state, no proposal', async () => {
    const executableName = 'demo-4b-unmapped.exe';
    const { bundle } = await makeAttachedBundle(executableName);
    const bareId = nextId('canon-bare');
    upsertCanonicalGame({
      id: bareId,
      displayName: bareId,
      normalizedTitle: bareId.toLowerCase(),
      aliases: [],
      genres: [],
      playModes: [],
      eligibility: 'eligible',
      supportState: 'supported',
      identityStatus: 'verified',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    assert.equal(adapter.getCurrentState(bareId, 'health'), null);
    assert.equal(adapter.proposeWrite(bareId, 'health', 10), null);
  });

  test('no active session (detached) fails closed for every operation', async () => {
    const identityBridge: WispGameIdentityBridge = { resolveCheatSystemGameId: () => 'irrelevant' };
    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => null, identityBridge);
    assert.equal(adapter.getCurrentState('g', 'e'), null);
    assert.equal(adapter.proposeWrite('g', 'e', 1), null);
    assert.equal(adapter.proposeFreeze('g', 'e', 1), null);
    assert.deepEqual(await adapter.confirmWrite('p', 't'), { ok: false, status: 'rejected', reason: 'no_active_session' });
    assert.deepEqual(await adapter.confirmFreeze('p', 't'), { ok: false, status: 'rejected', reason: 'no_active_session' });
    assert.deepEqual(adapter.stopFreeze('g', 'e'), { ok: false, status: 'rejected', reason: 'no_active_session' });
  });

  test('proposeWrite stages a real MemoryManager proposal but performs no write (no pre-consent write)', async () => {
    const executableName = 'demo-4b-propose.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'ammo';
    const address = 0x1020n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle, driver } = await makeAttachedBundle(executableName);
    driver.setValue(address, 5);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const proposal = adapter.proposeWrite(canonicalGameId, entryId, 999);

    assert.ok(proposal, 'expected a staged proposal');
    assert.equal(driver.readMemory({ pid: 1234, opaque: null }, address, 'int32'), 5, 'value must be unchanged before confirm');
  });

  test('confirmWrite rejects a wrong/random consent token — zero mutation', async () => {
    const executableName = 'demo-4b-wrong-token.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'gold';
    const address = 0x1030n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle, driver } = await makeAttachedBundle(executableName);
    driver.setValue(address, 7);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const proposal = adapter.proposeWrite(canonicalGameId, entryId, 12345)!;
    const outcome = await adapter.confirmWrite(proposal.proposalId, 'never-issued-00000000-0000-4000-8000-000000000000');

    assert.equal(outcome.ok, false);
    assert.equal(driver.readMemory({ pid: 1234, opaque: null }, address, 'int32'), 7);
  });

  test('REAL Wisp-routed confirmed write: 100 -> 200 through async confirm, then restored to 100 (Final Acceptance)', async () => {
    const executableName = 'demo-4c-real-write.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x1040n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle, driver } = await makeAttachedBundle(executableName);
    driver.setValue(address, 100);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const handle = { pid: 1234, opaque: null };

    // set 100 -> 200
    const proposal = adapter.proposeWrite(canonicalGameId, entryId, 200)!;
    assert.ok(proposal, 'expected a staged proposal');
    assert.equal(driver.readMemory(handle, address, 'int32'), 100, 'no mutation before confirm');

    const pending = bundle.session.getPendingWriteProposal(proposal.proposalId)!;
    const consent = issueWriteConsent(writeBindingFor(bundle, proposal.proposalId, pending));
    const outcome = await adapter.confirmWrite(proposal.proposalId, consent.tokenId);

    assert.equal(outcome.ok, true, `expected a real confirmed write, got: ${JSON.stringify(outcome)}`);
    assert.equal(outcome.status, 'applied');
    assert.equal(outcome.currentValue, 200);
    assert.equal(driver.readMemory(handle, address, 'int32'), 200, 'canonical write must actually apply');

    // replay of the same (now-consumed) token must fail
    const replay = await adapter.confirmWrite(proposal.proposalId, consent.tokenId);
    assert.equal(replay.ok, false);
    assert.equal(driver.readMemory(handle, address, 'int32'), 200, 'replay must not mutate further');

    // restore 200 -> 100 through the same authorized route
    const restoreProposal = adapter.proposeWrite(canonicalGameId, entryId, 100)!;
    const restorePending = bundle.session.getPendingWriteProposal(restoreProposal.proposalId)!;
    const restoreConsent = issueWriteConsent(writeBindingFor(bundle, restoreProposal.proposalId, restorePending));
    const restoreOutcome = await adapter.confirmWrite(restoreProposal.proposalId, restoreConsent.tokenId);

    assert.equal(restoreOutcome.ok, true);
    assert.equal(driver.readMemory(handle, address, 'int32'), 100, 'fixture must be restored to its original value');
  });

  test('confirmWrite negative controls: wrong consent and no-confirm both leave the fixture unchanged', async () => {
    const executableName = 'demo-4c-negatives.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'mana';
    const address = 0x1050n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle, driver } = await makeAttachedBundle(executableName);
    driver.setValue(address, 100);
    const handle = { pid: 1234, opaque: null };

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());

    // proposal only, never confirmed
    const proposalOnly = adapter.proposeWrite(canonicalGameId, entryId, 500)!;
    assert.ok(proposalOnly);
    assert.equal(driver.readMemory(handle, address, 'int32'), 100, 'proposal alone must not mutate');

    // wrong consent
    const wrongOutcome = await adapter.confirmWrite(proposalOnly.proposalId, 'wrong-token-00000000-0000-4000-8000-000000000000');
    assert.equal(wrongOutcome.ok, false);
    assert.equal(driver.readMemory(handle, address, 'int32'), 100, 'wrong consent must not mutate');
  });

  test('REAL Wisp-routed confirmed freeze: proposal -> consent -> awaited confirm -> canonical freeze active -> stop -> inactive', async () => {
    const executableName = 'demo-4c-real-freeze.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'stamina';
    const address = 0x1050n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle } = await makeAttachedBundle(executableName);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const proposal = adapter.proposeFreeze(canonicalGameId, entryId, 77, 100)!;
    assert.ok(proposal);
    const pending = bundle.session.getPendingFreezeProposal(proposal.proposalId)!;
    const consent = issueWriteConsent(freezeBindingFor(bundle, proposal.proposalId, pending));

    const outcome = await adapter.confirmFreeze(proposal.proposalId, consent.tokenId);
    assert.equal(outcome.ok, true, `expected a real confirmed freeze start, got: ${JSON.stringify(outcome)}`);
    assert.equal(bundle.session.getFreezeStatus().active, true, 'canonical freeze must actually be active');

    // Freeze is owned by the canonical session, not Wisp — a value change
    // from elsewhere is the target this same freeze is expected to police
    // once its tick runs; assert the freeze target address/value match what
    // Wisp proposed (proves no second, Wisp-owned freeze target exists).
    const status = bundle.session.getFreezeStatus();
    assert.equal(status.target?.address.address, address);
    assert.equal(status.target?.value, 77);

    const replay = await adapter.confirmFreeze(proposal.proposalId, consent.tokenId);
    assert.equal(replay.ok, false, 'a consumed freeze-start consent must not restart/replay');

    const stopOutcome = adapter.stopFreeze(canonicalGameId, entryId);
    assert.equal(stopOutcome.ok, true);
    assert.equal(bundle.session.getFreezeStatus().active, false, 'stop must actually deactivate the canonical freeze');
  });

  test('confirmFreeze rejects a wrong consent token — no freeze starts', async () => {
    const executableName = 'demo-4c-freeze-wrong-token.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'shield-charge';
    const address = 0x1055n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle } = await makeAttachedBundle(executableName);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const proposal = adapter.proposeFreeze(canonicalGameId, entryId, 5, 100)!;
    const outcome = await adapter.confirmFreeze(proposal.proposalId, 'wrong-token-00000000-0000-4000-8000-000000000000');

    assert.equal(outcome.ok, false);
    assert.equal(bundle.session.getFreezeStatus().active, false);
  });

  test('stopFreeze delegates directly to the canonical session — no second freeze loop', async () => {
    const executableName = 'demo-4b-stop.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'shield';
    const address = 0x1060n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle } = await makeAttachedBundle(executableName);

    // Start a real canonical freeze directly through the session (simulating
    // one started via the existing renderer flow) to prove Wisp's stopFreeze
    // reaches the SAME canonical freeze, not a Wisp-owned one.
    const address_: import('../src/core/live-memory/types.js').LiveMemoryAddress = { address, dataType: 'int32' };
    const freezeProposal = bundle.session.proposeFreeze(address_, 1, 100);
    const started = bundle.session.startFreezeConfirmed(freezeProposal.proposalId);
    assert.equal(started.success, true);
    assert.equal(bundle.session.getFreezeStatus().active, true);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const outcome = adapter.stopFreeze(canonicalGameId, entryId);

    assert.equal(outcome.ok, true);
    assert.equal(bundle.session.getFreezeStatus().active, false);
  });
});

describe('Adaptive Wisp Increment 4C — production composition boundary (executeWispAction + real adapter)', () => {
  function entryLookupFor(gameId: string, entryId: string): WispTrainerEntryLookup {
    return {
      resolveEntry: (g, e) => (g === gameId && e === entryId ? { id: e, label: e, dataType: 'int32', enabled: true } : null),
    };
  }

  function binding(gameId: string, entryId: string, sessionGeneration = 1): WispRuntimeBinding {
    return {
      actionId: 'a-hp',
      entryId,
      gameId,
      sessionId: 'session-1',
      sessionGeneration,
      availability: 'available',
      boundAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function context(gameId: string, sessionGeneration = 1): WispRuntimeContext {
    return { gameId, sessionId: 'session-1', sessionGeneration };
  }

  function actionDefinition(entryId: string): WispActionDefinition {
    return { id: 'a-hp', entryId, label: 'HP', controlType: 'set' };
  }

  test('a real confirmed mutation travels end-to-end through executeWispAction + the real production adapter (Final Acceptance)', async () => {
    const executableName = 'demo-4c-composition.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x1070n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle, driver } = await makeAttachedBundle(executableName);
    const handle = { pid: 1234, opaque: null };
    driver.setValue(address, 100);

    const identityBridge = createCatalogGameIdentityBridge();
    const trainerAdapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, identityBridge);
    const deps = { entryLookup: entryLookupFor(canonicalGameId, entryId), identityBridge, trainerAdapter };

    // Step 1: propose (no consentToken yet) -> pending-consent, zero mutation
    const proposeRequest: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 200 };
    const proposeResult = await executeWispAction(proposeRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    assert.equal(proposeResult.status, 'pending-consent');
    assert.equal(driver.readMemory(handle, address, 'int32'), 100);

    const proposalId = proposeResult.proposalId;
    assert.ok(proposalId, 'expected the pending-consent result to carry the proposal id');
    const pending = bundle.session.getPendingWriteProposal(proposalId!)!;
    const consent = issueWriteConsent(writeBindingFor(bundle, proposalId!, pending));

    // Step 2: confirm through the SAME composition boundary — the real,
    // awaited canonical write must complete. Echoes back the exact
    // proposalId from step 1 (Increment 4C) so the consent token issued for
    // THAT proposal is the one actually consumed, instead of a fresh proposal
    // the executor would otherwise create on this second call.
    const confirmRequest: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 200, consentToken: consent.tokenId, proposalId: proposalId! };
    const confirmResult = await executeWispAction(confirmRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);

    assert.equal(confirmResult.ok, true, `expected a real end-to-end confirmed write, got: ${JSON.stringify(confirmResult)}`);
    assert.equal(driver.readMemory(handle, address, 'int32'), 200, 'the mutation must be reached via the Adaptive Wisp executor + production adapter, not a raw write API');

    // restore
    const restoreRequest: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 100 };
    const restoreProposeResult = await executeWispAction(restoreRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    const restoreProposalId = restoreProposeResult.proposalId!;
    const restorePending = bundle.session.getPendingWriteProposal(restoreProposalId)!;
    const restoreConsent = issueWriteConsent(writeBindingFor(bundle, restoreProposalId, restorePending));
    const restoreConfirm: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 100, consentToken: restoreConsent.tokenId, proposalId: restoreProposalId };
    const restoreResult = await executeWispAction(restoreConfirm, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);

    assert.equal(restoreResult.ok, true);
    assert.equal(driver.readMemory(handle, address, 'int32'), 100, 'fixture must be restored');
  });

  test('old session generation confirmation is rejected before reaching the adapter — zero mutation', async () => {
    const executableName = 'demo-4c-stale-gen.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x1080n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle, driver } = await makeAttachedBundle(executableName);
    const handle = { pid: 1234, opaque: null };
    driver.setValue(address, 100);

    const identityBridge = createCatalogGameIdentityBridge();
    const trainerAdapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, identityBridge);
    const deps = { entryLookup: entryLookupFor(canonicalGameId, entryId), identityBridge, trainerAdapter };

    const staleBinding = binding(canonicalGameId, entryId, 10);
    const currentContext = context(canonicalGameId, 11); // session moved on
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 200, consentToken: 'irrelevant-tok' };
    const result = await executeWispAction(request, actionDefinition(entryId), staleBinding, currentContext, deps);

    assert.equal(result.status, 'stale');
    assert.equal(driver.readMemory(handle, address, 'int32'), 100, 'zero mutation for a stale-generation confirmation');
  });

  test('unmapped canonical game is rejected before reaching the adapter — zero mutation', async () => {
    const executableName = 'demo-4c-unmapped.exe';
    const { bundle, driver } = await makeAttachedBundle(executableName);
    const handle = { pid: 1234, opaque: null };
    const address = 0x1090n;
    driver.setValue(address, 100);

    const unmappedGameId = nextId('canon-unmapped');
    upsertCanonicalGame({
      id: unmappedGameId,
      displayName: unmappedGameId,
      normalizedTitle: unmappedGameId.toLowerCase(),
      aliases: [],
      genres: [],
      playModes: [],
      eligibility: 'eligible',
      supportState: 'supported',
      identityStatus: 'verified',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });

    const identityBridge = createCatalogGameIdentityBridge();
    const trainerAdapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, identityBridge);
    const deps = { entryLookup: entryLookupFor(unmappedGameId, 'hp'), identityBridge, trainerAdapter };
    const request: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 200, consentToken: 'irrelevant-tok' };
    const result = await executeWispAction(request, actionDefinition('hp'), binding(unmappedGameId, 'hp'), context(unmappedGameId), deps);

    assert.equal(result.diagnostic?.code, 'WISP_EXECUTION_IDENTITY_MAPPING_MISSING');
    assert.equal(driver.readMemory(handle, address, 'int32'), 100);
  });
});
