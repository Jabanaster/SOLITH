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
import { executeWispAction } from '../src/core/adaptive-wisp/wisp-action-executor.js';
import type { WispTrainerEntryLookup } from '../src/core/adaptive-wisp/entry-lookup.js';
import type { WispActionDefinition } from '../src/core/adaptive-wisp/types.js';
import type { WispRuntimeBinding, WispRuntimeContext } from '../src/core/adaptive-wisp/runtime-types.js';
import type { WispActionExecutionRequest } from '../src/core/adaptive-wisp/execution-types.js';

/**
 * REVIEW-ONLY — Independent Increment 4 Security Review (target SHA de41aa9).
 *
 * Not part of the implementation. Added on review branch
 * review/adaptive-wisp-increment4-security to close evidence gaps the
 * implementation report itself flagged as not independently simulated:
 * same-session reattach, PID reuse, full Wisp-routed freeze composition,
 * proposal/action swap, and consent expiry through the Wisp route.
 *
 * Uses the same authorized FakeMemoryDriver fixture convention as the
 * existing suite (tests/adaptive-wisp-live-adapter.test.ts) — no commercial
 * game, no test-only privileged bypass, no product code modified.
 */

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
  upsertDefinitionPayload(nextId('pack'), catalogGameId, JSON.stringify(definition), 'verified', 'bundled', new Date().toISOString());
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

