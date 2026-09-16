/**
 * Real DB + real files: proves the fast-hash pre-filter -> BLAKE3-confirm
 * pipeline actually detects byte-identical installed executables across
 * different platforms/paths, and does not false-positive on same-size
 * different-content files (fast-hash collision would be a bug if it did).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertInstalledGames } from '../src/core/install-discovery/store.ts';
import { findDuplicateInstalledExecutables } from '../src/core/install-discovery/reconcile-duplicate-executables.ts';
import { resetContentHashCachesForTesting } from '../src/core/executable-identity/content-hash.ts';
import type { InstalledGameRecord } from '../src/core/install-discovery/types.ts';

let tmpDir: string;

function record(
  id: string,
  platform: InstalledGameRecord['platform'],
  executablePath: string,
  catalogGameId: string,
): InstalledGameRecord {
  return {
    id,
    installIdentity: `install:v2:exe:${id}`,
    canonicalInstallPath: path.dirname(executablePath).toLowerCase(),
    canonicalExecutablePath: executablePath.toLowerCase(),
    identityVersion: 2,
    identityStatus: 'verified',
    needsReverification: false,
    catalogGameId,
    platform,
    installPath: path.dirname(executablePath),
    executablePath,
    displayName: `Demo ${id}`,
    detectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

describe('findDuplicateInstalledExecutables', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-reconcile-dupes-'));
  });

  afterAll(async () => {
    resetContentHashCachesForTesting();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await resetForTesting();
  });

  test('flags two installs whose executables are byte-identical, across different platforms and paths', async () => {
    await resetForTesting();
    const steamPath = path.join(tmpDir, 'steam-copy.exe');
    const manualPath = path.join(tmpDir, 'manual-copy.exe');
    const payload = Buffer.concat([Buffer.from('MZ'), Buffer.from('identical-game-build-payload')]);
    fs.writeFileSync(steamPath, payload);
    fs.writeFileSync(manualPath, payload);

    upsertInstalledGames([
      record('steam-1', 'steam', steamPath, 'demo-game'),
      record('manual-1', 'manual', manualPath, 'demo-game'),
    ]);

    const groups = await findDuplicateInstalledExecutables();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].installs.length, 2);
    assert.deepEqual(
      groups[0].installs.map((i) => i.id).sort(),
      ['manual-1', 'steam-1'],
    );
  });

  test('does not flag two different-content executables of the same size (fast-hash collision would be a false positive)', async () => {
    await resetForTesting();
    const a = path.join(tmpDir, 'game-a.exe');
    const b = path.join(tmpDir, 'game-b.exe');
    // Same length, different bytes — a naive size-only check would wrongly group these.
    fs.writeFileSync(a, Buffer.concat([Buffer.from('MZ'), Buffer.from('aaaaaaaaaaaaaaaaaaaa')]));
    fs.writeFileSync(b, Buffer.concat([Buffer.from('MZ'), Buffer.from('bbbbbbbbbbbbbbbbbbbb')]));

    upsertInstalledGames([
      record('a-1', 'steam', a, 'game-a'),
      record('b-1', 'steam', b, 'game-b'),
    ]);

    const groups = await findDuplicateInstalledExecutables();
    assert.deepEqual(groups, []);
  });

  test('a single install of a game produces no duplicate group', async () => {
    await resetForTesting();
    const solo = path.join(tmpDir, 'solo.exe');
    fs.writeFileSync(solo, Buffer.from('MZsolo-content'));
    upsertInstalledGames([record('solo-1', 'gog', solo, 'solo-game')]);

    const groups = await findDuplicateInstalledExecutables();
    assert.deepEqual(groups, []);
  });

  test('three installs sharing the same build are reported together, not as separate pairs', async () => {
    await resetForTesting();
    const payload = Buffer.from('MZtriple-shared-build');
    const paths = ['p1.exe', 'p2.exe', 'p3.exe'].map((name) => path.join(tmpDir, name));
    for (const p of paths) fs.writeFileSync(p, payload);

    upsertInstalledGames(paths.map((p, i) => record(`triple-${i}`, 'manual', p, 'triple-game')));

    const groups = await findDuplicateInstalledExecutables();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].installs.length, 3);
  });

  test('an install whose executable no longer exists on disk is skipped, not thrown', async () => {
    await resetForTesting();
    const missing = path.join(tmpDir, 'was-deleted.exe');
    upsertInstalledGames([record('missing-1', 'manual', missing, 'missing-game')]);

    const groups = await findDuplicateInstalledExecutables();
    assert.deepEqual(groups, []);
  });
});
