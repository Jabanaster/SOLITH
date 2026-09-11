import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  qualifyForUploadPureForTesting as qualifyForUpload,
  type UploadQualificationInput,
} from '../src/core/community-upload/internal/qualify-pure.ts';
import type { ClassificationReceipt } from '../src/core/artifact-classification/types.ts';

/**
 * Phase 1.5 security closeout, Mission A2 — updated for qualifyForUpload's
 * new contract.
 *
 * BEFORE: qualifyForUpload took a bare `safetyClassification:
 * SafetyClassification` supplied directly by the caller (built via
 * `classifyTrainerContentSafety(contentTypes)`), which it trusted
 * completely.
 *
 * AFTER: qualifyForUpload takes `artifactHash` (the identity of what's
 * actually being submitted) + `classificationReceipt: ClassificationReceipt
 * | null` (a verifiable receipt to check against it). These tests build
 * receipts directly (this file exercises the pure function, not the
 * database-backed `qualifyForUploadWithVerifiedClassification` wrapper —
 * see tests/community-upload-classification-trust-boundary.test.ts for
 * that).
 *
 * Because this pass's real classifier (`classifyArtifactBytes`,
 * classifierVersion 'v0-inconclusive-only') only ever produces
 * 'inconclusive', a receipt with `verdict: 'eligible'` cannot honestly be
 * produced by the real classifier yet. To keep testing the OTHER gates
 * (identity checks, sharing preference, prohibited content types)
 * independently of that fact, these tests construct 'eligible' receipts by
 * hand where needed — this is legitimate for unit-testing the pure
 * function's logic, and is explicitly why `qualifyForUpload` itself must
 * never be treated as the trusted caller-facing entry point (that's
 * `qualifyForUploadWithVerifiedClassification`, covered in the trust
 * boundary test file).
 */

const ARTIFACT_HASH = 'a'.repeat(64);

function eligibleReceipt(contentTypes: ClassificationReceipt['contentTypes'] = ['native-resolver']): ClassificationReceipt {
  return {
    artifactHash: ARTIFACT_HASH,
    verdict: 'eligible',
    contentTypes,
    reasons: [],
    classifiedAt: new Date().toISOString(),
    classifierVersion: 'test-fixture',
  };
}

function baseInput(overrides: Partial<UploadQualificationInput> = {}): UploadQualificationInput {
  return {
    hasSchemaValidation: true,
    hasGameIdentity: true,
    hasTrainerIdentity: true,
    hasArtifactHash: true,
    artifactHash: ARTIFACT_HASH,
    classificationReceipt: eligibleReceipt(),
    sharingPreference: 'ON',
    ...overrides,
  };
}

describe('qualifyForUpload', () => {
  test('OFF sharing preference always blocks automatic upload, even with a fully clean submission', () => {
    const result = qualifyForUpload(baseInput({ sharingPreference: 'OFF' }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'SAVE_LOCALLY');
      assert.match(result.reason, /OFF/);
    }
  });

  test('ASK_ME sharing preference blocks the automatic path', () => {
    const result = qualifyForUpload(baseInput({ sharingPreference: 'ASK_ME' }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'SAVE_LOCALLY');
      assert.match(result.reason, /ASK_ME/);
    }
  });

  test('missing schema validation blocks even with ON preference and full identity', () => {
    const result = qualifyForUpload(baseInput({ hasSchemaValidation: false }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /schema validation/);
    }
  });

  test('missing game identity blocks upload', () => {
    const result = qualifyForUpload(baseInput({ hasGameIdentity: false }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /game identity/);
    }
  });

  test('missing trainer identity blocks upload', () => {
    const result = qualifyForUpload(baseInput({ hasTrainerIdentity: false }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /trainer identity/);
    }
  });

  test('missing artifact hash blocks upload', () => {
    const result = qualifyForUpload(baseInput({ hasArtifactHash: false }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /artifact hash/);
    }
  });

  test('autoassembler content always blocks the automatic path, even with an eligible verdict', () => {
    const result = qualifyForUpload(baseInput({ classificationReceipt: eligibleReceipt(['autoassembler']) }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /autoassembler/);
    }
  });

  test('lua content always blocks the automatic path', () => {
    const result = qualifyForUpload(baseInput({ classificationReceipt: eligibleReceipt(['lua']) }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
  });

  test('other-script content always blocks the automatic path', () => {
    const result = qualifyForUpload(baseInput({ classificationReceipt: eligibleReceipt(['other-script']) }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
  });

  test('a fully clean native-resolver submission with an eligible receipt, ON preference, and full identity qualifies', () => {
    const result = qualifyForUpload(baseInput({ classificationReceipt: eligibleReceipt(['native-resolver']) }));
    assert.equal(result.qualifies, true);
  });

  test('a fully clean aob submission with an eligible receipt qualifies', () => {
    const result = qualifyForUpload(baseInput({ classificationReceipt: eligibleReceipt(['aob']) }));
    assert.equal(result.qualifies, true);
  });

  test('a fully clean pointer submission with an eligible receipt qualifies', () => {
    const result = qualifyForUpload(baseInput({ classificationReceipt: eligibleReceipt(['pointer']) }));
    assert.equal(result.qualifies, true);
  });

  test('a null classification receipt (unavailable) blocks upload', () => {
    const result = qualifyForUpload(baseInput({ classificationReceipt: null }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /classification unavailable/);
    }
  });

  test("a receipt with verdict 'unsafe' blocks upload", () => {
    const result = qualifyForUpload(
      baseInput({ classificationReceipt: { ...eligibleReceipt(), verdict: 'unsafe' } }),
    );
    assert.equal(result.qualifies, false);
    if (!result.qualifies) assert.match(result.reason, /unsafe/);
  });

  test("a receipt with verdict 'inconclusive' blocks upload (today's real classifier only ever produces this)", () => {
    const result = qualifyForUpload(
      baseInput({ classificationReceipt: { ...eligibleReceipt(), verdict: 'inconclusive' } }),
    );
    assert.equal(result.qualifies, false);
    if (!result.qualifies) assert.match(result.reason, /inconclusive/);
  });

  test('a receipt whose artifactHash does not match the submitted artifactHash blocks upload with a specific reason', () => {
    const result = qualifyForUpload(
      baseInput({ classificationReceipt: { ...eligibleReceipt(), artifactHash: 'b'.repeat(64) } }),
    );
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /hash mismatch/);
    }
  });

  test('a forged/invalid verdict value (simulating a compromised or buggy caller) is rejected, not accepted', () => {
    const forgedReceipt = { ...eligibleReceipt(), verdict: 'definitely-safe-trust-me' } as unknown as ClassificationReceipt;
    const result = qualifyForUpload(baseInput({ classificationReceipt: forgedReceipt }));
    assert.equal(result.qualifies, false);
    if (!result.qualifies) {
      assert.equal(result.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(result.reason, /invalid classification verdict/);
    }
  });
});
