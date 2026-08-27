import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createWispProfileRegistry, WISP_PROFILE_SCHEMA_VERSION, type WispGameProfile } from '../src/core/adaptive-wisp/index.ts';
import { populateWispProfileRegistry } from '../src/core/adaptive-wisp/registry-population.ts';

/**
 * Adaptive Wisp Increment 6 — profile-registry population (Sections
 * "Registry population requirements"/"Increment 6 tests").
 */

function validProfile(overrides: Partial<WispGameProfile> = {}): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'p-1',
    gameId: 'game-alpha',
    source: 'builtin',
    groups: [],
    actions: [],
    ...overrides,
  };
}

describe('Increment 6 — populateWispProfileRegistry', () => {
  test('an empty candidate list registers nothing and rejects nothing', () => {
    const registry = createWispProfileRegistry();
    const result = populateWispProfileRegistry(registry, []);
    assert.deepEqual(result, { registered: [], rejected: [] });
    assert.deepEqual(registry.list(), []);
  });

  test('a valid profile registers successfully', () => {
    const registry = createWispProfileRegistry();
    const result = populateWispProfileRegistry(registry, [validProfile()]);
    assert.deepEqual(result.registered, ['p-1']);
    assert.deepEqual(result.rejected, []);
    assert.equal(registry.list().length, 1);
  });

  test('an invalid profile is rejected, not silently skipped or crashed on', () => {
    const registry = createWispProfileRegistry();
    const result = populateWispProfileRegistry(registry, [{ not: 'a profile' }]);
    assert.deepEqual(result.registered, []);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].index, 0);
    assert.ok(result.rejected[0].issues.length > 0);
  });

  test('duplicate profile identity in the candidate list: the first registers, the second is deterministically rejected — not silently selected/merged', () => {
    const registry = createWispProfileRegistry();
    const result = populateWispProfileRegistry(registry, [validProfile({ profileId: 'dup' }), validProfile({ profileId: 'dup', gameId: 'game-beta' })]);
    assert.deepEqual(result.registered, ['dup']);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].index, 1);
    // The registry must retain the FIRST registration's own data, not the second's — proves no silent merge/overwrite.
    assert.equal(registry.get('dup')?.gameId, 'game-alpha');
  });

  test('a mix of valid and invalid candidates: valid ones register independently of invalid ones elsewhere in the list', () => {
    const registry = createWispProfileRegistry();
    const result = populateWispProfileRegistry(registry, [validProfile({ profileId: 'a' }), { garbage: true }, validProfile({ profileId: 'b' })]);
    assert.deepEqual(result.registered, ['a', 'b']);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].index, 1);
  });

  test('resolver failure elsewhere (empty registry) still resolves nothing for any game — fails closed, not crashes', () => {
    const registry = createWispProfileRegistry();
    populateWispProfileRegistry(registry, []);
    assert.deepEqual(registry.listForGame('game-alpha'), []);
  });
});
