import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  validateWispUserState,
  WISP_USER_STATE_SCHEMA_VERSION,
  createWispProfileRegistry,
  selectWispProfile,
  saveWispUserOverride,
  clearWispUserOverride,
  clearWispSelectedProfile,
  resetWispUserState,
  resolveWispProfileForGame,
  loadUserState,
  WISP_PROFILE_SCHEMA_VERSION,
  type WispGameProfile,
} from '../src/core/adaptive-wisp/index.ts';

async function freshUserDataRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'solith-wisp-userstate-'));
}

function baseState(overrides = {}) {
  return { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', ...overrides };
}

describe('adaptive-wisp user-state schema — valid', () => {
  test('a minimal user state (no override) is accepted', () => {
    assert.equal(validateWispUserState(baseState()).ok, true);
  });

  test('a full override with every field is accepted', () => {
    const result = validateWispUserState(
      baseState({
        selectedProfileId: 'p1',
        override: {
          schemaVersion: WISP_USER_STATE_SCHEMA_VERSION,
          gameId: 'game-alpha',
          baseProfileId: 'p1',
          groupOrder: ['g1', 'g2'],
          actionOrderByGroup: { g1: ['a1', 'a2'] },
          slotAssignments: { a1: 1, a2: null },
          hiddenActions: ['a3'],
          actionGroupOverrides: { a3: 'g2' },
          preferredGroupId: 'g1',
          preferredQuickSlotCount: 4,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );
    assert.equal(result.ok, true);
  });
});

describe('adaptive-wisp user-state schema — invalid / security', () => {
  test('missing gameId is rejected', () => {
    const { gameId: _gameId, ...rest } = baseState();
    assert.equal(validateWispUserState(rest).ok, false);
  });

  test('missing/unsupported schemaVersion is rejected', () => {
    assert.equal(validateWispUserState({ gameId: 'g' }).ok, false);
    assert.equal(validateWispUserState({ schemaVersion: 999, gameId: 'g' }).ok, false);
  });

  test('an unrecognized field is rejected by the strict schema', () => {
    assert.equal(validateWispUserState({ ...baseState(), somethingUnexpected: 1 }).ok, false);
  });

  test('an executable-metadata field is rejected', () => {
    const result = validateWispUserState({ ...baseState(), override: { schemaVersion: 1, gameId: 'game-alpha', command: 'rm -rf /' } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'WISP_PROFILE_EXECUTABLE_METADATA_REJECTED'));
  });

  test('too many hiddenActions entries is rejected', () => {
    const hiddenActions = Array.from({ length: 65 }, (_, i) => `a${i}`);
    assert.equal(validateWispUserState({ ...baseState(), override: { schemaVersion: 1, gameId: 'game-alpha', hiddenActions } }).ok, false);
  });
});

describe('adaptive-wisp user-state service', () => {
  function alphaCreator(): WispGameProfile {
    return {
      schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
      profileId: 'alpha-creator',
      gameId: 'game-alpha',
      source: 'creator',
      groups: [{ id: 'player', label: 'Player', order: 0, actionIds: ['hp'] }],
      actions: [{ id: 'hp', entryId: 'e-hp', label: 'Health', groupId: 'player', controlType: 'freeze' }],
    };
  }
  function alphaUser(): WispGameProfile {
    return { schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'alpha-user', gameId: 'game-alpha', source: 'user', groups: [], actions: [] };
  }

  test('selectWispProfile persists a selection that resolveWispProfileForGame then honors', async () => {
    const root = await freshUserDataRoot();
    const registry = createWispProfileRegistry();
    registry.register(alphaCreator());
    registry.register(alphaUser());

    await selectWispProfile(root, 'game-alpha', 'alpha-user');
    const result = await resolveWispProfileForGame(registry, root, { gameId: 'game-alpha' });
    assert.equal(result.selectedProfileId, 'alpha-user');
  });

  test('saveWispUserOverride persists an override that resolveWispProfileForGame applies', async () => {
    const root = await freshUserDataRoot();
    const registry = createWispProfileRegistry();
    registry.register(alphaCreator());

    await saveWispUserOverride(root, { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', hiddenActions: ['hp'] });
    const result = await resolveWispProfileForGame(registry, root, { gameId: 'game-alpha' });
    assert.equal(result.profile?.actions[0].enabled, false);
    assert.equal(result.userOverrideApplied, true);
  });

  test('clearWispUserOverride removes only the override, keeping the selected profile', async () => {
    const root = await freshUserDataRoot();
    await selectWispProfile(root, 'game-alpha', 'p1');
    await saveWispUserOverride(root, { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', hiddenActions: ['hp'] });
    await clearWispUserOverride(root, 'game-alpha');
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok && loaded.state?.selectedProfileId, 'p1');
    assert.equal(loaded.ok && loaded.state?.override, undefined);
  });

  test('clearWispSelectedProfile removes only the selection, keeping the override', async () => {
    const root = await freshUserDataRoot();
    await selectWispProfile(root, 'game-alpha', 'p1');
    await saveWispUserOverride(root, { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', hiddenActions: ['hp'] });
    await clearWispSelectedProfile(root, 'game-alpha');
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok && loaded.state?.selectedProfileId, undefined);
    assert.ok(loaded.ok && loaded.state?.override);
  });

  test('resetWispUserState clears everything and resolution reverts to default precedence', async () => {
    const root = await freshUserDataRoot();
    const registry = createWispProfileRegistry();
    registry.register(alphaCreator());
    registry.register(alphaUser());
    await selectWispProfile(root, 'game-alpha', 'alpha-user');

    await resetWispUserState(root, 'game-alpha');
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok && loaded.state, null);
    const result = await resolveWispProfileForGame(registry, root, { gameId: 'game-alpha' });
    assert.equal(result.selectedProfileId, 'alpha-user' /* still wins on source precedence, not because it's persisted */);
  });

  test('a load failure in persisted state degrades to resolving without it, not a crash', async () => {
    const root = await freshUserDataRoot();
    const registry = createWispProfileRegistry();
    registry.register(alphaCreator());
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    await fs.mkdir(dir, { recursive: true });
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update('game-alpha', 'utf8').digest('hex');
    await fs.writeFile(path.join(dir, `${hash}.json`), 'not json at all', 'utf8');

    const result = await resolveWispProfileForGame(registry, root, { gameId: 'game-alpha' });
    assert.equal(result.ok, true);
    assert.equal(result.selectedProfileId, 'alpha-creator');
  });

  test('Game Alpha persisted state can never select a Game Beta profile', async () => {
    const root = await freshUserDataRoot();
    const registry = createWispProfileRegistry();
    registry.register(alphaCreator());
    registry.register({ schemaVersion: WISP_PROFILE_SCHEMA_VERSION, profileId: 'beta-creator', gameId: 'game-beta', source: 'creator', groups: [], actions: [] });

    await selectWispProfile(root, 'game-alpha', 'beta-creator');
    const result = await resolveWispProfileForGame(registry, root, { gameId: 'game-alpha' });
    // beta-creator is not registered under game-alpha, so it's not-found and falls back.
    assert.equal(result.selectedProfileId, 'alpha-creator');
  });
});
