/**
 * Real end-to-end coverage: a genuine installed-game row (real file on disk,
 * real DB row) resolves to its authoritative BLAKE3 content hash via the
 * same lookup path the SHA-256 definition-fingerprint hash already uses.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash as createBlake3Hash } from 'blake3';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertInstalledGames, findInstalledExecutablePath } from '../src/core/install-discovery/store.ts';
import type { InstalledGameRecord } from '../src/core/install-discovery/types.ts';
import { resolveInstalledExecutableContentHash } from '../src/core/executable-identity/catalog-content-hash.ts';
import { resetContentHashCachesForTesting } from '../src/core/executable-identity/content-hash.ts';

let tmpDir: string;
let exePath: string;
const CATALOG_GAME_ID = 'demo-content-hash-game';

function installedGameRecord(overrides: Partial<InstalledGameRecord> = {}): InstalledGameRecord {
  return {
    id: 'row-1',
    installIdentity: 'install:v2:exe:test-fixture',
    canonicalInstallPath: path.dirname(exePath).toLowerCase(),
    canonicalExecutablePath: exePath.toLowerCase(),
    identityVersion: 2,
    identityStatus: 'verified',
    needsReverification: false,
    catalogGameId: CATALOG_GAME_ID,
    platform: 'manual',
    installPath: path.dirname(exePath),
    executablePath: exePath,
    displayName: 'Demo Content Hash Game',
    detectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('resolveInstalledExecutableContentHash', () => {
  beforeAll(async () => {
    await resetForTesting();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-catalog-content-hash-'));
    exePath = path.join(tmpDir, 'DemoGame.exe');
    fs.writeFileSync(exePath, Buffer.concat([Buffer.from('MZ'), Buffer.from('deterministic-build-content')]));
    upsertInstalledGames([installedGameRecord()]);
  });

  afterAll(async () => {
    resetContentHashCachesForTesting();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await resetForTesting();
  });

  test('findInstalledExecutablePath resolves the real on-disk path from a catalogGameId', () => {
    assert.equal(findInstalledExecutablePath(CATALOG_GAME_ID), exePath);
    assert.equal(findInstalledExecutablePath(CATALOG_GAME_ID, 'DemoGame.exe'), exePath);
    assert.equal(findInstalledExecutablePath(CATALOG_GAME_ID, 'wrong-name.exe'), undefined);
    assert.equal(findInstalledExecutablePath('no-such-catalog-game'), undefined);
  });

  test('returns the real BLAKE3 digest of the installed executable', async () => {
    const expected = Buffer.from(
      createBlake3Hash().update(fs.readFileSync(exePath)).digest(),
    ).toString('hex');
    const actual = await resolveInstalledExecutableContentHash(CATALOG_GAME_ID);
    assert.equal(actual, expected);
  });

  test('returns null when no install is recorded for the catalog game', async () => {
    const actual = await resolveInstalledExecutableContentHash('no-such-catalog-game');
    assert.equal(actual, null);
  });

  test('is stable across calls (real cache, not recomputed garbage)', async () => {
    const first = await resolveInstalledExecutableContentHash(CATALOG_GAME_ID);
    const second = await resolveInstalledExecutableContentHash(CATALOG_GAME_ID);
    assert.equal(first, second);
  });
});
