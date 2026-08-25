import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWispGameProfile,
  WISP_PROFILE_SCHEMA_VERSION,
  WISP_PROFILE_LIMITS,
  type WispGameProfile,
} from '../src/core/adaptive-wisp/index.ts';

// Generic fixtures per Increment 1 Section 30 — deliberately not real games,
// to prove the domain model is game-independent.
function gameAlphaProfile(overrides: Partial<WispGameProfile> = {}): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'game-alpha-builtin',
    gameId: 'game-alpha',
    source: 'builtin',
    groups: [{ id: 'player', label: 'Player', order: 0, actionIds: ['health', 'xp', 'fuel'] }],
    actions: [
      { id: 'health', entryId: 'entry-health', label: 'Health', shortLabel: 'HP', groupId: 'player', controlType: 'freeze', slot: 1 },
      { id: 'xp', entryId: 'entry-xp', label: 'Experience', shortLabel: 'XP', groupId: 'player', controlType: 'increment', slot: 2 },
      { id: 'fuel', entryId: 'entry-fuel', label: 'Fuel', groupId: 'player', controlType: 'set', slot: 3, presets: [{ id: 'max', label: 'Max', value: 9999 }] },
    ],
    ...overrides,
  };
}

function gameBetaProfile(): WispGameProfile {
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'game-beta-builtin',
    gameId: 'game-beta',
    source: 'builtin',
    groups: [{ id: 'resources', label: 'Resources', order: 0, actionIds: ['minerals', 'energy', 'drill-speed'] }],
    actions: [
      { id: 'minerals', entryId: 'entry-minerals', label: 'Mineral Storage', shortLabel: 'Minerals', groupId: 'resources', controlType: 'set' },
      { id: 'energy', entryId: 'entry-energy', label: 'Energy', groupId: 'resources', controlType: 'freeze' },
      { id: 'drill-speed', entryId: 'entry-drill', label: 'Drill Speed', groupId: 'resources', controlType: 'multiplier', presets: [{ id: 'x2', label: '2x', value: 2 }] },
    ],
  };
}

describe('adaptive-wisp schema — valid profiles', () => {
  test('a minimal valid profile (no groups/actions) is accepted', () => {
    const result = validateWispGameProfile({ schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'p', gameId: 'g', source: 'generated', groups: [], actions: [] });
    assert.equal(result.ok, true);
  });

  test('Game Alpha fixture is accepted and produces HP/XP/Fuel actions', () => {
    const result = validateWispGameProfile(gameAlphaProfile());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.profile.actions.map((a) => a.shortLabel ?? a.label), ['HP', 'XP', 'Fuel']);
    }
  });

  test('Game Beta fixture is accepted and produces a different, unrelated layout from the same generic schema', () => {
    const result = validateWispGameProfile(gameBetaProfile());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.profile.actions.map((a) => a.shortLabel ?? a.label), ['Minerals', 'Energy', 'Drill Speed']);
    }
  });

  test('all seven control types are individually accepted', () => {
    const controlTypes = ['toggle', 'freeze', 'set', 'increment', 'multiplier', 'cycle', 'momentary'] as const;
    for (const controlType of controlTypes) {
      const result = validateWispGameProfile(
        gameAlphaProfile({ actions: [{ id: 'a', entryId: 'e', label: 'A', controlType }], groups: [] }),
      );
      assert.equal(result.ok, true, `controlType=${controlType} should be accepted`);
    }
  });

  test('preset value accepts number, string, and boolean', () => {
    const result = validateWispGameProfile(
      gameAlphaProfile({
        groups: [],
        actions: [
          {
            id: 'a',
            entryId: 'e',
            label: 'A',
            controlType: 'cycle',
            presets: [
              { id: 'p1', label: 'Numeric', value: 5 },
              { id: 'p2', label: 'Text', value: 'fast' },
              { id: 'p3', label: 'Flag', value: true },
            ],
          },
        ],
      }),
    );
    assert.equal(result.ok, true);
  });

  test('full provenance and optional trainer/table identity is accepted', () => {
    const result = validateWispGameProfile(
      gameAlphaProfile({
        trainerId: 't1',
        tableId: 'tbl1',
        tableVersion: 'v2.3',
        source: 'creator',
        provenance: { source: 'creator', authorId: 'author-1', authorDisplayName: 'Example Creator', trainerId: 't1', tableId: 'tbl1', tableVersion: 'v2.3', importedAt: '2026-01-01T00:00:00.000Z' },
      }),
    );
    assert.equal(result.ok, true);
  });

  test('slot at the boundary (1 and 6) is accepted', () => {
    for (const slot of [WISP_PROFILE_LIMITS.minQuickSlot, WISP_PROFILE_LIMITS.maxQuickSlot]) {
      const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'toggle', slot }] }));
      assert.equal(result.ok, true, `slot=${slot} should be accepted`);
    }
  });
});

