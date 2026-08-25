import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWispProfile, WISP_PROFILE_SCHEMA_VERSION, WISP_USER_STATE_SCHEMA_VERSION, type WispGameProfile } from '../src/core/adaptive-wisp/index.ts';
import type { WispUserOverride } from '../src/core/adaptive-wisp/user-state-schema.ts';

// Increment 2 Section 43 fixtures.
function creatorAlpha(): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'alpha-creator',
    gameId: 'game-alpha',
    source: 'creator',
    groups: [{ id: 'player', label: 'Player', order: 0, actionIds: ['hp', 'xp', 'fuel'] }],
    actions: [
      { id: 'hp', entryId: 'e-hp', label: 'Health', shortLabel: 'HP', groupId: 'player', controlType: 'freeze', slot: 1 },
      { id: 'xp', entryId: 'e-xp', label: 'Experience', shortLabel: 'XP', groupId: 'player', controlType: 'increment', slot: 2 },
      { id: 'fuel', entryId: 'e-fuel', label: 'Fuel', groupId: 'player', controlType: 'set', slot: 3 },
    ],
  };
}
function builtinAlpha(): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'alpha-builtin',
    gameId: 'game-alpha',
    source: 'builtin',
    groups: [],
    actions: [{ id: 'hp', entryId: 'e-hp', label: 'Health', groupId: undefined, controlType: 'freeze' }],
  };
}
function generatedAlpha(): WispGameProfile {
  return { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'alpha-generated', gameId: 'game-alpha', source: 'generated', groups: [], actions: [{ id: 'hp', entryId: 'e-hp', label: 'Health', controlType: 'freeze' }] };
}
function communityAlpha(): WispGameProfile {
  return { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'alpha-community', gameId: 'game-alpha', source: 'community', groups: [], actions: [{ id: 'hp', entryId: 'e-hp', label: 'Health', controlType: 'freeze' }] };
}
function userAlpha(): WispGameProfile {
  return { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'alpha-user', gameId: 'game-alpha', source: 'user', groups: [], actions: [{ id: 'hp', entryId: 'e-hp', label: 'Health', controlType: 'freeze' }] };
}
function creatorBeta(): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'beta-creator',
    gameId: 'game-beta',
    source: 'creator',
    groups: [{ id: 'resources', label: 'Resources', order: 0, actionIds: ['minerals', 'energy', 'drill'] }],
    actions: [
      { id: 'minerals', entryId: 'e-minerals', label: 'Minerals', groupId: 'resources', controlType: 'set' },
      { id: 'energy', entryId: 'e-energy', label: 'Energy', groupId: 'resources', controlType: 'freeze' },
      { id: 'drill', entryId: 'e-drill', label: 'Drill', groupId: 'resources', controlType: 'multiplier' },
    ],
  };
}

const ctx = (overrides = {}) => ({ gameId: 'game-alpha', ...overrides });

