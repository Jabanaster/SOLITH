import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWispProfileRegistry, WISP_PROFILE_SCHEMA_VERSION, type WispProfileRegistry, type WispGameProfile } from '../src/core/adaptive-wisp/index.ts';

function profile(overrides: Partial<WispGameProfile> = {}): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'p1',
    gameId: 'game-alpha',
    source: 'builtin',
    groups: [],
    actions: [],
    ...overrides,
  };
}

describe('adaptive-wisp registry', () => {
  let registry: WispProfileRegistry;
  beforeEach(() => {
    registry = createWispProfileRegistry();
  });

  test('registering a valid profile succeeds and it is retrievable by ID', () => {
    const result = registry.register(profile());
    assert.equal(result.ok, true);
    assert.ok(registry.get('p1'));
  });

  test('registering an invalid profile is rejected and never appears in the registry', () => {
    const result = registry.register({ schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'bad', gameId: 'g', source: 'builtin', groups: [], actions: [{ id: 'a', label: 'A', controlType: 'toggle' }] });
    assert.equal(result.ok, false);
    assert.equal(registry.get('bad'), undefined);
    assert.equal(registry.list().length, 0);
  });

  test('list() returns all registered profiles', () => {
    registry.register(profile({ profileId: 'p1' }));
    registry.register(profile({ profileId: 'p2', gameId: 'game-beta' }));
    assert.equal(registry.list().length, 2);
  });

  test('listForGame() isolates profiles by game — different games never leak into each other', () => {
    registry.register(profile({ profileId: 'alpha-1', gameId: 'game-alpha' }));
    registry.register(profile({ profileId: 'beta-1', gameId: 'game-beta' }));
    const alphaProfiles = registry.listForGame('game-alpha');
    assert.equal(alphaProfiles.length, 1);
    assert.equal(alphaProfiles[0].profileId, 'alpha-1');
  });

  test('listForContext() narrows by trainer/table identity in addition to gameId', () => {
    registry.register(profile({ profileId: 'p1', gameId: 'game-alpha', trainerId: 't1', tableId: 'tbl1' }));
    registry.register(profile({ profileId: 'p2', gameId: 'game-alpha', trainerId: 't2', tableId: 'tbl2' }));
    const matches = registry.listForContext({ gameId: 'game-alpha', trainerId: 't1' });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].profileId, 'p1');
  });

  test('unregister() removes a profile and returns true; a second call returns false', () => {
    registry.register(profile());
    assert.equal(registry.unregister('p1'), true);
    assert.equal(registry.get('p1'), undefined);
    assert.equal(registry.unregister('p1'), false);
  });

  test('duplicate profileId registration is rejected with WISP_PROFILE_ALREADY_REGISTERED, original untouched', () => {
    registry.register(profile({ actions: [] }));
    const second = registry.register(profile({ source: 'user' }));
    assert.equal(second.ok, false);
    if (!second.ok) assert.ok(second.issues.some((i) => i.code === 'WISP_PROFILE_ALREADY_REGISTERED'));
    assert.equal(registry.get('p1')?.source, 'builtin');
  });

  test('multiple profiles for the same game (different sources) coexist without precedence being applied here', () => {
    registry.register(profile({ profileId: 'builtin-1', gameId: 'game-alpha', source: 'builtin' }));
    registry.register(profile({ profileId: 'user-1', gameId: 'game-alpha', source: 'user' }));
    const forGame = registry.listForGame('game-alpha');
    assert.equal(forGame.length, 2);
    assert.deepEqual(new Set(forGame.map((p) => p.source)), new Set(['builtin', 'user']));
  });

  test('provenance is preserved through registration', () => {
    registry.register(profile({ source: 'community', provenance: { source: 'community', authorDisplayName: 'ExampleCreator' } }));
    assert.equal(registry.get('p1')?.provenance?.authorDisplayName, 'ExampleCreator');
  });

  test('external mutation of a returned profile does not corrupt registry state', () => {
    registry.register(profile({ actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'toggle' }], groups: [] }));
    const external = registry.get('p1')!;
    external.actions[0].label = 'TAMPERED';
    external.actions.push({ id: 'injected', entryId: 'e2', label: 'Injected', controlType: 'toggle' });
    assert.equal(registry.get('p1')!.actions[0].label, 'A');
    assert.equal(registry.get('p1')!.actions.length, 1);
  });

  test('clear() empties the registry (test-safe reset)', () => {
    registry.register(profile());
    registry.clear();
    assert.equal(registry.list().length, 0);
  });

  test('Game Alpha and Game Beta profiles stay fully isolated end to end', () => {
    registry.register(
      profile({
        profileId: 'alpha',
        gameId: 'game-alpha',
        groups: [{ id: 'player', label: 'Player', order: 0, actionIds: ['health'] }],
        actions: [{ id: 'health', entryId: 'e-health', label: 'Health', shortLabel: 'HP', groupId: 'player', controlType: 'freeze' }],
      }),
    );
    registry.register(
      profile({
        profileId: 'beta',
        gameId: 'game-beta',
        groups: [{ id: 'resources', label: 'Resources', order: 0, actionIds: ['minerals'] }],
        actions: [{ id: 'minerals', entryId: 'e-minerals', label: 'Minerals', groupId: 'resources', controlType: 'set' }],
      }),
    );
    assert.deepEqual(registry.listForGame('game-alpha').map((p) => p.actions[0].shortLabel), ['HP']);
    assert.deepEqual(registry.listForGame('game-beta').map((p) => p.actions[0].label), ['Minerals']);
  });
});
