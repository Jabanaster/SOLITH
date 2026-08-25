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

  test('no active session (detached) fails closed for every operation', () => {
    const identityBridge: WispGameIdentityBridge = { resolveCheatSystemGameId: () => 'irrelevant' };
    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => null, identityBridge);
    assert.equal(adapter.getCurrentState('g', 'e'), null);
    assert.equal(adapter.proposeWrite('g', 'e', 1), null);
    assert.equal(adapter.proposeFreeze('g', 'e', 1), null);
    assert.deepEqual(adapter.confirmWrite('p', 't'), { ok: false, status: 'rejected', reason: 'no_active_session' });
    assert.deepEqual(adapter.confirmFreeze('p', 't'), { ok: false, status: 'rejected', reason: 'no_active_session' });
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
    const outcome = adapter.confirmWrite(proposal.proposalId, 'never-issued-00000000-0000-4000-8000-000000000000');

    assert.equal(outcome.ok, false);
    assert.equal(driver.readMemory({ pid: 1234, opaque: null }, address, 'int32'), 7);
  });

  test('confirmWrite consumes a correctly-issued consent token once, then rejects replay — no real write completes (async boundary honestly reported)', async () => {
    const executableName = 'demo-4b-consent.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'mana';
    const address = 0x1040n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);
    const { bundle, driver } = await makeAttachedBundle(executableName);
    driver.setValue(address, 100);

    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, createCatalogGameIdentityBridge());
    const proposal = adapter.proposeWrite(canonicalGameId, entryId, 500)!;
    const pending = bundle.session.getPendingWriteProposal(proposal.proposalId)!;
    const identity = bundle.session.getAttachedIdentity()!;
    const binding = {
      operation: 'live_memory_confirm_write' as const,
      sessionKey: ADAPTIVE_WISP_CONSENT_SESSION_KEY,
      proposalId: proposal.proposalId,
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
    const consent = issueWriteConsent(binding);

    const firstOutcome = adapter.confirmWrite(proposal.proposalId, consent.tokenId);
    // Consent lifecycle is real and proven here: the token IS consumed. The
    // write itself cannot complete through this synchronous interface (see
    // adaptive-wisp-live-adapter.ts's documented async-boundary finding), so
    // this legitimately reports failure rather than a fabricated success.
    assert.equal(firstOutcome.ok, false);
    assert.equal(firstOutcome.status, 'failed');

    const replayOutcome = adapter.confirmWrite(proposal.proposalId, consent.tokenId);
    assert.equal(replayOutcome.ok, false);
    assert.equal(replayOutcome.status, 'rejected');
  });

  test('confirmFreeze: correctly-issued consent is consumed once; replay is rejected', async () => {
    const executableName = 'demo-4b-freeze.exe';
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
    const identity = bundle.session.getAttachedIdentity()!;
    const binding = {
      operation: 'live_memory_freeze_start' as const,
      sessionKey: ADAPTIVE_WISP_CONSENT_SESSION_KEY,
      proposalId: proposal.proposalId,
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
    const consent = issueWriteConsent(binding);

    const outcome = adapter.confirmFreeze(proposal.proposalId, consent.tokenId);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 'failed');
    assert.equal(bundle.session.getFreezeStatus().active, false, 'no real freeze must have started');

    const replay = adapter.confirmFreeze(proposal.proposalId, consent.tokenId);
    assert.equal(replay.status, 'rejected');
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
