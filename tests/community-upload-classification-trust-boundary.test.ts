import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting } from '../src/core/database/index.ts';
import { computeArtifactHash, registerTrainerArtifact } from '../src/core/trainer-artifact-store/store.ts';
import { classifyArtifactBytes } from '../src/core/artifact-classification/classify.ts';
import { recordClassificationReceipt } from '../src/core/artifact-classification/store.ts';
import type { ClassificationReceipt } from '../src/core/artifact-classification/types.ts';
import { qualifyForUploadWithVerifiedClassification } from '../src/core/community-upload/qualification.ts';
import {
  qualifyForUploadPureForTesting as qualifyForUpload,
  type UploadQualificationInput,
} from '../src/core/community-upload/internal/qualify-pure.ts';
import { createLocalDraftSubmission, submitDraftToCommunity, getCommunitySubmission } from '../src/core/community-upload/store.ts';
import { classifyTrainerContentSafety } from '../src/core/community-upload/safety-classification.ts';

/**
 * Phase 1.5 security closeout, Mission A2 — adversarial proof of the
 * end-to-end trust boundary between raw artifact bytes and community upload
 * qualification. Each `test()` below proves exactly one attack/gap named in
 * the mission brief.
 */

function baseIdentity(artifactHash: string): Omit<UploadQualificationInput, 'classificationReceipt'> {
  return {
    hasSchemaValidation: true,
    hasGameIdentity: true,
    hasTrainerIdentity: true,
    hasArtifactHash: true,
    artifactHash,
    sharingPreference: 'ON',
  };
}

