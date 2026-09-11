import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  advanceTrustState,
  createLocalDraftSubmission,
  getCommunitySubmission,
  listCommunitySubmissionsByArtifact,
  submitDraftToCommunity,
} from '../src/core/community-upload/store.ts';
import { classifyTrainerContentSafety } from '../src/core/community-upload/safety-classification.ts';
import { computeArtifactHash, registerTrainerArtifact } from '../src/core/trainer-artifact-store/store.ts';
import { recordClassificationReceipt } from '../src/core/artifact-classification/store.ts';
import type { ClassificationReceipt } from '../src/core/artifact-classification/types.ts';
import type { CommunityTrustState } from '../src/core/community-upload/types.ts';

/**
 * Phase 2.1 security invariant closure: a submission only ever reaches the
 * real Community trust-state ladder via `submitDraftToCommunity`, which
 * independently re-derives qualification from the classification_receipts
 * store by the draft's own artifactHash. Since this pass's real classifier
 * only ever produces 'inconclusive' verdicts (see artifact-classification/
 * classify.ts), these tests hand-record an 'eligible' TEST-FIXTURE receipt
 * to exercise the trust-state ladder itself — never fabricating an eligible
 * verdict from the real production classifier.
 */
function seedEligibleReceipt(hash: string): ClassificationReceipt {
  const receipt: ClassificationReceipt = {
    artifactHash: hash,
    verdict: 'eligible',
    contentTypes: ['pointer'],
    reasons: [],
    classifiedAt: new Date().toISOString(),
    classifierVersion: 'test-fixture-eligible',
  };
  return recordClassificationReceipt(receipt);
}

function makeQualifiedSubmission(trainerId: string, hashSeed: string) {
  const hash = computeArtifactHash(Buffer.from(hashSeed));
  registerTrainerArtifact({ artifactHash: hash, trainerId, sizeBytes: hashSeed.length });
  seedEligibleReceipt(hash);
  const draft = createLocalDraftSubmission({
    trainerId,
    artifactHash: hash,
    safetyClassification: classifyTrainerContentSafety(['pointer']),
  });
  const submitted = submitDraftToCommunity({
    submissionId: draft.submissionId,
    hasSchemaValidation: true,
    hasGameIdentity: true,
    hasTrainerIdentity: true,
    sharingPreference: 'ON',
  });
  assert.equal(submitted.ok, true, 'precondition: draft must qualify for these ladder tests');
  if (!submitted.ok) throw new Error('unreachable');
  return submitted.submission;
}

