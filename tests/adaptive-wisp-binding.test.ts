import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WISP_PROFILE_SCHEMA_VERSION,
  bindResolvedProfile,
  createWispRuntimeBindingRegistry,
  validateWispBinding,
  type WispGameProfile,
  type WispRuntimeContext,
  type WispTrainerEntryLookup,
  type WispBoundEntryDescriptor,
} from '../src/core/adaptive-wisp/index.ts';

function fixtureLookup(entries: Record<string, WispBoundEntryDescriptor>): WispTrainerEntryLookup {
  return {
    resolveEntry(gameId, entryId) {
      return entries[`${gameId}:${entryId}`] ?? null;
    },
  };
}

function entry(id: string, enabled = true): WispBoundEntryDescriptor {
  return { id, label: id, dataType: 'int32', enabled };
}

function alphaProfile(overrides: Partial<WispGameProfile> = {}): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'alpha-profile',
    gameId: 'game-alpha',
    source: 'builtin',
    groups: [{ id: 'g1', label: 'Player', order: 0, actionIds: ['a-health', 'a-xp', 'a-fuel'] }],
    actions: [
      { id: 'a-health', entryId: 'health', label: 'Health', groupId: 'g1', controlType: 'freeze' },
      { id: 'a-xp', entryId: 'xp', label: 'XP', groupId: 'g1', controlType: 'set' },
      { id: 'a-fuel', entryId: 'fuel', label: 'Fuel', groupId: 'g1', controlType: 'freeze' },
    ],
    ...overrides,
  };
}

function alphaContext(overrides: Partial<WispRuntimeContext> = {}): WispRuntimeContext {
  return { gameId: 'game-alpha', sessionId: 'alpha-session', sessionGeneration: 10, ...overrides };
}

describe('bindResolvedProfile — happy path', () => {
  test('a valid profile binds with every action available', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health'), 'game-alpha:xp': entry('xp'), 'game-alpha:fuel': entry('fuel') });
    const result = bindResolvedProfile(alphaProfile(), alphaContext(), lookup);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.profile.actions.every((a) => a.availability === 'available'));
      assert.ok(result.profile.actions.every((a) => a.binding !== undefined));
    }
  });

  test('binding preserves profileId/gameId/actionId/entryId', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const result = bindResolvedProfile(alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] }), alphaContext(), lookup);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.profile.profileId, 'alpha-profile');
      assert.equal(result.profile.gameId, 'game-alpha');
      assert.equal(result.profile.actions[0].actionId, 'a-health');
      assert.equal(result.profile.actions[0].entryId, 'health');
      assert.equal(result.profile.actions[0].binding?.gameId, 'game-alpha');
    }
  });

  test('the input resolved profile is never mutated', () => {
    const profile = alphaProfile();
    const before = structuredClone(profile);
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health'), 'game-alpha:xp': entry('xp'), 'game-alpha:fuel': entry('fuel') });
    bindResolvedProfile(profile, alphaContext(), lookup);
    assert.deepEqual(profile, before);
  });

  test('a generic game-only profile (no trainerId/tableId) binds regardless of active trainer/table context', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const result = bindResolvedProfile(profile, alphaContext({ trainerId: 'trainer-alpha', tableId: 'table-a' }), lookup);
    assert.equal(result.ok, true);
  });
});

describe('bindResolvedProfile — per-action degradation (Section 22, 24, 44)', () => {
  test('a missing entry marks only that action unavailable; the rest of the profile still binds', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health'), 'game-alpha:fuel': entry('fuel') });
    const result = bindResolvedProfile(alphaProfile(), alphaContext(), lookup);
    assert.equal(result.ok, true);
    if (result.ok) {
      const byId = Object.fromEntries(result.profile.actions.map((a) => [a.actionId, a]));
      assert.equal(byId['a-health'].availability, 'available');
      assert.equal(byId['a-xp'].availability, 'missing-entry');
      assert.equal(byId['a-fuel'].availability, 'available');
    }
  });

  test('a disabled trainer entry marks the action unavailable as disabled', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health', false) });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const result = bindResolvedProfile(profile, alphaContext(), lookup);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.profile.actions[0].availability, 'disabled');
  });

  test('an action hidden via profile-level enabled:false binds as disabled without an entry lookup', () => {
    const lookup = fixtureLookup({});
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze', enabled: false }], groups: [] });
    const result = bindResolvedProfile(profile, alphaContext(), lookup);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.profile.actions[0].availability, 'disabled');
  });
});

