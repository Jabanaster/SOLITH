import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { after as afterAll, before as beforeAll } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting } from '../src/core/database/index.ts';
import { computeArtifactHash } from '../src/core/trainer-artifact-store/store.ts';
import { classifyArtifactBytes, CLASSIFIER_VERSION } from '../src/core/artifact-classification/classify.ts';
import { getClassificationReceipt, recordClassificationReceipt } from '../src/core/artifact-classification/store.ts';

/**
 * Phase 1.5 security closeout, Mission A2 — proves the classification
 * receipt is real, deterministic, tied to real content identity, and
 * persists/round-trips correctly.
 */
describe('artifact-classification', () => {
  let tempDbPath: string;

  beforeAll(async () => {
    tempDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'solith-artifact-classification-')), 'test.db');
    await resetForTesting(tempDbPath);
  });

  afterAll(async () => {
    await resetForTesting();
  });

  describe('classifyArtifactBytes', () => {
    test('always returns verdict "inconclusive" for this pass\'s honest classifier', () => {
      const receipt = classifyArtifactBytes(Buffer.from('anything at all'));
      assert.equal(receipt.verdict, 'inconclusive');
    });

    test('classifierVersion is the documented v0-inconclusive-only marker', () => {
      const receipt = classifyArtifactBytes(Buffer.from('bytes'));
      assert.equal(receipt.classifierVersion, 'v0-inconclusive-only');
      assert.equal(receipt.classifierVersion, CLASSIFIER_VERSION);
    });

    test('artifactHash is always the real recomputed SHA-256 of the given bytes, never accepted as input', () => {
      const buffer = Buffer.from('a real fake trainer artifact payload');
      const receipt = classifyArtifactBytes(buffer);
      assert.equal(receipt.artifactHash, computeArtifactHash(buffer));
      assert.match(receipt.artifactHash, /^[0-9a-f]{64}$/);
    });

    test('different bytes produce different artifactHash values', () => {
      const receiptA = classifyArtifactBytes(Buffer.from('trainer A bytes'));
      const receiptB = classifyArtifactBytes(Buffer.from('trainer B bytes'));
      assert.notEqual(receiptA.artifactHash, receiptB.artifactHash);
    });

    test('identical bytes are deterministic: same verdict, contentTypes, classifierVersion, and hash', () => {
      const buffer = Buffer.from('identical bytes twice');
      const first = classifyArtifactBytes(buffer);
      const second = classifyArtifactBytes(buffer);
      assert.equal(first.artifactHash, second.artifactHash);
      assert.equal(first.verdict, second.verdict);
      assert.equal(first.classifierVersion, second.classifierVersion);
      assert.deepEqual(first.contentTypes, second.contentTypes);
    });

    test('reasons array is non-empty and explains the honest-inconclusive result', () => {
      const receipt = classifyArtifactBytes(Buffer.from('some bytes'));
      assert.ok(receipt.reasons.length > 0);
      assert.match(receipt.reasons.join(' '), /inconclusive|cannot yet determine/i);
    });
  });

  describe('recordClassificationReceipt / getClassificationReceipt', () => {
    test('a recorded receipt round-trips exactly through the store', () => {
      const buffer = Buffer.from('round trip artifact bytes');
      const receipt = classifyArtifactBytes(buffer);
      recordClassificationReceipt(receipt);

      const fetched = getClassificationReceipt(receipt.artifactHash);
      assert.ok(fetched);
      assert.equal(fetched!.artifactHash, receipt.artifactHash);
      assert.equal(fetched!.verdict, receipt.verdict);
      assert.equal(fetched!.classifierVersion, receipt.classifierVersion);
      assert.deepEqual(fetched!.contentTypes, receipt.contentTypes);
    });

    test('an unrecorded hash returns null, not a fabricated receipt', () => {
      const fetched = getClassificationReceipt('f'.repeat(64));
      assert.equal(fetched, null);
    });

    test('re-recording an identical receipt for the same hash is an idempotent no-op', () => {
      const buffer = Buffer.from('idempotent re-record bytes');
      const receipt = classifyArtifactBytes(buffer);
      const first = recordClassificationReceipt(receipt);
      const second = recordClassificationReceipt(classifyArtifactBytes(buffer));
      assert.equal(first.artifactHash, second.artifactHash);
      assert.equal(first.verdict, second.verdict);
    });

    test('re-recording a DIFFERENT verdict for an already-classified hash is rejected (receipts are immutable per hash)', () => {
      const buffer = Buffer.from('immutability test bytes');
      const receipt = classifyArtifactBytes(buffer);
      recordClassificationReceipt(receipt);

      const conflicting = { ...receipt, verdict: 'eligible' as const };
      assert.throws(() => recordClassificationReceipt(conflicting), /immutable/);
    });
  });
});