describe('community-upload store', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('a new local draft always starts LOCAL_DRAFT with a null trustState, even if the input shape tried to imply otherwise', () => {
    const submission = createLocalDraftSubmission({
      trainerId: 'trainer-1',
      artifactHash: 'hash-a',
      safetyClassification: classifyTrainerContentSafety(['native-resolver']),
      // @ts-expect-error — trustState/submissionState are intentionally not part of CreateLocalDraftSubmissionInput.
      trustState: 'LOCALLY_VERIFIED',
    });
    assert.equal(submission.submissionState, 'LOCAL_DRAFT');
    assert.equal(submission.trustState, null);

    const reloaded = getCommunitySubmission(submission.submissionId);
    assert.ok(reloaded);
    assert.equal(reloaded!.submissionState, 'LOCAL_DRAFT');
    assert.equal(reloaded!.trustState, null);
  });

  test('round-trips optional fields (gameId, customGameId, authorLabel) through create/get', () => {
    const submission = createLocalDraftSubmission({
      gameId: 'game-123',
      trainerId: 'trainer-2',
      artifactHash: 'hash-b',
      authorLabel: 'anon-contributor',
      safetyClassification: classifyTrainerContentSafety(['aob']),
    });
    const reloaded = getCommunitySubmission(submission.submissionId);
    assert.ok(reloaded);
    assert.equal(reloaded!.gameId, 'game-123');
    assert.equal(reloaded!.customGameId, undefined);
    assert.equal(reloaded!.authorLabel, 'anon-contributor');
    assert.deepEqual(reloaded!.safetyClassification?.contentTypes, ['aob']);
  });

  test('getCommunitySubmission returns null for an unknown id', () => {
    assert.equal(getCommunitySubmission('does-not-exist'), null);
  });

  test('submitDraftToCommunity fails closed when no classification receipt exists for the draft artifact', () => {
    const hash = computeArtifactHash(Buffer.from('never-classified-for-store-test'));
    registerTrainerArtifact({ artifactHash: hash, trainerId: 'trainer-unclassified', sizeBytes: 10 });
    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-unclassified',
      artifactHash: hash,
      safetyClassification: classifyTrainerContentSafety([]),
    });

    const result = submitDraftToCommunity({
      submissionId: draft.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'ON',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /classification unavailable/);

    const reloaded = getCommunitySubmission(draft.submissionId);
    assert.equal(reloaded!.submissionState, 'LOCAL_DRAFT');
    assert.equal(reloaded!.trustState, null);
  });

  test('submitDraftToCommunity succeeds and starts the ladder at NEW_COMMUNITY when a genuinely eligible receipt exists', () => {
    const submission = makeQualifiedSubmission('trainer-qualified', 'qualified-fixture-bytes');
    assert.equal(submission.submissionState, 'COMMUNITY_SUBMITTED');
    assert.equal(submission.trustState, 'NEW_COMMUNITY');
    assert.equal(submission.qualifiedVerdict, 'eligible');
    assert.equal(submission.qualifiedClassifierVersion, 'test-fixture-eligible');
    assert.ok(submission.qualifiedAt);
  });

  test('submitDraftToCommunity refuses to submit the same draft twice', () => {
    const hash = computeArtifactHash(Buffer.from('double-submit-fixture'));
    registerTrainerArtifact({ artifactHash: hash, trainerId: 'trainer-double-submit', sizeBytes: 10 });
    seedEligibleReceipt(hash);
    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-double-submit',
      artifactHash: hash,
      safetyClassification: classifyTrainerContentSafety(['pointer']),
    });
    const first = submitDraftToCommunity({
      submissionId: draft.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'ON',
    });
    assert.equal(first.ok, true);

    const second = submitDraftToCommunity({
      submissionId: draft.submissionId,
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      sharingPreference: 'ON',
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.error, /not a local draft/);
  });

  test('advanceTrustState refuses to advance a LOCAL_DRAFT (no ladder exists yet)', () => {
    const draft = createLocalDraftSubmission({
      trainerId: 'trainer-draft-advance',
      artifactHash: 'hash-draft-advance',
      safetyClassification: classifyTrainerContentSafety(['pointer']),
    });
    const result = advanceTrustState(draft.submissionId, 'AUTOMATED_CHECKS_PASSED');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /LOCAL_DRAFT/);
  });

  const FORWARD_ORDER: CommunityTrustState[] = [
    'NEW_COMMUNITY',
    'AUTOMATED_CHECKS_PASSED',
    'COMMUNITY_CONFIRMED',
    'COMMUNITY_VERIFIED',
    'LOCALLY_VERIFIED',
  ];

  test('trust state progression walks forward one adjacent stage at a time', () => {
    const submission = makeQualifiedSubmission('trainer-3', 'ladder-fixture-c');

    let currentId = submission.submissionId;
    for (let i = 1; i < FORWARD_ORDER.length; i++) {
      const result = advanceTrustState(currentId, FORWARD_ORDER[i]);
      assert.equal(result.ok, true, `expected ${FORWARD_ORDER[i - 1]} -> ${FORWARD_ORDER[i]} to succeed`);
      if (result.ok) {
        assert.equal(result.submission.trustState, FORWARD_ORDER[i]);
        currentId = result.submission.submissionId;
      }
    }
  });

  test('rejects a skip-ahead transition (NEW_COMMUNITY -> LOCALLY_VERIFIED)', () => {
    const submission = makeQualifiedSubmission('trainer-4', 'ladder-fixture-d');
    const result = advanceTrustState(submission.submissionId, 'LOCALLY_VERIFIED');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /invalid trust state transition/);

    const reloaded = getCommunitySubmission(submission.submissionId);
    assert.equal(reloaded!.trustState, 'NEW_COMMUNITY');
  });

  test('rejects a skip-ahead transition (NEW_COMMUNITY -> COMMUNITY_CONFIRMED)', () => {
    const submission = makeQualifiedSubmission('trainer-5', 'ladder-fixture-e');
    const result = advanceTrustState(submission.submissionId, 'COMMUNITY_CONFIRMED');
    assert.equal(result.ok, false);
  });

  test('rejects a backward transition after advancing forward', () => {
    const submission = makeQualifiedSubmission('trainer-6', 'ladder-fixture-f');
    const forward = advanceTrustState(submission.submissionId, 'AUTOMATED_CHECKS_PASSED');
    assert.equal(forward.ok, true);

    const backward = advanceTrustState(submission.submissionId, 'NEW_COMMUNITY');
    assert.equal(backward.ok, false);
    if (!backward.ok) assert.match(backward.error, /invalid trust state transition/);

    const reloaded = getCommunitySubmission(submission.submissionId);
    assert.equal(reloaded!.trustState, 'AUTOMATED_CHECKS_PASSED');
  });

  test('rejects any transition out of the terminal LOCALLY_VERIFIED state', () => {
    const submission = makeQualifiedSubmission('trainer-7', 'ladder-fixture-g');
    let id = submission.submissionId;
    for (const next of FORWARD_ORDER.slice(1)) {
      const result = advanceTrustState(id, next);
      assert.equal(result.ok, true);
      if (result.ok) id = result.submission.submissionId;
    }

    const attempt = advanceTrustState(id, 'LOCALLY_VERIFIED');
    assert.equal(attempt.ok, false);
  });

  test('advanceTrustState on an unknown submission id fails without throwing', () => {
    const result = advanceTrustState('does-not-exist', 'AUTOMATED_CHECKS_PASSED');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not found/);
  });

  test('two submissions can share one artifactHash: one artifact blob, two attribution records', () => {
    const first = createLocalDraftSubmission({
      trainerId: 'trainer-8a',
      artifactHash: 'shared-hash',
      authorLabel: 'author-one',
      safetyClassification: classifyTrainerContentSafety(['pointer']),
    });
    const second = createLocalDraftSubmission({
      trainerId: 'trainer-8b',
      artifactHash: 'shared-hash',
      authorLabel: 'author-two',
      safetyClassification: classifyTrainerContentSafety(['aob']),
    });

    const byArtifact = listCommunitySubmissionsByArtifact('shared-hash');
    assert.equal(byArtifact.length, 2);
    const ids = byArtifact.map((s) => s.submissionId).sort();
    assert.deepEqual(ids, [first.submissionId, second.submissionId].sort());
    assert.notEqual(first.submissionId, second.submissionId);
  });

  test('listCommunitySubmissionsByArtifact returns empty array for an unknown hash', () => {
    assert.deepEqual(listCommunitySubmissionsByArtifact('never-seen-hash'), []);
  });
});