describe('bindResolvedProfile — profile-level trust-boundary rejection (Section 23)', () => {
  test('a game mismatch rejects the whole profile — no per-action binding attempted', () => {
    const lookup = fixtureLookup({ 'game-beta:health': entry('health') });
    const result = bindResolvedProfile(alphaProfile(), alphaContext({ gameId: 'game-beta' }), lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, 'WISP_BINDING_GAME_MISMATCH');
  });

  test('a trainer mismatch rejects the whole profile', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ trainerId: 'trainer-alpha' });
    const result = bindResolvedProfile(profile, alphaContext({ trainerId: 'trainer-other' }), lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, 'WISP_BINDING_TRAINER_MISMATCH');
  });

  test('a table mismatch rejects the whole profile', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ tableId: 'table-a' });
    const result = bindResolvedProfile(profile, alphaContext({ tableId: 'table-b' }), lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, 'WISP_BINDING_TABLE_MISMATCH');
  });

  test('a detached context (null) rejects the whole profile as session-missing', () => {
    const lookup = fixtureLookup({});
    const result = bindResolvedProfile(alphaProfile(), null, lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, 'WISP_BINDING_SESSION_MISSING');
  });
});

describe('validateWispBinding (Section 18-20)', () => {
  test('a binding matching the current context is valid', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const bound = bindResolvedProfile(profile, alphaContext(), lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    const binding = bound.profile.actions[0].binding!;
    const result = validateWispBinding(binding, alphaContext());
    assert.equal(result.valid, true);
  });

  test('a stale session generation invalidates the binding', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const bound = bindResolvedProfile(profile, alphaContext({ sessionGeneration: 10 }), lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    const binding = bound.profile.actions[0].binding!;
    const result = validateWispBinding(binding, alphaContext({ sessionId: 'alpha-session-2', sessionGeneration: 11 }));
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, 'WISP_BINDING_SESSION_STALE');
  });

  test('a detached (null) current context invalidates the binding', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const bound = bindResolvedProfile(profile, alphaContext(), lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    const result = validateWispBinding(bound.profile.actions[0].binding!, null);
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, 'WISP_BINDING_SESSION_MISSING');
  });
});

describe('WispRuntimeBindingRegistry', () => {
  test('replaceProfileBindings then get round-trips a binding', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const bound = bindResolvedProfile(profile, alphaContext(), lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;

    const registry = createWispRuntimeBindingRegistry();
    registry.replaceProfileBindings('alpha-session', bound.profile);
    const binding = registry.get('alpha-session', 'a-health');
    assert.ok(binding);
    assert.equal(binding?.entryId, 'health');
  });

  test('get returns a clone — mutating the result never affects stored state', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const bound = bindResolvedProfile(profile, alphaContext(), lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;

    const registry = createWispRuntimeBindingRegistry();
    registry.replaceProfileBindings('alpha-session', bound.profile);
    const first = registry.get('alpha-session', 'a-health');
    // @ts-expect-error intentional mutation of a copy to prove isolation
    first.entryId = 'tampered';
    const second = registry.get('alpha-session', 'a-health');
    assert.equal(second?.entryId, 'health');
  });

  test('clearSession removes all bindings for that session only', () => {
    const lookup = fixtureLookup({ 'game-alpha:health': entry('health') });
    const profile = alphaProfile({ actions: [{ id: 'a-health', entryId: 'health', label: 'Health', controlType: 'freeze' }], groups: [] });
    const bound = bindResolvedProfile(profile, alphaContext(), lookup);
    assert.equal(bound.ok, true);
    if (!bound.ok) return;

    const registry = createWispRuntimeBindingRegistry();
    registry.replaceProfileBindings('alpha-session', bound.profile);
    registry.replaceProfileBindings('other-session', bound.profile);
    registry.clearSession('alpha-session');
    assert.equal(registry.get('alpha-session', 'a-health'), null);
    assert.ok(registry.get('other-session', 'a-health'));
  });
});