describe('adaptive-wisp resolver — precedence', () => {
  test('creator wins over builtin and generated when nothing is selected', () => {
    const result = resolveWispProfile([builtinAlpha(), generatedAlpha(), creatorAlpha()], ctx());
    assert.equal(result.ok, true);
    assert.equal(result.selectedProfileId, 'alpha-creator');
    assert.equal(result.source, 'creator');
  });

  test('builtin wins over generated when no creator profile exists', () => {
    const result = resolveWispProfile([generatedAlpha(), builtinAlpha()], ctx());
    assert.equal(result.selectedProfileId, 'alpha-builtin');
  });

  test('generated wins when it is the only candidate', () => {
    const result = resolveWispProfile([generatedAlpha()], ctx());
    assert.equal(result.selectedProfileId, 'alpha-generated');
  });

  test('no applicable profile → ok:false with WISP_RESOLUTION_NO_PROFILE', () => {
    const result = resolveWispProfile([], ctx());
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_NO_PROFILE'));
  });

  test('an unselected community profile never automatically wins over creator', () => {
    const result = resolveWispProfile([communityAlpha(), creatorAlpha()], ctx());
    assert.equal(result.selectedProfileId, 'alpha-creator');
  });

  test('an unselected community profile never wins even as the only other candidate besides builtin', () => {
    const result = resolveWispProfile([communityAlpha(), builtinAlpha()], ctx());
    assert.equal(result.selectedProfileId, 'alpha-builtin');
  });

  test('explicitly selected community profile wins over creator', () => {
    const result = resolveWispProfile([communityAlpha(), creatorAlpha()], ctx({ selectedProfileId: 'alpha-community' }));
    assert.equal(result.selectedProfileId, 'alpha-community');
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_COMMUNITY_PROFILE_SELECTED'));
  });

  test('explicit user-selected standalone profile wins over creator', () => {
    const result = resolveWispProfile([userAlpha(), creatorAlpha()], ctx({ selectedProfileId: 'alpha-user' }));
    assert.equal(result.selectedProfileId, 'alpha-user');
  });

  test('explicit selection beats normal precedence generally (selecting builtin over an available creator profile)', () => {
    const result = resolveWispProfile([creatorAlpha(), builtinAlpha()], ctx({ selectedProfileId: 'alpha-builtin' }));
    assert.equal(result.selectedProfileId, 'alpha-builtin');
  });

  test('explicit selection referencing a nonexistent profile falls back safely to default precedence', () => {
    const result = resolveWispProfile([creatorAlpha(), builtinAlpha()], ctx({ selectedProfileId: 'does-not-exist' }));
    assert.equal(result.ok, true);
    assert.equal(result.selectedProfileId, 'alpha-creator');
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_SELECTED_PROFILE_NOT_FOUND'));
  });

  test('an inapplicable explicit selection (context mismatch) falls back safely', () => {
    const constrained = { ...creatorAlpha(), profileId: 'alpha-creator-tbl', trainerId: 't1' };
    const result = resolveWispProfile([constrained, builtinAlpha()], ctx({ selectedProfileId: 'alpha-creator-tbl', trainerId: 't2' }));
    assert.equal(result.selectedProfileId, 'alpha-builtin');
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_SELECTED_PROFILE_INAPPLICABLE'));
  });
});

describe('adaptive-wisp resolver — context applicability', () => {
  test('a different gameId is never a candidate', () => {
    const result = resolveWispProfile([creatorBeta()], ctx({ gameId: 'game-alpha' }));
    assert.equal(result.ok, false);
  });

  test('a profile with no trainerId/tableId applies generally to the game', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx({ trainerId: 'any-trainer', tableId: 'any-table' }));
    assert.equal(result.selectedProfileId, 'alpha-creator');
  });

  test('a profile constrained to a trainerId is excluded when context trainerId differs', () => {
    const constrained = { ...creatorAlpha(), trainerId: 't1' };
    const result = resolveWispProfile([constrained], ctx({ trainerId: 't2' }));
    assert.equal(result.ok, false);
  });

  test('a profile constrained to a trainerId matches when context trainerId is equal', () => {
    const constrained = { ...creatorAlpha(), trainerId: 't1' };
    const result = resolveWispProfile([constrained], ctx({ trainerId: 't1' }));
    assert.equal(result.ok, true);
  });

  test('a profile constrained to a tableId is excluded on mismatch, matches on equality', () => {
    const constrained = { ...creatorAlpha(), tableId: 'tbl1' };
    assert.equal(resolveWispProfile([constrained], ctx({ tableId: 'tbl2' })).ok, false);
    assert.equal(resolveWispProfile([constrained], ctx({ tableId: 'tbl1' })).ok, true);
  });

  test('more specific (game+table+trainer) beats less specific (game-only) within the same source', () => {
    const generic = { ...creatorAlpha(), profileId: 'generic' };
    const specific = { ...creatorAlpha(), profileId: 'specific', trainerId: 't1', tableId: 'tbl1' };
    const result = resolveWispProfile([generic, specific], ctx({ trainerId: 't1', tableId: 'tbl1' }));
    assert.equal(result.selectedProfileId, 'specific');
  });

  test('Game Beta candidates never leak into a Game Alpha resolution', () => {
    const result = resolveWispProfile([creatorAlpha(), creatorBeta()], ctx({ gameId: 'game-alpha' }));
    assert.equal(result.profile?.gameId, 'game-alpha');
  });
});