describe('adaptive-wisp schema — invalid data', () => {
  test('missing profileId is rejected', () => {
    const { profileId, ...rest } = gameAlphaProfile();
    const result = validateWispGameProfile(rest);
    assert.equal(result.ok, false);
  });

  test('missing gameId is rejected', () => {
    const { gameId, ...rest } = gameAlphaProfile();
    const result = validateWispGameProfile(rest);
    assert.equal(result.ok, false);
  });

  test('missing entryId on an action is rejected', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', label: 'A', controlType: 'toggle' } as never] }));
    assert.equal(result.ok, false);
  });

  test('an invalid control type is rejected', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'formula-execute' as never }] }));
    assert.equal(result.ok, false);
  });

  test('negative slot is rejected with WISP_PROFILE_INVALID_SLOT', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'toggle', slot: -1 }] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_INVALID_SLOT'));
  });

  test('slot beyond the limit is rejected with WISP_PROFILE_INVALID_SLOT', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'toggle', slot: WISP_PROFILE_LIMITS.maxQuickSlot + 1 }] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_INVALID_SLOT'));
  });

  test('exceeding maxActions is rejected with WISP_PROFILE_TOO_MANY_ACTIONS', () => {
    const actions = Array.from({ length: WISP_PROFILE_LIMITS.maxActions + 1 }, (_, i) => ({ id: `a${i}`, entryId: `e${i}`, label: `A${i}`, controlType: 'toggle' as const }));
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_TOO_MANY_ACTIONS'));
  });

  test('maxActions exactly at the limit is accepted (limit - 1, limit, limit + 1 boundary)', () => {
    const atLimit = Array.from({ length: WISP_PROFILE_LIMITS.maxActions }, (_, i) => ({ id: `a${i}`, entryId: `e${i}`, label: `A${i}`, controlType: 'toggle' as const }));
    const underLimit = atLimit.slice(0, -1);
    assert.equal(validateWispGameProfile(gameAlphaProfile({ groups: [], actions: atLimit })).ok, true);
    assert.equal(validateWispGameProfile(gameAlphaProfile({ groups: [], actions: underLimit })).ok, true);
  });

  test('exceeding maxPresetsPerAction is rejected', () => {
    const presets = Array.from({ length: WISP_PROFILE_LIMITS.maxPresetsPerAction + 1 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, value: i }));
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'cycle', presets }] }));
    assert.equal(result.ok, false);
  });

  test('oversized label is rejected', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'x'.repeat(WISP_PROFILE_LIMITS.maxStringLength + 1), controlType: 'toggle' }] }));
    assert.equal(result.ok, false);
  });

  test('oversized description is rejected', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', description: 'x'.repeat(WISP_PROFILE_LIMITS.maxDescriptionLength + 1), controlType: 'toggle' }] }));
    assert.equal(result.ok, false);
  });

  test('duplicate action ID is rejected with WISP_PROFILE_DUPLICATE_ACTION_ID', () => {
    const result = validateWispGameProfile(
      gameAlphaProfile({ groups: [], actions: [{ id: 'dup', entryId: 'e1', label: 'A', controlType: 'toggle' }, { id: 'dup', entryId: 'e2', label: 'B', controlType: 'toggle' }] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_DUPLICATE_ACTION_ID'));
  });

  test('duplicate group ID is rejected with WISP_PROFILE_DUPLICATE_GROUP_ID', () => {
    const result = validateWispGameProfile(
      gameAlphaProfile({ groups: [{ id: 'dup', label: 'A', order: 0, actionIds: [] }, { id: 'dup', label: 'B', order: 1, actionIds: [] }], actions: [] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_DUPLICATE_GROUP_ID'));
  });

  test('a group referencing an unknown action is rejected with WISP_PROFILE_UNKNOWN_ACTION_REFERENCE', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [{ id: 'g', label: 'G', order: 0, actionIds: ['does-not-exist'] }], actions: [] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_UNKNOWN_ACTION_REFERENCE'));
  });

  test('an action referencing an unknown group is rejected with WISP_PROFILE_UNKNOWN_GROUP_REFERENCE', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'toggle', groupId: 'no-such-group' }] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_UNKNOWN_GROUP_REFERENCE'));
  });

  test('malformed provenance (invalid source enum) is rejected', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [], provenance: { source: 'not-a-real-source' } as never }));
    assert.equal(result.ok, false);
  });

  test('a future unsupported schema version is rejected with WISP_PROFILE_VERSION_UNSUPPORTED', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ schemaVersion: 999, groups: [], actions: [] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_VERSION_UNSUPPORTED'));
  });

  test('a malformed (non-numeric) schema version is rejected with WISP_PROFILE_VERSION_UNSUPPORTED', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ schemaVersion: 'v1' as never, groups: [], actions: [] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_VERSION_UNSUPPORTED'));
  });

  test('a missing schema version is rejected with WISP_PROFILE_VERSION_UNSUPPORTED', () => {
    const { schemaVersion, ...rest } = gameAlphaProfile();
    const result = validateWispGameProfile(rest);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_VERSION_UNSUPPORTED'));
  });

  test('an oversized serialized profile is rejected with WISP_PROFILE_TOO_LARGE', () => {
    const result = validateWispGameProfile(gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'toggle', description: 'x'.repeat(WISP_PROFILE_LIMITS.maxSerializedProfileBytes) }] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_TOO_LARGE'));
  });
});

