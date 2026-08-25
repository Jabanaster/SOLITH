import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { deleteUserState, loadUserState, saveUserState, WISP_USER_STATE_SCHEMA_VERSION, type WispUserState } from '../src/core/adaptive-wisp/index.ts';

async function freshUserDataRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'solith-wisp-persist-'));
}

function state(gameId: string, extra: Partial<WispUserState> = {}): WispUserState {
  return { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId, ...extra };
}

describe('adaptive-wisp persistence', () => {
  test('loading with no file present returns ok:true, state:null (not an error)', async () => {
    const root = await freshUserDataRoot();
    const result = await loadUserState(root, 'game-alpha');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.state, null);
  });

  test('save then load round-trips exactly', async () => {
    const root = await freshUserDataRoot();
    const saved = state('game-alpha', { selectedProfileId: 'p1' });
    const saveResult = await saveUserState(root, saved);
    assert.equal(saveResult.ok, true);
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.deepEqual(loaded.state, saved);
  });

  test('save/load round-trips a nested override whose keys differ from the top-level state keys (regression: an array-replacer would silently strip these)', async () => {
    const root = await freshUserDataRoot();
    const withOverride = state('game-alpha', {
      selectedProfileId: 'p1',
      override: { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', hiddenActions: ['a1', 'a2'], slotAssignments: { a3: 1 } },
    });
    await saveUserState(root, withOverride);
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.deepEqual(loaded.state, withOverride);
  });

  test('save is atomic: no leftover .tmp files after a successful save', async () => {
    const root = await freshUserDataRoot();
    await saveUserState(root, state('game-alpha'));
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    const entries = await fs.readdir(dir);
    assert.ok(entries.every((f) => !f.includes('.tmp')));
  });

  test('malformed JSON is reported as WISP_PERSISTENCE_CORRUPT, not a crash', async () => {
    const root = await freshUserDataRoot();
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    await fs.mkdir(dir, { recursive: true });
    const filePath = filePathFor(root, 'game-alpha');
    await fs.writeFile(filePath, '{ this is not valid json', 'utf8');
    const result = await loadUserState(root, 'game-alpha');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WISP_PERSISTENCE_CORRUPT');
  });

  test('schema-invalid data (missing required field) is reported as WISP_PERSISTENCE_CORRUPT', async () => {
    const root = await freshUserDataRoot();
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePathFor(root, 'game-alpha'), JSON.stringify({ schemaVersion: WISP_USER_STATE_SCHEMA_VERSION }), 'utf8');
    const result = await loadUserState(root, 'game-alpha');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WISP_PERSISTENCE_CORRUPT');
  });

  test('an unsupported future schema version is reported as WISP_PERSISTENCE_VERSION_UNSUPPORTED', async () => {
    const root = await freshUserDataRoot();
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePathFor(root, 'game-alpha'), JSON.stringify({ schemaVersion: 999, gameId: 'game-alpha' }), 'utf8');
    const result = await loadUserState(root, 'game-alpha');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WISP_PERSISTENCE_VERSION_UNSUPPORTED');
  });

  test('an oversized file is rejected with WISP_PERSISTENCE_TOO_LARGE before JSON.parse runs', async () => {
    const root = await freshUserDataRoot();
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    await fs.mkdir(dir, { recursive: true });
    const huge = JSON.stringify({ schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', override: { schemaVersion: 1, gameId: 'game-alpha', updatedAt: 'x'.repeat(200000) } });
    await fs.writeFile(filePathFor(root, 'game-alpha'), huge, 'utf8');
    const result = await loadUserState(root, 'game-alpha');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WISP_PERSISTENCE_TOO_LARGE');
  });

  test('a corrupt file is preserved as evidence (.corrupt sibling), original left untouched', async () => {
    const root = await freshUserDataRoot();
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    await fs.mkdir(dir, { recursive: true });
    const filePath = filePathFor(root, 'game-alpha');
    await fs.writeFile(filePath, 'not json', 'utf8');
    await loadUserState(root, 'game-alpha');
    const corruptEvidence = await fs.readFile(`${filePath}.corrupt`, 'utf8');
    assert.equal(corruptEvidence, 'not json');
    const originalStillThere = await fs.readFile(filePath, 'utf8');
    assert.equal(originalStillThere, 'not json');
  });

  test('a save that cannot create its directory fails without touching any prior valid file', async () => {
    const root = await freshUserDataRoot();
    await saveUserState(root, state('game-alpha', { selectedProfileId: 'keep-me' }));

    // Force mkdir(recursive) to fail: replace the 'adaptive-wisp' path segment with a plain file.
    const blockerRoot = await freshUserDataRoot();
    await fs.writeFile(path.join(blockerRoot, 'adaptive-wisp'), 'blocking file', 'utf8');

    const failResult = await saveUserState(blockerRoot, state('game-x'));
    assert.equal(failResult.ok, false);
    if (!failResult.ok) assert.equal(failResult.error.code, 'WISP_PERSISTENCE_WRITE_FAILED');

    // Original root's valid file is completely unaffected by the unrelated failed save.
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.state?.selectedProfileId, 'keep-me');
  });

  test('delete removes the file; deleting a nonexistent state is a no-op success', async () => {
    const root = await freshUserDataRoot();
    await saveUserState(root, state('game-alpha'));
    const del1 = await deleteUserState(root, 'game-alpha');
    assert.equal(del1.ok, true);
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.state, null);
    const del2 = await deleteUserState(root, 'game-alpha');
    assert.equal(del2.ok, true);
  });

  test('per-game isolation: two games never share or overwrite each other\'s file', async () => {
    const root = await freshUserDataRoot();
    await saveUserState(root, state('game-alpha', { selectedProfileId: 'alpha-pick' }));
    await saveUserState(root, state('game-beta', { selectedProfileId: 'beta-pick' }));
    const alpha = await loadUserState(root, 'game-alpha');
    const beta = await loadUserState(root, 'game-beta');
    assert.equal(alpha.ok && alpha.state?.selectedProfileId, 'alpha-pick');
    assert.equal(beta.ok && beta.state?.selectedProfileId, 'beta-pick');
  });

  test('a hostile-looking gameId cannot escape the user-state directory (opaque hashed filename)', async () => {
    const root = await freshUserDataRoot();
    const hostile = '../../../etc/passwd';
    const saveResult = await saveUserState(root, state(hostile));
    assert.equal(saveResult.ok, true);
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    const entries = await fs.readdir(dir);
    // Every entry must be a plain hash-named .json file directly inside the user-state dir — nothing escaped it.
    assert.ok(entries.every((f) => /^[0-9a-f]{64}\.json$/.test(f)));
    const loaded = await loadUserState(root, hostile);
    assert.equal(loaded.ok && loaded.state?.gameId, hostile);
  });

  test('the current schema version (1) loads without a migration path being invoked', async () => {
    const root = await freshUserDataRoot();
    await saveUserState(root, state('game-alpha'));
    const loaded = await loadUserState(root, 'game-alpha');
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.state?.schemaVersion, WISP_USER_STATE_SCHEMA_VERSION);
  });

  test('a stored gameId that does not match the requested gameId is treated as corrupt (defensive hash-collision guard)', async () => {
    const root = await freshUserDataRoot();
    const dir = path.join(root, 'adaptive-wisp', 'user-state');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePathFor(root, 'game-alpha'), JSON.stringify(state('game-mismatch')), 'utf8');
    const result = await loadUserState(root, 'game-alpha');
    assert.equal(result.ok, false);
  });
});

function filePathFor(userDataRoot: string, gameId: string): string {
  const hash = crypto.createHash('sha256').update(gameId, 'utf8').digest('hex');
  return path.join(userDataRoot, 'adaptive-wisp', 'user-state', `${hash}.json`);
}