describe('adaptive-wisp resolver — user override overlay', () => {
  const override = (extra: Partial<WispUserOverride>): WispUserOverride => ({ schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', ...extra });

  test('base profile returned by candidates array is never mutated', () => {
    const base = creatorAlpha();
    const snapshot = structuredClone(base);
    resolveWispProfile([base], ctx(), override({ hiddenActions: ['xp'] }));
    assert.deepEqual(base, snapshot);
  });

  test('hiding an action sets enabled:false without removing it', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), override({ hiddenActions: ['xp'] }));
    const xp = result.profile?.actions.find((a) => a.id === 'xp');
    assert.equal(xp?.enabled, false);
    assert.equal(result.userOverrideApplied, true);
  });

  test('reassigning a slot moves the action to the new slot', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), override({ slotAssignments: { fuel: 1, hp: 3 } }));
    assert.equal(result.profile?.actions.find((a) => a.id === 'fuel')?.slot, 1);
    assert.equal(result.profile?.actions.find((a) => a.id === 'hp')?.slot, 3);
  });

  test('clearing a slot with null unsets it', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), override({ slotAssignments: { hp: null } }));
    assert.equal(result.profile?.actions.find((a) => a.id === 'hp')?.slot, undefined);
  });

  test('an out-of-range slot assignment is ignored (partially applied)', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), override({ slotAssignments: { hp: 999 } }));
    assert.equal(result.profile?.actions.find((a) => a.id === 'hp')?.slot, 1);
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_OVERRIDE_PARTIALLY_APPLIED'));
  });

  test('group order reorders known groups first, unknown group ids in override are ignored', () => {
    const twoGroupProfile: WispGameProfile = {
      ...creatorAlpha(),
      groups: [
        { id: 'a', label: 'A', order: 0, actionIds: ['hp'] },
        { id: 'b', label: 'B', order: 1, actionIds: ['xp'] },
      ],
    };
    const result = resolveWispProfile([twoGroupProfile], ctx(), override({ groupOrder: ['b', 'a', 'ghost'] }));
    assert.deepEqual(result.profile?.groups.map((g) => g.id), ['b', 'a']);
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_OVERRIDE_PARTIALLY_APPLIED'));
  });

  test('action order within a group honors known ids first, then appends any remaining member', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), override({ actionOrderByGroup: { player: ['fuel', 'hp'] } }));
    assert.deepEqual(result.profile?.groups.find((g) => g.id === 'player')?.actionIds, ['fuel', 'hp', 'xp']);
  });

  test('moving an action to a different known group updates both groups\' membership', () => {
    const twoGroupProfile: WispGameProfile = {
      ...creatorAlpha(),
      groups: [
        { id: 'player', label: 'Player', order: 0, actionIds: ['hp', 'xp', 'fuel'] },
        { id: 'ship', label: 'Ship', order: 1, actionIds: [] },
      ],
    };
    const result = resolveWispProfile([twoGroupProfile], ctx(), override({ actionGroupOverrides: { fuel: 'ship' } }));
    assert.deepEqual(result.profile?.groups.find((g) => g.id === 'player')?.actionIds, ['hp', 'xp']);
    assert.deepEqual(result.profile?.groups.find((g) => g.id === 'ship')?.actionIds, ['fuel']);
    assert.equal(result.profile?.actions.find((a) => a.id === 'fuel')?.groupId, 'ship');
  });

  test('an override referencing an unknown action id is ignored without failing resolution', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), override({ hiddenActions: ['ghost-action'] }));
    assert.equal(result.ok, true);
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_OVERRIDE_PARTIALLY_APPLIED'));
  });

  test('creator update resilience: newly added action is preserved (appended) and user ordering of known actions survives', () => {
    const v1 = creatorAlpha();
    const withOverride = override({ actionOrderByGroup: { player: ['fuel', 'hp'] }, hiddenActions: ['xp'] });
    const v2: WispGameProfile = {
      ...v1,
      groups: [{ id: 'player', label: 'Player', order: 0, actionIds: ['hp', 'xp', 'fuel', 'carry'] }],
      actions: [...v1.actions, { id: 'carry', entryId: 'e-carry', label: 'Carry Weight', shortLabel: 'Carry', groupId: 'player', controlType: 'set' }],
    };
    const result = resolveWispProfile([v2], ctx(), withOverride);
    assert.deepEqual(result.profile?.groups.find((g) => g.id === 'player')?.actionIds, ['fuel', 'hp', 'xp', 'carry']);
    assert.equal(result.profile?.actions.find((a) => a.id === 'xp')?.enabled, false);
    assert.ok(result.profile?.actions.some((a) => a.id === 'carry'));
  });

  test('removed-action resilience: an override referencing an action the creator removed is tolerated, remaining override still applies', () => {
    const withoutFuel: WispGameProfile = { ...creatorAlpha(), groups: [{ id: 'player', label: 'Player', order: 0, actionIds: ['hp', 'xp'] }], actions: creatorAlpha().actions.filter((a) => a.id !== 'fuel') };
    const result = resolveWispProfile([withoutFuel], ctx(), override({ hiddenActions: ['fuel', 'xp'] }));
    assert.equal(result.ok, true);
    assert.equal(result.profile?.actions.find((a) => a.id === 'xp')?.enabled, false);
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_OVERRIDE_PARTIALLY_APPLIED'));
  });

  test('an override whose baseProfileId does not match the resolved profile is not applied', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), override({ baseProfileId: 'some-other-profile', hiddenActions: ['xp'] }));
    assert.equal(result.userOverrideApplied, false);
    assert.equal(result.profile?.actions.find((a) => a.id === 'xp')?.enabled, undefined);
    assert.ok(result.diagnostics.some((d) => d.code === 'WISP_RESOLUTION_OVERRIDE_INVALID'));
  });

  test('an override for a different gameId is never applied', () => {
    const result = resolveWispProfile([creatorAlpha()], ctx(), { ...override({}), gameId: 'game-beta' });
    assert.equal(result.userOverrideApplied, false);
  });

  test('preferredQuickSlotCount within range is applied; out of range is ignored', () => {
    const ok = resolveWispProfile([creatorAlpha()], ctx(), override({ preferredQuickSlotCount: 4 }));
    assert.equal(ok.profile?.preferredQuickSlotCount, 4);
    const bad = resolveWispProfile([creatorAlpha()], ctx(), override({ preferredQuickSlotCount: 999 }));
    assert.equal(bad.profile?.preferredQuickSlotCount, undefined);
  });
});

describe('adaptive-wisp resolver — security', () => {
  test('Game Alpha resolution context can never resolve a Game Beta profile even with a matching selectedProfileId string collision', () => {
    const betaLookAlike: WispGameProfile = { ...creatorBeta(), profileId: 'alpha-creator' };
    const result = resolveWispProfile([betaLookAlike], ctx({ gameId: 'game-alpha', selectedProfileId: 'alpha-creator' }));
    assert.equal(result.ok, false);
  });

  test('a user override cannot inject a new action id that did not exist in the base profile', () => {
    const result = resolveWispProfile(
      [creatorAlpha()],
      ctx(),
      { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', actionOrderByGroup: { player: ['injected-action', 'hp', 'xp', 'fuel'] } },
    );
    assert.ok(!result.profile?.actions.some((a) => a.id === 'injected-action'));
    assert.equal(result.profile?.actions.length, 3);
  });
});
