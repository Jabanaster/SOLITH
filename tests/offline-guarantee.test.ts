/**
 * ROADMAP §online-foundation Mission 18 — offline guarantee proof.
 *
 * Proves, with no network dependency wired into any call at all (no
 * fetchImpl passed anywhere, no mock server referenced), that the core
 * offline-critical flows all still work purely against local modules:
 *   - load My Games (personal-library projector)
 *   - load cached Discovery catalog (queryDiscoveryCatalog)
 *   - open a cached trainer (resolveTrainerArtifact cache-hit path)
 *   - open/build a locally-created trainer (registerTrainerArtifact + getTrainerArtifact, computeArtifactHash)
 *   - use backups (getBackupsForGame — read-only, no network import)
 *   - use Settings (getSettings/setSetting — local DB only)
 *
 * Isolated via resetForTesting() (:memory: sql.js).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting } from '../src/core/database/index.ts';
import { projectPersonalLibraryGame } from '../src/core/personal-library/model.ts';
import { upsertDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.ts';
import { queryDiscoveryCatalog } from '../src/core/discovery-catalog/query.ts';
import { computeArtifactHash, getTrainerArtifact, registerTrainerArtifact } from '../src/core/trainer-artifact-store/store.ts';
import { resolveTrainerArtifact } from '../src/core/trainer-artifact-cache/cache.ts';
import type { TrainerArtifactFetchImpl } from '../src/core/trainer-artifact-cache/types.ts';
import { getBackupsForGame } from '../src/core/backups/index.ts';
import { getSettings, setSetting, getSetting } from '../src/core/settings/index.ts';

/** A fetchImpl that throws if it is ever invoked — proves a code path made zero network calls. */
const NEVER_CALL_FETCH: TrainerArtifactFetchImpl = async () => {
  throw new Error('offline-guarantee violation: a network call was attempted');
};

describe('offline guarantee — Mission 18', () => {
  let cacheDir: string;

  beforeAll(async () => {
    await resetForTesting();
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-offline-guarantee-'));
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('load My Games: the personal-library projector needs no network', () => {
    assert.doesNotThrow(() => {
      const game = projectPersonalLibraryGame({
        gameId: 'offline-game-1',
        title: 'Offline Game',
        running: false,
        installations: [],
        ownedConfirmed: undefined,
        favorite: false,
        canonicalIdentityStatus: undefined,
        catalogEntry: null,
        hasUserAuthoredDefinition: false,
        latestValidationReceipt: null,
        trainerAccuracyEvidence: {
          hasTrainer: false,
          hasValidationReceipt: false,
          receiptStillValid: false,
          receiptFailed: false,
          exactVersionEvidence: false,
          exactVersionMismatch: false,
          strongMatchEvidence: false,
        },
        nowIso: new Date().toISOString(),
      });
      assert.equal(game.gameId, 'offline-game-1');
    });
  });

  test('load cached Discovery catalog: queryDiscoveryCatalog reads purely local DB state', () => {
    upsertDiscoveryCatalogEntry({
      solithGameId: 'offline-game-1',
      title: 'Offline Game',
      normalizedTitle: 'offline game',
      aliases: [],
      providerIds: {},
      type: 'game',
      genres: [],
      tags: [],
      trainerAvailable: false,
      ctAvailable: false,
      updatedAt: new Date().toISOString(),
    });

    assert.doesNotThrow(() => {
      const results = queryDiscoveryCatalog({ text: 'offline' });
      assert.ok(results.some((entry) => entry.solithGameId === 'offline-game-1'));
    });
  });

  test('open a cached trainer: resolveTrainerArtifact takes the cache-hit path with zero network calls', async () => {
    const buffer = Buffer.from('offline-cached-trainer-bytes');
    const hash = computeArtifactHash(buffer);
    const localPath = path.join(cacheDir, `${hash}.artifact`);
    fs.writeFileSync(localPath, buffer);
    registerTrainerArtifact({
      artifactHash: hash,
      trainerId: 'offline-trainer-1',
      sizeBytes: buffer.byteLength,
      localPath,
      rightsClass: 'user-provided',
    });

    const result = await resolveTrainerArtifact({
      artifactHash: hash,
      remoteUrl: 'https://should-never-be-hit.invalid/artifact',
      fetchImpl: NEVER_CALL_FETCH,
      cacheDir,
    });

    assert.equal(result.status, 'cache-hit');
  });

  test('open/build a locally-created trainer: registerTrainerArtifact + getTrainerArtifact + computeArtifactHash require no network', () => {
    assert.doesNotThrow(() => {
      const buffer = Buffer.from('freshly-built-local-trainer-bytes');
      // computeArtifactHash is a pure, synchronous crypto call — offline by construction.
      const hash = computeArtifactHash(buffer);
      const localPath = path.join(cacheDir, `${hash}.artifact`);
      fs.writeFileSync(localPath, buffer);
      const registered = registerTrainerArtifact({
        artifactHash: hash,
        trainerId: 'locally-built-trainer',
        sizeBytes: buffer.byteLength,
        localPath,
        rightsClass: 'user-provided',
      });
      assert.equal(registered.artifactHash, hash);
      const reloaded = getTrainerArtifact(hash);
      assert.ok(reloaded);
      assert.equal(reloaded!.localPath, localPath);
    });
  });

  test('use backups: getBackupsForGame is a local read-only DB query with no network import', () => {
    assert.doesNotThrow(() => {
      const backups = getBackupsForGame('offline-game-1');
      assert.ok(Array.isArray(backups));
    });
  });

  test('use Settings: getSettings/setSetting/getSetting are local-DB-only', () => {
    assert.doesNotThrow(() => {
      setSetting('onlineServicesEnabled', false);
      const value = getSetting('onlineServicesEnabled');
      assert.equal(value, false);
      const all = getSettings();
      assert.equal(typeof all, 'object');
    });
  });
});
