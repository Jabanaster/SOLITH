/**
 * ROADMAP §online-foundation Mission 8/12 — content-addressed trainer artifact store tests.
 * Isolated from shared project data via resetForTesting() (:memory: sql.js),
 * following the artwork-cache store test precedent (tests/artwork-cache-store.test.ts).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  computeArtifactHash,
  registerTrainerArtifact,
  getTrainerArtifact,
  listTrainerArtifactsByTrainer,
} from '../src/core/trainer-artifact-store/store.ts';

describe('trainer artifact store', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  describe('computeArtifactHash', () => {
    test('is deterministic for identical bytes', () => {
      const bufferA = Buffer.from('trainer-bytes-v1');
      const bufferB = Buffer.from('trainer-bytes-v1');
      assert.equal(computeArtifactHash(bufferA), computeArtifactHash(bufferB));
    });

    test('produces the known SHA-256 hex digest', () => {
      // Independently verifiable: sha256("hello") is well-known.
      const hash = computeArtifactHash(Buffer.from('hello'));
      assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    test('different bytes produce different hashes', () => {
      const hashA = computeArtifactHash(Buffer.from('content-a'));
      const hashB = computeArtifactHash(Buffer.from('content-b'));
      assert.notEqual(hashA, hashB);
    });

    test('produces a 64-character lowercase hex string', () => {
      const hash = computeArtifactHash(Buffer.from('anything'));
      assert.match(hash, /^[0-9a-f]{64}$/);
    });
  });

  describe('registerTrainerArtifact', () => {
    test('inserts a new row for a fresh hash', () => {
      const buffer = Buffer.from('elden-ring-trainer-v1');
      const hash = computeArtifactHash(buffer);
      const artifact = registerTrainerArtifact({
        artifactHash: hash,
        trainerId: 'elden-ring-trainer',
        gameId: 'elden-ring',
        gameBuild: '1.0.0',
        sizeBytes: buffer.byteLength,
        localPath: 'C:/artifacts/elden-ring-trainer-v1.exe',
      });
      assert.equal(artifact.artifactHash, hash);
      assert.equal(artifact.trainerId, 'elden-ring-trainer');
      assert.equal(artifact.gameId, 'elden-ring');
      assert.equal(artifact.gameBuild, '1.0.0');
      assert.equal(artifact.kind, 'native-package');
      assert.equal(artifact.rightsClass, 'user-provided');
      assert.equal(artifact.sizeBytes, buffer.byteLength);
    });

    test('defaults kind and rightsClass when not supplied', () => {
      const buffer = Buffer.from('defaults-check');
      const hash = computeArtifactHash(buffer);
      const artifact = registerTrainerArtifact({
        artifactHash: hash,
        trainerId: 'defaults-trainer',
        sizeBytes: buffer.byteLength,
      });
      assert.equal(artifact.kind, 'native-package');
      assert.equal(artifact.rightsClass, 'user-provided');
      assert.equal(artifact.gameId, undefined);
      assert.equal(artifact.localPath, undefined);
    });

    // --- Mission 12 proof (a): same bytes uploaded under two different
    // filenames/trainerIds-as-uploaded-by hash dedup to ONE row. ---
    test('duplicate-upload proof (a): identical bytes under different filenames/trainerIds dedup to one row', () => {
      const buffer = Buffer.from('shared-engine-dll-check-bytes');
      const hash = computeArtifactHash(buffer);

      registerTrainerArtifact({
        artifactHash: hash,
        trainerId: 'trainer-alpha',
        sizeBytes: buffer.byteLength,
        localPath: 'C:/uploads/alpha_upload_filename.dll',
      });
      registerTrainerArtifact({
        artifactHash: hash,
        trainerId: 'trainer-beta',
        sizeBytes: buffer.byteLength,
        localPath: 'C:/uploads/totally_different_name.dll',
      });

      const row = getTrainerArtifact(hash);
      assert.ok(row);
      // Exactly one row: registering the same hash again must not create a
      // second row. The original registrant's trainerId/localPath is kept
      // (see store.ts doc comment for why this is not overwritten).
      assert.equal(row!.trainerId, 'trainer-alpha');
      assert.equal(row!.localPath, 'C:/uploads/alpha_upload_filename.dll');
      assert.equal(row!.sizeBytes, buffer.byteLength);
    });

    // --- Mission 12 proof (b): two different byte contents produce two
    // different hashes/rows. ---
    test('duplicate-upload proof (b): different byte contents produce two distinct hash rows', () => {
      const bufferOne = Buffer.from('distinct-content-one');
      const bufferTwo = Buffer.from('distinct-content-two');
      const hashOne = computeArtifactHash(bufferOne);
      const hashTwo = computeArtifactHash(bufferTwo);
      assert.notEqual(hashOne, hashTwo);

      registerTrainerArtifact({ artifactHash: hashOne, trainerId: 'distinct-trainer', sizeBytes: bufferOne.byteLength });
      registerTrainerArtifact({ artifactHash: hashTwo, trainerId: 'distinct-trainer', sizeBytes: bufferTwo.byteLength });

      const rowOne = getTrainerArtifact(hashOne);
      const rowTwo = getTrainerArtifact(hashTwo);
      assert.ok(rowOne);
      assert.ok(rowTwo);
      assert.notEqual(rowOne!.artifactHash, rowTwo!.artifactHash);
    });

    // --- Mission 12 proof (c) / immutable versioning: a new gameBuild for
    // the same trainerId gets a new hash row; the old version's row is
    // never deleted or overwritten. ---
    test('duplicate-upload proof (c): a new version for the same trainerId adds a row without touching the old one', () => {
      const trainerId = 'versioned-trainer';
      const v1Buffer = Buffer.from('versioned-trainer-build-1.0');
      const v2Buffer = Buffer.from('versioned-trainer-build-2.0-CHANGED');
      const v1Hash = computeArtifactHash(v1Buffer);
      const v2Hash = computeArtifactHash(v2Buffer);
      assert.notEqual(v1Hash, v2Hash, 'sanity: different bytes must hash differently');

      registerTrainerArtifact({
        artifactHash: v1Hash,
        trainerId,
        gameBuild: '1.0',
        sizeBytes: v1Buffer.byteLength,
        localPath: 'C:/artifacts/versioned-trainer-1.0.exe',
      });
      registerTrainerArtifact({
        artifactHash: v2Hash,
        trainerId,
        gameBuild: '2.0',
        sizeBytes: v2Buffer.byteLength,
        localPath: 'C:/artifacts/versioned-trainer-2.0.exe',
      });

      const all = listTrainerArtifactsByTrainer(trainerId);
      assert.equal(all.length, 2, 'both versions must be present — old row never deleted');
      const hashes = all.map((row) => row.artifactHash).sort();
      assert.deepEqual(hashes, [v1Hash, v2Hash].sort());

      const v1Row = all.find((row) => row.artifactHash === v1Hash);
      assert.equal(v1Row!.gameBuild, '1.0');
      assert.equal(v1Row!.localPath, 'C:/artifacts/versioned-trainer-1.0.exe');
      assert.equal(v1Row!.sizeBytes, v1Buffer.byteLength, 'old row size must be untouched by the new registration');
    });

    test('registering the same hash again refreshes lastReferencedAt without creating a duplicate row', () => {
      const buffer = Buffer.from('refresh-check-bytes');
      const hash = computeArtifactHash(buffer);
      registerTrainerArtifact({ artifactHash: hash, trainerId: 'refresh-trainer', sizeBytes: buffer.byteLength });
      const first = getTrainerArtifact(hash)!;
      registerTrainerArtifact({ artifactHash: hash, trainerId: 'refresh-trainer', sizeBytes: buffer.byteLength });
      const second = getTrainerArtifact(hash)!;
      assert.equal(second.artifactHash, first.artifactHash);
      assert.equal(second.firstSeenAt, first.firstSeenAt, 'firstSeenAt must never change on a dedup hit');
    });
  });

  describe('getTrainerArtifact', () => {
    test('returns null for an unknown hash', () => {
      assert.equal(getTrainerArtifact('0'.repeat(64)), null);
    });
  });

  describe('listTrainerArtifactsByTrainer', () => {
    test('returns an empty array for a trainerId with no artifacts', () => {
      assert.deepEqual(listTrainerArtifactsByTrainer('no-such-trainer'), []);
    });
  });
});
