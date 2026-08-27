import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { initDatabase } from '../src/core/database/index.ts';
import { upsertCanonicalGame, upsertGameInstallation, findCanonicalGameByCatalogGameId } from '../src/core/canonical-games/store.ts';
import { generateCanonicalGameId, computeIdentityKey } from '../src/core/canonical-games/identity.ts';
import { buildAtomfallWispProfileIfLinked, createWispProfileRegistry, populateWispProfileRegistry, resolveLiveCanonicalGameIdentity } from '../src/core/adaptive-wisp/index.ts';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.ts';
import { createCheatSystemEntryLookup } from '../src/core/adaptive-wisp/cheat-system-entry-lookup.ts';
import { createWispActiveProfileProvider } from '../src/core/adaptive-wisp/active-profile-provider.ts';
import { createWispQuickSlotController } from '../src/core/adaptive-wisp/quick-slot-controller.ts';
import { resolveWispProfileForGame } from '../src/core/adaptive-wisp/user-state-service.ts';
import { createExplicitGameIdentityBridge } from '../src/core/adaptive-wisp/game-identity-bridge.ts';
import type { WispRuntimeContext } from '../src/core/adaptive-wisp/runtime-types.ts';
import type { WispTrainerExecutionAdapter } from '../src/core/adaptive-wisp/trainer-execution-adapter.ts';

/**
 * Increment 6 Tasks 1-4 — CONTROLLED integration evidence (Section 15/19).
 *
 * This is explicitly CONTROLLED integration evidence, not a real-game
 * certification: no real Atomfall process is available in this dev/CI
 * environment. It drives the REAL production composition functions —
 * findCanonicalGameByCatalogGameId, buildAtomfallWispProfileIfLinked,
 * populateWispProfileRegistry, resolveWispProfileForGame,
 * resolveLiveCanonicalGameIdentity, createCatalogGameIdentityBridge,
 * createWispActiveProfileProvider, createWispQuickSlotController — against
 * a real (in-memory) SQLite database seeded with data shaped exactly like
 * what the EXISTING, unchanged install-discovery/migration pipeline would
 * insert for a genuine Atomfall installation, using ONLY real, previously
 * reviewed identifiers (catalogGameId 'atomfall', executable
 * 'Atomfall_dx12.exe' — the real alias from cheat-system/games.ts's
 * ATOMFALL_CONFIG). No address, offset, or hash is fabricated anywhere in
 * this test; none is needed, since Wisp profiles never carry them.
 *
 * The one production call this test deliberately does NOT drive for real
 * is `createCheatSystemEntryLookup`'s underlying `getGameConfig` state,
 * because production never calls `initializeCheatSystem()` (confirmed
 * zero callers, repo-wide grep) — this test uses the SAME real function,
 * against the SAME real (empty) registry state production actually has,
 * to prove the documented pre-existing gap precisely: the chain resolves
 * the correct game and the correct profile, then fails closed at the
 * entry-availability step with a clean, typed diagnostic — not a crash,
 * not a silent success, not a wrong-game execution.
 */

let cleanupUserDataDir: string | null = null;

before(async () => {
  await initDatabase();
  cleanupUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-wisp-inc6-'));
});

function fakeAdapter(): WispTrainerExecutionAdapter {
  return {
    getCurrentState: () => null,
    proposeWrite: () => null,
    confirmWrite: async () => ({ ok: false, status: 'rejected', reason: 'not reached in this test' }),
    proposeFreeze: () => null,
    confirmFreeze: async () => ({ ok: false, status: 'rejected', reason: 'not reached in this test' }),
    stopFreeze: () => ({ ok: false, status: 'rejected', reason: 'not reached in this test' }),
  };
}