function writeBindingFor(bundle: LiveMemoryWispSessionBundle, proposalId: string, pending: { target: { address: bigint; dataType: string }; currentValue: number; requestedValue: number }) {
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

function freezeBindingFor(bundle: LiveMemoryWispSessionBundle, proposalId: string, pending: { target: { address: bigint; dataType: string }; value: number; intervalMs: number }) {
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

async function attachBundle(driver: FakeMemoryDriver, session: LiveMemorySession, pid: number, executableName: string, startTime: string): Promise<LiveMemoryWispSessionBundle> {
  driver.setProcessExecutableName(pid, executableName);
  driver.setProcessExecutablePath(pid, `C:\\Games\\${executableName}`);
  driver.setProcessStartTime(pid, startTime);
  session._injectRemoteConnectionObserver(async () => ({ availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() }));
  const attach = await session.attach({ pid, executableName, executablePath: `C:\\Games\\${executableName}`, startTime }, true);
  assert.equal(attach.success, true, `attach failed: ${JSON.stringify(attach)}`);
  const audit = new MemoryAuditLog();
  const manager = new MemoryManager(session, audit);
  return { manager, session };
}

function entryLookupFor(gameId: string, entryId: string): WispTrainerEntryLookup {
  return { resolveEntry: (g, e) => (g === gameId && e === entryId ? { id: e, label: e, dataType: 'int32', enabled: true } : null) };
}

function binding(gameId: string, entryId: string, sessionGeneration = 1): WispRuntimeBinding {
  return { actionId: 'a-hp', entryId, gameId, sessionId: 'session-1', sessionGeneration, availability: 'available', boundAt: '2026-01-01T00:00:00.000Z' };
}

function context(gameId: string, sessionGeneration = 1): WispRuntimeContext {
  return { gameId, sessionId: 'session-1', sessionGeneration };
}

function actionDefinition(entryId: string): WispActionDefinition {
  return { id: 'a-hp', entryId, label: 'HP', controlType: 'set' };
}

describe('REVIEW — Increment 4 security: reattach with stale proposal/consent (Sections 6, 46)', () => {
  test('write: old proposal from Session A is unknown after detach/reattach (Session B) — zero mutation', async () => {
    const executableName = 'review-reattach-write.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x2010n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);

    const driver = new FakeMemoryDriver();
    driver.addModule(executableName, 0x1000n, 0x9999);
    driver.setValue(address, 100);
    const session = new LiveMemorySession(driver);

    // Session A: pid 1234, attach, propose, obtain consent — do NOT confirm.
    const bundleA = await attachBundle(driver, session, 1234, executableName, '2026-07-01T00:00:00.000Z');
    const identityBridge = createCatalogGameIdentityBridge();
    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundleA, identityBridge);
    const proposalA = adapter.proposeWrite(canonicalGameId, entryId, 200)!;
    assert.ok(proposalA, 'expected a real proposal from Session A');
    const pendingA = session.getPendingWriteProposal(proposalA.proposalId)!;
    const consentA = issueWriteConsent(writeBindingFor(bundleA, proposalA.proposalId, { target: pendingA.target, currentValue: pendingA.currentValue, requestedValue: pendingA.requestedValue }));

    // Detach Session A (explicit — the only path proposals are actually keyed under today).
    session.detach();

    // Reattach same canonical game, different process identity => Session B.
    const bundleB = await attachBundle(driver, session, 5678, executableName, '2026-08-01T00:00:00.000Z');
    const adapterB = createLiveMemoryWispTrainerExecutionAdapter(() => bundleB, identityBridge);

    const outcome = await adapterB.confirmWrite(proposalA.proposalId, consentA.tokenId);
    assert.equal(outcome.ok, false, 'Session A proposal must not become valid again under Session B');
    assert.equal(outcome.reason, 'unknown_or_consumed_proposal');
    assert.equal(driver.readMemory({ pid: 5678, opaque: null }, address, 'int32'), 100, 'zero mutation in Session B from Session A authorization');
  });

  test('freeze: old proposal from Session A cannot start a freeze in Session B — zero freeze', async () => {
    const executableName = 'review-reattach-freeze.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x2020n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);

    const driver = new FakeMemoryDriver();
    driver.addModule(executableName, 0x1000n, 0x9999);
    driver.setValue(address, 100);
    const session = new LiveMemorySession(driver);

    const bundleA = await attachBundle(driver, session, 1111, executableName, '2026-07-01T00:00:00.000Z');
    const identityBridge = createCatalogGameIdentityBridge();
    const adapterA = createLiveMemoryWispTrainerExecutionAdapter(() => bundleA, identityBridge);
    const proposalA = adapterA.proposeFreeze(canonicalGameId, entryId, 999, 50)!;
    assert.ok(proposalA);
    const pendingFreezeA = session.getPendingFreezeProposal(proposalA.proposalId)!;
    const consentA = issueWriteConsent(freezeBindingFor(bundleA, proposalA.proposalId, { target: pendingFreezeA.target, value: pendingFreezeA.value, intervalMs: pendingFreezeA.intervalMs }));

    session.detach();
    const bundleB = await attachBundle(driver, session, 2222, executableName, '2026-08-01T00:00:00.000Z');
    const adapterB = createLiveMemoryWispTrainerExecutionAdapter(() => bundleB, identityBridge);

    const outcome = await adapterB.confirmFreeze(proposalA.proposalId, consentA.tokenId);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'unknown_or_consumed_proposal');
    assert.equal(session.getFreezeStatus().active, false, 'no freeze must be active in Session B from Session A authorization');
  });
});

describe('REVIEW — Increment 4 security: PID reuse without an intervening explicit detach (Section 7, 41)', () => {
  test('a differently-identified process that later reuses the same PID cannot confirm the original proposal', async () => {
    // Simulates the case the implementation report explicitly left untested:
    // no detach() call happens between "session A" and "session B" (e.g. a
    // crash the polling layer has not yet observed) — same LiveMemorySession
    // object, same this.target the whole time. Real defense here is
    // verifyAttachedProcessIdentity() re-querying live process identity by
    // PID and comparing against the ORIGINAL attach-time snapshot
    // (executablePath/startTime/volumeSerial/fileIndex), not the Wisp-layer
    // generation tracker. FakeMemoryDriver's fake handles skip the live
    // Windows re-query, but the same compare path is real: mutate the
    // driver's returned identity out from under the still-attached handle
    // to model "PID X now belongs to a different, later process."
    const executableName = 'review-pid-reuse.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x2030n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);

    const driver = new FakeMemoryDriver();
    driver.addModule(executableName, 0x1000n, 0x9999);
    driver.setValue(address, 100);
    const session = new LiveMemorySession(driver);
    const pid = 4321;
    const bundle = await attachBundle(driver, session, pid, executableName, '2026-07-01T00:00:00.000Z');

    const identityBridge = createCatalogGameIdentityBridge();
    const adapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, identityBridge);
    const proposal = adapter.proposeWrite(canonicalGameId, entryId, 200)!;
    assert.ok(proposal);
    const pending = session.getPendingWriteProposal(proposal.proposalId)!;
    const consent = issueWriteConsent(writeBindingFor(bundle, proposal.proposalId, { target: pending.target, currentValue: pending.currentValue, requestedValue: pending.requestedValue }));

    // Same PID now reports a different creation time — a later, distinct
    // process reusing the OS-assigned PID, WITHOUT any detach() ever running.
    driver.setProcessStartTime(pid, '2026-09-01T00:00:00.000Z');

    const outcome = await adapter.confirmWrite(proposal.proposalId, consent.tokenId);
    assert.equal(outcome.ok, false, 'PID reuse must not be treated as the same authorized process');
    assert.equal(driver.readMemory({ pid, opaque: null }, address, 'int32'), 100, 'zero mutation against the replacement process');
  });
});

