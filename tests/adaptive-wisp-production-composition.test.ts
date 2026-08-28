import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting, closeDatabaseSafely } from '../src/core/database/index.ts';
import { upsertCanonicalGame, upsertGameInstallation } from '../src/core/canonical-games/store.ts';
import {
  initializeCheatSystemOnce,
  resetCheatSystemInitializationForTests,
} from '../src/core/cheat-system/initialization.ts';
import { createWispProfileRegistry } from '../src/core/adaptive-wisp/registry.ts';
import { populateWispProfileRegistry } from '../src/core/adaptive-wisp/registry-population.ts';
import { buildAtomfallWispProfileIfLinked } from '../src/core/adaptive-wisp/certified-profiles.ts';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.ts';
import { createCheatSystemEntryLookup } from '../src/core/adaptive-wisp/cheat-system-entry-lookup.ts';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.ts';
import { createWispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.ts';
import { resolveWispProfileForGame } from '../src/core/adaptive-wisp/user-state-service.ts';
import type { WispTrainerEntryState, WispTrainerExecutionAdapter } from '../src/core/adaptive-wisp/trainer-execution-adapter.ts';

/**
 * Catalog/production-composition closeout — Requirements 6, 7, 8.
 *
 * Uses a REAL on-disk temporary SQLite database (production schema/
 * migrations via `resetForTesting(tempDbPath)` — the same convention
 * `tests/add-game-integration.test.ts` already established, NOT
 * `:memory:`), the REAL `initializeCheatSystemOnce()` production
 * composition root, the REAL `gameRegistry` singleton (with the reconciled
 * `atomfall-current-weapon-ammo` cheat entry this closeout added), the
 * REAL `WispProfileRegistry`/`populateWispProfileRegistry`, the REAL
 * `buildAtomfallWispProfileIfLinked` certified-profile builder, the REAL
 * `catalog-game-identity-bridge`/`cheat-system-entry-lookup` (both querying
 * the real on-disk DB), and the REAL `WispActiveProfileProvider`/
 * `WispQuickSlotController`.
 *
 * The ONLY test double anywhere in this chain is `WispTrainerExecutionAdapter`
 * — the outermost live-memory I/O boundary, which this directive explicitly
 * forbids exercising for real ("Do not confirm the proposal or mutate
 * memory under this directive"). This is the same, pre-existing test-double
 * convention Increment 4/5's own test suites already use for that exact
 * boundary — not a new substitute introduced to manufacture a pass.
 *
 * The canonical game id used here (`canonical:certification-fixture-*`) is
 * deliberately NOT the real production Atomfall canonical game id — it is
 * isolated certification data, per this directive's explicit instruction
 * not to add permanent fake production game entries. Its `catalogGameId`
 * bridge field is set to the REAL `'atomfall'` catalog id, so this test
 * exercises the actual reconciled Atomfall cheat-entry/memory-feature chain
 * this closeout built, not a fabricated one.
 */

function fakeAdapter(states: Record<string, WispTrainerEntryState>) {
  const calls = { proposeWrite: 0, confirmWrite: 0 };
  const adapter: WispTrainerExecutionAdapter = {
    getCurrentState: (gameId, entryId) => states[`${gameId}:${entryId}`] ?? null,
    proposeWrite: () => {
      calls.proposeWrite++;
      return { proposalId: `write-proposal-${calls.proposeWrite}` };
    },
    confirmWrite: async () => {
      calls.confirmWrite++;
      return { ok: true, status: 'applied' };
    },
    proposeFreeze: () => null,
    confirmFreeze: async () => ({ ok: false, status: 'rejected', reason: 'not used in this test' }),
    stopFreeze: () => ({ ok: false, status: 'rejected', reason: 'not used in this test' }),
  };
  return { adapter, calls };
}

describe('Requirement 6/7/8 — real production composition reaches pending-consent', () => {
  let tempDir: string;
  let tempDbPath: string;
  const CERT_CANONICAL_ID = 'canonical:certification-fixture-atomfall';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-wisp-production-composition-'));
    tempDbPath = path.join(tempDir, 'test-wisp-composition.sqlite');
    await resetForTesting(tempDbPath);
    resetCheatSystemInitializationForTests();

    upsertCanonicalGame({
      id: CERT_CANONICAL_ID,
      displayName: 'Certification Fixture (Atomfall reconciliation)',
      normalizedTitle: 'certification fixture atomfall reconciliation',
      aliases: [],
      genres: [],
      playModes: [],
      eligibility: 'verified',
      supportState: 'supported',
      catalogGameId: 'atomfall',
      identityStatus: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    upsertGameInstallation({
      id: 'install:certification-fixture-atomfall',
      canonicalGameId: CERT_CANONICAL_ID,
      launcher: 'steam',
      installPath: path.join(tempDir, 'fake-install'),
      executablePath: path.join(tempDir, 'fake-install', 'atomfall_dx12.exe'),
      processNames: ['atomfall_dx12.exe'],
      installIdentity: 'certification-fixture-atomfall',
      detectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('Requirement 4 — real cheat-system initialization registers the real Atomfall config with the reconciled cheat entry', () => {
    const result = initializeCheatSystemOnce();
    assert.equal(result.state, 'ready');
    assert.ok(result.registeredGameIds.includes('atomfall'));
  });

  test('Requirement 6/7/8 — full real composition: certified profile registers, action becomes available, activation reaches pending-consent', async () => {
    initializeCheatSystemOnce();

    const registry = createWispProfileRegistry();
    const population = populateWispProfileRegistry(registry, [buildAtomfallWispProfileIfLinked(CERT_CANONICAL_ID)]);
    assert.deepEqual(population.registered, ['certified:atomfall:current-weapon-ammo:v1'], 'Requirement 6: the certified profile must enter the REAL production registry instance');
    assert.equal(registry.listForGame(CERT_CANONICAL_ID).length, 1);

    const identityBridge = createCatalogGameIdentityBridge();
    assert.equal(identityBridge.resolveCheatSystemGameId(CERT_CANONICAL_ID), 'atomfall', 'the real on-disk canonical_games row must bridge to the real cheat-system gameId');

    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const { adapter, calls } = fakeAdapter({ 'canonical:certification-fixture-atomfall:atomfall-current-weapon-ammo': { frozen: false, currentValue: 99, dataType: 'int32', supportsControls: ['set'] } });

    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId: CERT_CANONICAL_ID, sessionId: 'cert-session', sessionGeneration: 1 }),
      resolveProfile: (context) => resolveWispProfileForGame(registry, tempDir, context),
      entryLookup,
    });

    const controller = createWispQuickSlotController({
      activeProfileProvider,
      getCurrentContext: () => ({ gameId: CERT_CANONICAL_ID, sessionId: 'cert-session', sessionGeneration: 1 }),
      executorDeps: { entryLookup, identityBridge, trainerAdapter: adapter },
    });

    const snapshot = await activeProfileProvider.getActiveBoundProfile();
    assert.ok(snapshot, 'the real profile resolver must resolve the certified profile for this canonical game');
    const boundAction = snapshot?.bound.actions.find((a) => a.actionId === 'atomfall-current-weapon-ammo');
    assert.equal(boundAction?.availability, 'available', 'Requirement 7: the certified action must resolve to availability "available" through the real cheat-system entry lookup — no fallback, no mock lookup, no test-only override');

    const result = await controller.activate(1);
    assert.equal(result.actionId, 'atomfall-current-weapon-ammo');
    assert.equal(result.executionStatus, 'pending-consent', 'Requirement 8: the real composition must reach pending-consent');
    assert.equal(calls.proposeWrite, 1, 'exactly one proposal');
    assert.equal(calls.confirmWrite, 0, 'no mutation — this directive forbids confirming the proposal');

    const repeat = await controller.activate(1);
    assert.equal(repeat.diagnostic && (repeat.diagnostic as { code: string }).code, 'WISP_HOTKEY_EXECUTION_PENDING_CONSENT', 'repeat activation while pending must be suppressed, not create a second proposal');
    assert.equal(calls.proposeWrite, 1);
  });

  test('Requirement 7 negative — missing cheat-system initialization: action is unavailable (registry never lazily self-populates)', async () => {
    resetCheatSystemInitializationForTests();
    const registry = createWispProfileRegistry();
    populateWispProfileRegistry(registry, [buildAtomfallWispProfileIfLinked(CERT_CANONICAL_ID)]);
    const identityBridge = createCatalogGameIdentityBridge();
    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId: CERT_CANONICAL_ID, sessionId: 'cert-session', sessionGeneration: 1 }),
      resolveProfile: (context) => resolveWispProfileForGame(registry, tempDir, context),
      entryLookup,
    });
    const snapshot = await activeProfileProvider.getActiveBoundProfile();
    const boundAction = snapshot?.bound.actions.find((a) => a.actionId === 'atomfall-current-weapon-ammo');
    assert.notEqual(boundAction?.availability, 'available', 'without cheat-system initialization, the real gameRegistry has nothing to look up — must not report available');
    initializeCheatSystemOnce(); // restore for subsequent tests
  });

  test('Requirement 7 negative — wrong canonical game (unlinked/unresolved) yields no profile at all', async () => {
    initializeCheatSystemOnce();
    const registry = createWispProfileRegistry();
    populateWispProfileRegistry(registry, [buildAtomfallWispProfileIfLinked(CERT_CANONICAL_ID)]);
    const identityBridge = createCatalogGameIdentityBridge();
    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId: 'canonical:totally-unrelated-game', sessionId: 's', sessionGeneration: 1 }),
      resolveProfile: (context) => resolveWispProfileForGame(registry, tempDir, context),
      entryLookup,
    });
    const snapshot = await activeProfileProvider.getActiveBoundProfile();
    assert.equal(snapshot, null, 'an unlinked canonical game must resolve no profile at all — no fallback to the first registered profile');
  });

  test('Requirement 7 negative — missing cheat entry (unreconciled game): unavailable', async () => {
    initializeCheatSystemOnce();
    // The registry has real games with NO Wisp profile pointing at them here
    // — resolving a profile for a canonical game whose catalogGameId maps to
    // a real cheat-system game but for an entryId that was never reconciled
    // must not silently succeed.
    const identityBridge = createCatalogGameIdentityBridge();
    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const descriptor = entryLookup.resolveEntry('atomfall', 'entirely-unreconciled-entry-id');
    assert.equal(descriptor, null, 'an entryId with no matching real cheat-system entry must resolve to null, not a fallback/first match');
  });
});