describe('community-upload classification trust boundary (Mission A2)', () => {
  let tempDbPath: string;

  beforeAll(async () => {
    tempDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'solith-trust-boundary-')), 'test.db');
    await resetForTesting(tempDbPath);
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('ATTACK: classify one hash, submit another — the mismatch is caught and upload is blocked with a specific reason', () => {
    const bufferA = Buffer.from('artifact A — the one actually classified');
    const bufferB = Buffer.from('artifact B — a different, unclassified artifact');
    const hashA = computeArtifactHash(bufferA);
    const hashB = computeArtifactHash(bufferB);
    assert.notEqual(hashA, hashB);

    // Force an 'eligible' receipt for A (hand-built, since the real
    // classifier only ever produces 'inconclusive' — see classify.ts) so
    // the mismatch check, not the inconclusive-verdict check, is what
    // actually fails this test.
    const receiptForA: ClassificationReceipt = {
      artifactHash: hashA,
      verdict: 'eligible',
      contentTypes: ['native-resolver'],
      reasons: [],
      classifiedAt: new Date().toISOString(),
      classifierVersion: 'test-fixture',
    };
    recordClassificationReceipt(receiptForA);

    // Attempt to submit B while presenting A's (real, recorded) hash-A
    // receipt directly to the pure function — simulating a caller that
    // classified A but is trying to get B qualified using A's paperwork.
    const result = qualifyForUpload({ ...baseIdentity(hashB), classificationReceipt: receiptForA });
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /hash mismatch/);
    }

    // And the real, database-backed entry point also blocks B: no receipt
    // was ever recorded for hashB, so it fails closed with "unavailable".
    const verifiedResult = qualifyForUploadWithVerifiedClassification(baseIdentity(hashB));
    assert.equal(verifiedResult.qualifies, false);
    if (!verifiedResult.qualifies) assert.match(verifiedResult.reason, /classification unavailable/);
  });

  test('GAP: omit classification entirely (no receipt recorded for this hash) — blocked with "classification unavailable"', () => {
    const buffer = Buffer.from('never classified artifact');
    const hash = computeArtifactHash(buffer);

    const result = qualifyForUploadWithVerifiedClassification(baseIdentity(hash));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /classification unavailable/);
    }
  });

  test('ATTACK: forge an unsupported/invalid classification verdict (simulating a compromised or buggy caller) — rejected, not silently accepted', () => {
    const buffer = Buffer.from('forged verdict artifact');
    const hash = computeArtifactHash(buffer);

    const forgedReceipt = {
      artifactHash: hash,
      verdict: 'totally-fine-dont-worry-about-it',
      contentTypes: ['native-resolver'],
      reasons: [],
      classifiedAt: new Date().toISOString(),
      classifierVersion: 'test-fixture',
    } as unknown as ClassificationReceipt;

    const result = qualifyForUpload({ ...baseIdentity(hash), classificationReceipt: forgedReceipt });
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /invalid classification verdict/);
    }
  });

  test("IMPOSSIBLE: turn an 'inconclusive' result into eligibility — there is no caller-side override", () => {
    const buffer = Buffer.from('genuinely inconclusive artifact bytes');
    const receipt = classifyArtifactBytes(buffer); // real classifier: always 'inconclusive'
    recordClassificationReceipt(receipt);
    assert.equal(receipt.verdict, 'inconclusive');

    // Even calling the real, verified, database-backed entry point with
    // this genuinely-recorded receipt cannot produce qualifies: true —
    // there is no parameter, flag, or override path on either
    // qualifyForUpload or qualifyForUploadWithVerifiedClassification that
    // promotes 'inconclusive' to 'eligible'.
    const result = qualifyForUploadWithVerifiedClassification(baseIdentity(receipt.artifactHash));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) assert.match(result.reason, /inconclusive/);
  });

  test('ATTACK: bypass prohibited script classifications — a hypothetical eligible+lua receipt is still rejected (belt-and-suspenders)', () => {
    const buffer = Buffer.from('lua script artifact bytes');
    const hash = computeArtifactHash(buffer);

    // This receipt shape (verdict: 'eligible' alongside contentTypes:
    // ['lua']) should never be producible by a correct classifier — but a
    // compromised/buggy one might emit it, so qualifyForUpload must not
    // trust the verdict field alone.
    const inconsistentReceipt: ClassificationReceipt = {
      artifactHash: hash,
      verdict: 'eligible',
      contentTypes: ['lua'],
      reasons: [],
      classifiedAt: new Date().toISOString(),
      classifierVersion: 'test-fixture',
    };
    recordClassificationReceipt(inconsistentReceipt);

    const result = qualifyForUploadWithVerifiedClassification(baseIdentity(hash));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /lua/);
    }
  });

  test('FIXED (Phase 2.1 Mission 3): direct store invocation without a valid receipt is REJECTED, not silently accepted', () => {
    // Was: createCommunitySubmission could be called directly, bypassing
    // qualifyForUploadWithVerifiedClassification entirely, landing a row at
    // trustState 'NEW_COMMUNITY' with zero classification evidence. Per the
    // owner's Phase 2.1 decision ("caller discipline is not sufficient for
    // this security boundary"), the low-level insert (createLocalDraftSubmission)
    // can now ONLY ever produce a LOCAL_DRAFT with trustState null, and the
    // one function that can promote it (submitDraftToCommunity) independently
    // re-derives qualification from the classification_receipts table by the
    // draft's OWN artifactHash — it does not trust anything the caller claims.
    const buffer = Buffer.from('never classified, directly submitted anyway');
    const hash = computeArtifactHash(buffer);
    registerTrainerArtifact({ artifactHash: hash, trainerId: 'trainer-bypass-test', sizeBytes: buffer.byteLength });

    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-bypass-test',
      artifactHash: hash,
      safetyClassification: classifyTrainerContentSafety([]), // caller-fabricated, honest content types unknown
    });
    // The insert itself is a LOCAL_DRAFT, not a real Community submission —
    // structurally incapable of being read as upload-eligible.
    assert.equal(draft.submissionState, 'LOCAL_DRAFT');
    assert.equal(draft.trustState, null);

    const promotion = submitDraftToCommunity({
      submissionId: draft.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'ON',
    });
    assert.equal(promotion.ok, false, 'promotion must be rejected: no classification receipt exists for this hash');
    if (!promotion.ok) assert.match(promotion.error, /classification unavailable/);

    const reloaded = getCommunitySubmission(draft.submissionId);
    assert.equal(reloaded!.submissionState, 'LOCAL_DRAFT');
    assert.equal(reloaded!.trustState, null, 'the bypass attempt must never leave the row in a Community-visible state');
  });

  test('ATTACK: submitDraftToCommunity cannot be tricked into using a receipt for a different artifact hash', () => {
    // Unlike the pure qualifyForUpload (which accepts an artifactHash
    // parameter a caller controls), submitDraftToCommunity derives the hash
    // to qualify SOLELY from the persisted draft row — there is no
    // caller-supplied artifactHash parameter on its input at all, so a
    // "classify one hash, submit another" attack is structurally impossible
    // at this layer, not just logically rejected.
    const bufferA = Buffer.from('receipt belongs to artifact A only');
    const bufferB = Buffer.from('draft is actually for artifact B');
    const hashA = computeArtifactHash(bufferA);
    const hashB = computeArtifactHash(bufferB);

    recordClassificationReceipt({
      artifactHash: hashA,
      verdict: 'eligible',
      contentTypes: ['pointer'],
      reasons: [],
      classifiedAt: new Date().toISOString(),
      classifierVersion: 'test-fixture',
    });

    registerTrainerArtifact({ artifactHash: hashB, trainerId: 'trainer-cross-hash', sizeBytes: bufferB.byteLength });
    const draftForB = createLocalDraftSubmission({
      trainerId: 'trainer-cross-hash',
      artifactHash: hashB,
      safetyClassification: classifyTrainerContentSafety([]),
    });

    const promotion = submitDraftToCommunity({
      submissionId: draftForB.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'ON',
    });
    assert.equal(promotion.ok, false, "artifact B's draft must not benefit from artifact A's eligible receipt");
    if (!promotion.ok) assert.match(promotion.error, /classification unavailable/);
  });

  test('ATTACK: sharing preference OFF blocks submitDraftToCommunity even with a genuinely eligible receipt', () => {
    const buffer = Buffer.from('eligible bytes but sharing is off');
    const hash = computeArtifactHash(buffer);
    registerTrainerArtifact({ artifactHash: hash, trainerId: 'trainer-sharing-off', sizeBytes: buffer.byteLength });
    recordClassificationReceipt({
      artifactHash: hash,
      verdict: 'eligible',
      contentTypes: ['pointer'],
      reasons: [],
      classifiedAt: new Date().toISOString(),
      classifierVersion: 'test-fixture',
    });
    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-sharing-off',
      artifactHash: hash,
      safetyClassification: classifyTrainerContentSafety([]),
    });

    const promotion = submitDraftToCommunity({
      submissionId: draft.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'OFF',
    });
    assert.equal(promotion.ok, false);
    if (!promotion.ok) assert.match(promotion.error, /sharing preference is OFF/);
    assert.equal(getCommunitySubmission(draft.submissionId)!.submissionState, 'LOCAL_DRAFT');
  });

  test('ATTACK: sharing preference ASK_ME without explicit per-item approval blocks submitDraftToCommunity', () => {
    const buffer = Buffer.from('eligible bytes but ask-me not yet approved');
    const hash = computeArtifactHash(buffer);
    registerTrainerArtifact({ artifactHash: hash, trainerId: 'trainer-ask-me', sizeBytes: buffer.byteLength });
    recordClassificationReceipt({
      artifactHash: hash,
      verdict: 'eligible',
      contentTypes: ['pointer'],
      reasons: [],
      classifiedAt: new Date().toISOString(),
      classifierVersion: 'test-fixture',
    });
    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-ask-me',
      artifactHash: hash,
      safetyClassification: classifyTrainerContentSafety([]),
    });

    const promotion = submitDraftToCommunity({
      submissionId: draft.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'ASK_ME',
    });
    assert.equal(promotion.ok, false);
    if (!promotion.ok) assert.match(promotion.error, /ASK_ME/);
  });

  test('ATTACK: forged qualification result cannot be handed to submitDraftToCommunity — it has no such parameter', () => {
    // submitDraftToCommunity's input type has no field for a pre-computed
    // UploadQualificationResult at all — there is no `as any` cast that
    // makes one appear, because the function ignores anything beyond its
    // declared identity-completeness flags and always calls
    // qualifyForUploadWithVerifiedClassification itself. This test is a
    // structural/documentation proof rather than a runtime one: attempting
    // to pass `qualifies: true` on the input object is simply extra data
    // TypeScript strips and the function never reads.
    const buffer = Buffer.from('forged-qualification-attempt');
    const hash = computeArtifactHash(buffer);
    registerTrainerArtifact({ artifactHash: hash, trainerId: 'trainer-forged-qual', sizeBytes: buffer.byteLength });
    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-forged-qual',
      artifactHash: hash,
      safetyClassification: classifyTrainerContentSafety([]),
    });

    const forgedInput = {
      submissionId: draft.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'ON' as const,
      qualifies: true, // not part of the real type; ignored
    };
    const promotion = submitDraftToCommunity(forgedInput);
    assert.equal(promotion.ok, false, 'the forged qualifies:true field must be ignored; no receipt exists for this hash');
  });

  test('RESTART: a LOCAL_DRAFT does not become Community-visible merely by reloading the database', async () => {
    const { resetForTesting, flushPersistence } = await import('../src/core/database/index.ts');
    const fsMod = await import('node:fs');
    const osMod = await import('node:os');
    const pathMod = await import('node:path');
    const dbPath = pathMod.join(fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'solith-restart-draft-')), 'test.db');
    await resetForTesting(dbPath);

    const buffer = Buffer.from('restart-persistence-fixture');
    const hash = computeArtifactHash(buffer);
    registerTrainerArtifact({ artifactHash: hash, trainerId: 'trainer-restart', sizeBytes: buffer.byteLength });
    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-restart',
      artifactHash: hash,
      safetyClassification: classifyTrainerContentSafety([]),
    });
    await flushPersistence();

    // Simulate an application restart: reopen the same on-disk database file,
    // preserving what was actually persisted rather than wiping it.
    await resetForTesting(dbPath, { preserveExisting: true });
    const reloaded = getCommunitySubmission(draft.submissionId);
    assert.ok(reloaded, 'draft row must survive a reload from the same database file');
    assert.equal(reloaded!.submissionState, 'LOCAL_DRAFT');
    assert.equal(reloaded!.trustState, null, 'a reload must never upgrade a draft into a Community-visible state');

    await resetForTesting();
  });
});