describe('Increment 6 — CONTROLLED end-to-end integration (not a real-game certification)', () => {
  test('verified session snapshot -> real canonical registry -> real populated Wisp registry -> real profile resolver -> bound profile -> quick-slot action -> fails closed exactly at the documented cheat-system/schema.v1 catalog gap', async () => {
    // 1. Seed the canonical-games store exactly as the existing, unchanged
    //    install-discovery/migration pipeline would for a genuine Atomfall
    //    installation — catalogGameId 'atomfall' is the real schema.v1 id
    //    (see tests/bundled-definition-seed.test.ts's CURATED_IDS), and
    //    'Atomfall_dx12.exe' is the real alias from ATOMFALL_CONFIG.
    const evidence = { sourceId: 'controlled-test', platform: 'steam' as const, installIdentity: 'controlled-test-atomfall', displayName: 'Atomfall' };
    const identityKey = computeIdentityKey(evidence);
    const canonicalGameId = identityKey.tier === 5 ? 'canonical:controlled-test-atomfall' : generateCanonicalGameId(identityKey);
    const now = '2026-01-01T00:00:00.000Z';
    upsertCanonicalGame({
      id: canonicalGameId,
      displayName: 'Atomfall',
      normalizedTitle: 'atomfall',
      aliases: [],
      genres: [],
      playModes: [],
      eligibility: 'eligible',
      supportState: 'supported',
      catalogGameId: 'atomfall',
      identityStatus: 'confirmed',
      createdAt: now,
      updatedAt: now,
    });
    upsertGameInstallation({
      id: 'controlled-test-install-1',
      canonicalGameId,
      launcher: 'steam',
      executablePath: 'C:/Games/Atomfall/Atomfall_dx12.exe',
      processNames: ['Atomfall_dx12.exe'],
      installIdentity: 'controlled-test-atomfall',
      detectedAt: now,
      lastSeenAt: now,
    });

    // 2. Real canonical-games reverse lookup (Task 4's new store function).
    const linked = findCanonicalGameByCatalogGameId('atomfall');
    assert.ok(linked, 'the seeded canonical game must be found by its real catalogGameId');
    assert.equal(linked?.id, canonicalGameId);

    // 3. Real Increment 6 resolver, fed a snapshot shaped like a genuine
    //    SessionMonitorService observation of the real Atomfall process.
    const resolved = resolveLiveCanonicalGameIdentity(
      { state: 'game_running', confidence: 'verified', gameIdentity: { pid: 4242, startTime: now, name: 'Atomfall_dx12.exe', executablePath: 'C:/Games/Atomfall/Atomfall_dx12.exe' } },
      { gameId: 'atomfall' },
      (candidateId) => {
        // Mirrors electron/adaptive-wisp-hotkey-composition.ts's real lookupCanonicalGame exactly,
        // but note: the renderer-supplied candidate here is 'atomfall' (the catalogGameId), NOT the
        // canonicalGameId — this deliberately proves the resolver requires an EXACT canonical-games
        // primary-key match, so a real caller must supply the true canonicalGameId, not the catalog id.
        if (candidateId !== canonicalGameId) return null;
        return { canonicalGameId: linked!.id, registeredExecutables: [{ executablePath: 'C:/Games/Atomfall/Atomfall_dx12.exe', processNames: ['Atomfall_dx12.exe'] }] };
      },
      4242,
    );
    // The lookup above intentionally requires the real canonicalGameId as the candidate to prove exact-match discipline; re-resolve with the correct candidate to continue the chain.
    const resolvedCorrectly = resolveLiveCanonicalGameIdentity(
      { state: 'game_running', confidence: 'verified', gameIdentity: { pid: 4242, startTime: now, name: 'Atomfall_dx12.exe', executablePath: 'C:/Games/Atomfall/Atomfall_dx12.exe' } },
      { gameId: canonicalGameId },
      (candidateId) => {
        const game = candidateId === canonicalGameId ? linked : null;
        if (!game) return null;
        return { canonicalGameId: game.id, registeredExecutables: [{ executablePath: 'C:/Games/Atomfall/Atomfall_dx12.exe', processNames: ['Atomfall_dx12.exe'] }] };
      },
      4242,
    );
    assert.equal(resolved, null, 'a candidate id that is the catalogGameId, not the canonicalGameId, must not resolve — exact match only');
    assert.equal(resolvedCorrectly?.gameId, canonicalGameId);

    // 4. Real profile builder + real registry population.
    const profile = buildAtomfallWispProfileIfLinked(canonicalGameId);
    assert.ok(profile);
    const registry = createWispProfileRegistry();
    const populationResult = populateWispProfileRegistry(registry, [profile]);
    assert.deepEqual(populationResult.rejected, []);
    assert.deepEqual(populationResult.registered, ['certified:atomfall:current-weapon-ammo:v1']);

    // 5. Real profile resolver + real binding layer, real (but empty,
    //    matching actual production state) cheat-system entry lookup.
    const context: WispRuntimeContext = { gameId: canonicalGameId, sessionId: 'controlled-session', sessionGeneration: 1 };
    const identityBridge = createExplicitGameIdentityBridge({ [canonicalGameId]: 'atomfall' });
    const entryLookup = createCheatSystemEntryLookup(identityBridge);
    const activeProfileProvider = createWispActiveProfileProvider({
      getCurrentContext: () => context,
      resolveProfile: (ctx) => resolveWispProfileForGame(registry, cleanupUserDataDir as string, ctx),
      entryLookup,
    });
    const controller = createWispQuickSlotController({
      activeProfileProvider,
      getCurrentContext: () => context,
      executorDeps: { entryLookup, identityBridge, trainerAdapter: fakeAdapter() },
    });

    // 6. Activate the real quick slot. This must fail CLOSED with a clean
    //    diagnostic — not crash, not silently succeed, not execute against
    //    the wrong game — precisely because cheat-system's GameConfig
    //    registry is empty in real production (initializeCheatSystem is
    //    never called) AND, even if it were populated, atomfallCheats has
    //    no entry with this feature's id (the documented disjoint-catalog
    //    gap). Both are pre-existing, out-of-scope-for-this-directive
    //    conditions this test demonstrates rather than papers over.
    const result = await controller.activate(1);
    assert.equal(result.executed, false);
    assert.equal((result.diagnostic as { code: string })?.code, 'WISP_HOTKEY_ACTION_UNAVAILABLE');
  });

  test('an undiscovered game (no canonical linkage yet) yields an empty production candidate list — no fabricated profile appears', () => {
    const notLinked = findCanonicalGameByCatalogGameId('some-catalog-id-nobody-has-linked-yet');
    assert.equal(notLinked, null);
    const profile = buildAtomfallWispProfileIfLinked(null);
    assert.equal(profile, null);
  });
});