describe('REVIEW — Increment 4 security: full Wisp-routed freeze composition (Section 31, priority)', () => {
  test('freeze-enable -> pending consent -> confirm through executeWispAction -> active -> stop through executeWispAction -> inactive', async () => {
    const executableName = 'review-full-freeze.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x2040n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);

    const driver = new FakeMemoryDriver();
    driver.addModule(executableName, 0x1000n, 0x9999);
    driver.setValue(address, 100);
    const session = new LiveMemorySession(driver);
    const bundle = await attachBundle(driver, session, 9001, executableName, '2026-07-01T00:00:00.000Z');

    const identityBridge = createCatalogGameIdentityBridge();
    const trainerAdapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, identityBridge);
    const deps = { entryLookup: entryLookupFor(canonicalGameId, entryId), identityBridge, trainerAdapter };

    // 1. Freeze-enable, no consentToken -> pending-consent, proposalId returned.
    const enableRequest: WispActionExecutionRequest = { control: 'freeze', actionId: 'a-hp', profileId: 'p1', enable: true, presetId: undefined, intervalMs: 100 };
    const pendingResult = await executeWispAction(enableRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    assert.equal(pendingResult.status, 'pending-consent');
    const proposalId = pendingResult.proposalId;
    assert.ok(proposalId, 'expected a real proposalId from the freeze propose step');

    // 2. Canonical consent issued for the exact proposal.
    const pendingFreeze = session.getPendingFreezeProposal(proposalId!)!;
    const consent = issueWriteConsent(freezeBindingFor(bundle, proposalId!, { target: pendingFreeze.target, value: pendingFreeze.value, intervalMs: pendingFreeze.intervalMs }));

    // 3. Confirm through executeWispAction (awaited), echoing the exact proposalId.
    const confirmRequest: WispActionExecutionRequest = { control: 'freeze', actionId: 'a-hp', profileId: 'p1', enable: true, consentToken: consent.tokenId, proposalId: proposalId! };
    const confirmResult = await executeWispAction(confirmRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    assert.equal(confirmResult.ok, true, `expected the freeze to confirm through the full Wisp route, got: ${JSON.stringify(confirmResult)}`);
    assert.equal(confirmResult.status, 'frozen');

    // 5-7. Canonical freeze status active, target matches expected action/value.
    const status = session.getFreezeStatus();
    assert.equal(status.active, true, 'canonical freeze must be active after the full Wisp route confirms');
    assert.equal(status.target?.address.address, address);
    assert.equal(status.target?.value, pendingFreeze.value);

    // 8-9. Stop through the Wisp execution route; canonical freeze goes inactive.
    const stopRequest: WispActionExecutionRequest = { control: 'freeze', actionId: 'a-hp', profileId: 'p1', enable: false };
    const stopResult = await executeWispAction(stopRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    assert.equal(stopResult.ok, true);
    assert.equal(stopResult.status, 'unfrozen');
    assert.equal(session.getFreezeStatus().active, false, 'freeze must be inactive after the Wisp-routed stop');
  });
});

describe('REVIEW — Increment 4 security: proposal/action swap (Section 10)', () => {
  test('a valid token for proposal A cannot be redeemed against a differently-proposed value under the same entry', async () => {
    const executableName = 'review-proposal-swap.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x2050n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);

    const driver = new FakeMemoryDriver();
    driver.addModule(executableName, 0x1000n, 0x9999);
    driver.setValue(address, 100);
    const session = new LiveMemorySession(driver);
    const bundle = await attachBundle(driver, session, 9101, executableName, '2026-07-01T00:00:00.000Z');

    const identityBridge = createCatalogGameIdentityBridge();
    const trainerAdapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, identityBridge);
    const deps = { entryLookup: entryLookupFor(canonicalGameId, entryId), identityBridge, trainerAdapter };

    // Proposal A: set to 200.
    const requestA: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 200 };
    const resultA = await executeWispAction(requestA, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    const proposalIdA = resultA.proposalId!;
    const pendingA = session.getPendingWriteProposal(proposalIdA)!;
    const consentA = issueWriteConsent(writeBindingFor(bundle, proposalIdA, { target: pendingA.target, currentValue: pendingA.currentValue, requestedValue: pendingA.requestedValue }));

    // Proposal B: a second, independent proposal for a DIFFERENT requested value on the same entry.
    const requestB: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 999 };
    const resultB = await executeWispAction(requestB, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    const proposalIdB = resultB.proposalId!;
    assert.notEqual(proposalIdA, proposalIdB, 'each execution stages an independently-identified proposal');

    // Attempt to confirm proposal B using the token issued for proposal A.
    const swapRequest: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 999, consentToken: consentA.tokenId, proposalId: proposalIdB };
    const swapResult = await executeWispAction(swapRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);

    assert.equal(swapResult.ok, false, 'a token issued for proposal A must not authorize proposal B');
    assert.equal(driver.readMemory({ pid: 9101, opaque: null }, address, 'int32'), 100, 'zero mutation from the swapped authorization');
  });
});