describe('adaptive-wisp schema — security: executable content is not representable', () => {
  const attempts: Array<[string, unknown]> = [
    ['script', { script: 'alert(1)' }],
    ['javascript', { javascript: '1+1' }],
    ['command', { command: 'rm -rf /' }],
    ['shell', { shell: 'bash' }],
    ['exec', { exec: 'notepad.exe' }],
    ['eval', { eval: 'process.exit()' }],
    ['rawAddress', { rawAddress: '0x1234ABCD' }],
    ['address', { address: '0xDEADBEEF' }],
    ['processId', { processId: 4242 }],
    ['ipcChannel', { ipcChannel: 'wisp:execute-anything' }],
    ['nativeCode', { nativeCode: 'base64payload' }],
    ['binaryPayload', { binaryPayload: 'base64payload' }],
  ];

  for (const [label, extra] of attempts) {
    test(`profile-level "${label}" field is rejected as executable metadata`, () => {
      const result = validateWispGameProfile({ ...gameAlphaProfile(), ...extra });
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_EXECUTABLE_METADATA_REJECTED'));
    });

    test(`action-level "${label}" field is rejected as executable metadata`, () => {
      const result = validateWispGameProfile(
        gameAlphaProfile({ groups: [], actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'toggle', ...extra } as never] }),
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_EXECUTABLE_METADATA_REJECTED'));
    });
  }

  test('a function-like value in a preset is rejected (JSON.stringify drops functions, so the field silently vanishes rather than executing)', () => {
    const raw = gameAlphaProfile({
      groups: [],
      actions: [{ id: 'a', entryId: 'e', label: 'A', controlType: 'cycle', presets: [{ id: 'p', label: 'P', value: (() => 1) as never }] }],
    });
    const result = validateWispGameProfile(raw);
    // A function value fails Zod's union(number|string|boolean) — it is never accepted, function-shaped or not.
    assert.equal(result.ok, false);
  });

  test('an unrecognized field anywhere is rejected by strict schemas even outside the blocklist', () => {
    const result = validateWispGameProfile({ ...gameAlphaProfile(), somethingUnexpected: 'value' });
    assert.equal(result.ok, false);
  });
});

describe('adaptive-wisp schema — versioning', () => {
  test('the current version constant is 1', () => {
    assert.equal(WISP_PROFILE_SCHEMA_VERSION, 1);
  });

  test('validation does not mutate the caller\'s raw input object', () => {
    const raw = gameAlphaProfile();
    const snapshot = JSON.parse(JSON.stringify(raw));
    validateWispGameProfile(raw);
    assert.deepEqual(raw, snapshot);
  });
});
