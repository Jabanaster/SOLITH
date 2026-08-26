import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createWispActiveProfileProvider, WISP_PROFILE_SCHEMA_VERSION, type WispGameProfile, type WispRuntimeContext, type WispTrainerEntryLookup, type WispBoundEntryDescriptor } from '../src/core/adaptive-wisp/index.ts';

function fixtureLookup(entries: Record<string, WispBoundEntryDescriptor>): WispTrainerEntryLookup {
  return { resolveEntry: (gameId, entryId) => entries[`${gameId}:${entryId}`] ?? null };
}

function entry(id: string, enabled = true): WispBoundEntryDescriptor {
  return { id, label: id, dataType: 'int32', enabled };
}

function alphaProfile(): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'alpha-profile',
    gameId: 'game-alpha',
    source: 'builtin',
    groups: [],
    actions: [{ id: 'a-hp', entryId: 'hp', label: 'HP', controlType: 'freeze', slot: 1 }],
  };
}

describe('createWispActiveProfileProvider — use-time resolution (Sections 7-9)', () => {
  test('returns null when there is no current context (detached)', async () => {
    const provider = createWispActiveProfileProvider({
      getCurrentContext: () => null,
      resolveProfile: async () => ({ ok: true, profile: alphaProfile() }),
      entryLookup: fixtureLookup({ 'game-alpha:hp': entry('hp') }),
    });
    assert.equal(await provider.getActiveBoundProfile(), null);
  });

  test('returns null when resolution fails', async () => {
    const context: WispRuntimeContext = { gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 };
    const provider = createWispActiveProfileProvider({
      getCurrentContext: () => context,
      resolveProfile: async () => ({ ok: false }),
      entryLookup: fixtureLookup({}),
    });
    assert.equal(await provider.getActiveBoundProfile(), null);
  });

  test('returns null when binding fails closed (e.g. game mismatch between resolution and binding)', async () => {
    const context: WispRuntimeContext = { gameId: 'game-beta', sessionId: 's1', sessionGeneration: 1 };
    const provider = createWispActiveProfileProvider({
      getCurrentContext: () => context,
      // Deliberately resolves a profile for the WRONG game — bindResolvedProfile's own game-mismatch guard must reject this, proving the provider does not paper over an inconsistent resolver.
      resolveProfile: async () => ({ ok: true, profile: alphaProfile() }),
      entryLookup: fixtureLookup({ 'game-alpha:hp': entry('hp') }),
    });
    const result = await provider.getActiveBoundProfile();
    assert.equal(result, null);
  });

  test('resolves fresh on every call — a later call reflects a changed context rather than a cached snapshot', async () => {
    let gameId = 'game-alpha';
    const profiles: Record<string, WispGameProfile> = {
      'game-alpha': alphaProfile(),
      'game-beta': { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'beta-profile', gameId: 'game-beta', source: 'builtin', groups: [], actions: [{ id: 'b-minerals', entryId: 'minerals', label: 'Minerals', controlType: 'set', slot: 1 }] },
    };
    const provider = createWispActiveProfileProvider({
      getCurrentContext: () => ({ gameId, sessionId: 's1', sessionGeneration: 1 }),
      resolveProfile: async (ctx) => ({ ok: true, profile: profiles[ctx.gameId] }),
      entryLookup: fixtureLookup({ 'game-alpha:hp': entry('hp'), 'game-beta:minerals': entry('minerals') }),
    });

    const first = await provider.getActiveBoundProfile();
    assert.equal(first?.rawProfile.profileId, 'alpha-profile');

    gameId = 'game-beta';
    const second = await provider.getActiveBoundProfile();
    assert.equal(second?.rawProfile.profileId, 'beta-profile', 'must reflect the changed context, never the previous call\'s cached profile');
  });

  test('the returned snapshot carries both the raw profile (for presets) and the bound profile (for slot/binding/availability)', async () => {
    const context: WispRuntimeContext = { gameId: 'game-alpha', sessionId: 's1', sessionGeneration: 1 };
    const provider = createWispActiveProfileProvider({
      getCurrentContext: () => context,
      resolveProfile: async () => ({ ok: true, profile: alphaProfile() }),
      entryLookup: fixtureLookup({ 'game-alpha:hp': entry('hp') }),
    });
    const snapshot = await provider.getActiveBoundProfile();
    assert.ok(snapshot);
    assert.equal(snapshot?.rawProfile.actions[0].id, 'a-hp');
    assert.equal(snapshot?.bound.actions[0].actionId, 'a-hp');
    assert.equal(snapshot?.bound.actions[0].availability, 'available');
  });
});