describe('REVIEW — Increment 4 security: consent expiry through the full Wisp route (Section 13)', () => {
  test('an already-expired consent token cannot confirm a Wisp write — zero mutation', async () => {
    const executableName = 'review-expiry.exe';
    const catalogGameId = nextId('catalog');
    const entryId = 'hp';
    const address = 0x2060n;
    seedDefinition(catalogGameId, executableName, entryId, address);
    const canonicalGameId = seedCanonicalGame(catalogGameId);

    const driver = new FakeMemoryDriver();
    driver.addModule(executableName, 0x1000n, 0x9999);
    driver.setValue(address, 100);
    const session = new LiveMemorySession(driver);
    const bundle = await attachBundle(driver, session, 9201, executableName, '2026-07-01T00:00:00.000Z');

    const identityBridge = createCatalogGameIdentityBridge();
    const trainerAdapter = createLiveMemoryWispTrainerExecutionAdapter(() => bundle, identityBridge);
    const deps = { entryLookup: entryLookupFor(canonicalGameId, entryId), identityBridge, trainerAdapter };

    const proposeRequest: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 200 };
    const proposeResult = await executeWispAction(proposeRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);
    const proposalId = proposeResult.proposalId!;
    const pending = session.getPendingWriteProposal(proposalId)!;
    // ttlMs option is issueWriteConsent's own documented API — a real,
    // already-expired token, not a bypass of the expiry mechanism.
    const expiredConsent = issueWriteConsent(writeBindingFor(bundle, proposalId, { target: pending.target, currentValue: pending.currentValue, requestedValue: pending.requestedValue }), { ttlMs: -1000 });

    const confirmRequest: WispActionExecutionRequest = { control: 'set', actionId: 'a-hp', profileId: 'p1', value: 200, consentToken: expiredConsent.tokenId, proposalId };
    const confirmResult = await executeWispAction(confirmRequest, actionDefinition(entryId), binding(canonicalGameId, entryId), context(canonicalGameId), deps);

    assert.equal(confirmResult.ok, false, 'an expired consent token must not confirm the write through the full Wisp route');
    assert.equal(driver.readMemory({ pid: 9201, opaque: null }, address, 'int32'), 100);
  });
});
