import crypto from 'node:crypto';
import db from '../database/index.js';
import { qualifyForUploadWithVerifiedClassification } from './qualification.js';
import type { SharingPreference } from './qualification.js';
import { getClassificationReceipt } from '../artifact-classification/store.js';
import type { CommunitySubmission, CommunitySubmissionState, CommunityTrustState, SafetyClassification } from './types.js';

interface CommunitySubmissionRow {
  submissionId: string;
  gameId: string | null;
  customGameId: string | null;
  trainerId: string;
  artifactHash: string;
  authorLabel: string | null;
  submissionState: CommunitySubmissionState;
  trustState: CommunityTrustState | null;
  safetyClassificationJson: string | null;
  qualifiedVerdict: string | null;
  qualifiedClassifierVersion: string | null;
  qualifiedAt: string | null;
  submittedAt: string;
  updatedAt: string;
}

/**
 * Hostile security review finding (Phase 2.1 Mission 8, P3): a corrupted
 * safetyClassificationJson blob (disk corruption, manual DB edit, future
 * migration bug) must never crash the read path with an uncaught JSON.parse
 * exception. This field is informational metadata only — it never feeds the
 * classification trust boundary — so failing closed to `null` here is safe.
 */
function parseSafetyClassificationJson(raw: string | null): SafetyClassification | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SafetyClassification;
  } catch {
    return null;
  }
}

function rowToSubmission(row: CommunitySubmissionRow): CommunitySubmission {
  return {
    submissionId: row.submissionId,
    gameId: row.gameId ?? undefined,
    customGameId: row.customGameId ?? undefined,
    trainerId: row.trainerId,
    artifactHash: row.artifactHash,
    authorLabel: row.authorLabel ?? undefined,
    submissionState: row.submissionState,
    trustState: row.trustState,
    safetyClassification: parseSafetyClassificationJson(row.safetyClassificationJson),
    qualifiedVerdict: row.qualifiedVerdict ?? undefined,
    qualifiedClassifierVersion: row.qualifiedClassifierVersion ?? undefined,
    qualifiedAt: row.qualifiedAt ?? undefined,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateLocalDraftSubmissionInput {
  gameId?: string;
  customGameId?: string;
  trainerId: string;
  artifactHash: string;
  authorLabel?: string;
  safetyClassification: SafetyClassification;
}

/**
 * Phase 2.1 security invariant closure (Mission 3) — replaces the former
 * `createCommunitySubmission`, which any caller could invoke directly to
 * manufacture a row indistinguishable from a real, qualified Community
 * submission (disclosed as a caller-discipline gap in Phase 1.5, now closed
 * for real per owner decision: "caller discipline is not sufficient for
 * this security boundary").
 *
 * This function ONLY ever inserts a `submissionState: 'LOCAL_DRAFT'` row
 * with `trustState: null`. A local draft is structurally incapable of being
 * interpreted as upload-eligible, remotely approved, verified, trusted, or
 * queued for transmission:
 *   - `trustState` is null, not 'NEW_COMMUNITY' — nothing reads a null
 *     trustState as a real Community trust-ladder position.
 *   - `submissionState` stays 'LOCAL_DRAFT' until `submitDraftToCommunity`
 *     (below) independently re-verifies qualification and flips it.
 *
 * Callers may freely create local drafts (e.g. a user drafting/testing a
 * trainer before ever sharing it) — this is intentionally unrestricted,
 * per Mission 2: "Local-only drafts may exist before classification if
 * useful."
 */
export function createLocalDraftSubmission(input: CreateLocalDraftSubmissionInput): CommunitySubmission {
  const submissionId = crypto.randomUUID();
  const initialState: CommunitySubmissionState = 'LOCAL_DRAFT';

  db.prepare(
    `INSERT INTO community_submissions (
       submissionId, gameId, customGameId, trainerId, artifactHash,
       authorLabel, submissionState, trustState, safetyClassificationJson, submittedAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'), datetime('now'))`,
  ).run(
    submissionId,
    input.gameId ?? null,
    input.customGameId ?? null,
    input.trainerId,
    input.artifactHash,
    input.authorLabel ?? null,
    initialState,
    JSON.stringify(input.safetyClassification),
  );

  const created = getCommunitySubmission(submissionId);
  if (!created) throw new Error(`Failed to persist community submission ${submissionId}`);
  return created;
}

export function getCommunitySubmission(submissionId: string): CommunitySubmission | null {
  const row = db.prepare('SELECT * FROM community_submissions WHERE submissionId = ?').get(submissionId) as
    | CommunitySubmissionRow
    | undefined;
  return row ? rowToSubmission(row) : null;
}

export interface SubmitDraftToCommunityInput {
  submissionId: string;
  hasSchemaValidation: boolean;
  hasGameIdentity: boolean;
  hasTrainerIdentity: boolean;
  sharingPreference: SharingPreference;
}

export type SubmitDraftToCommunityResult =
  | { ok: true; submission: CommunitySubmission }
  | { ok: false; error: string };

/**
 * Phase 2.1 security invariant closure (Mission 3) — the ONLY function in
 * SOLITH that may transition a `LOCAL_DRAFT` row into a real Community
 * submission (`submissionState: 'COMMUNITY_SUBMITTED'`, `trustState:
 * 'NEW_COMMUNITY'`).
 *
 * Runtime enforcement, not caller discipline: this function looks up the
 * draft's OWN persisted `artifactHash` from the database and calls
 * `qualifyForUploadWithVerifiedClassification` itself — it never accepts a
 * pre-computed `UploadQualificationResult` from the caller. A caller cannot
 * skip classification, cannot present a qualification result for a
 * different artifact, and cannot forge `qualifies: true`: the only inputs
 * this function trusts from the caller are non-security-relevant identity
 * completeness flags and the sharing preference, both of which
 * `qualifyForUploadWithVerifiedClassification`/`qualifyForUpload` re-check
 * independently.
 *
 * Fails closed (`{ ok: false }`, never throws) if the draft does not exist,
 * is not currently `LOCAL_DRAFT` (a submission may only be submitted once —
 * this also blocks re-submitting an already-submitted row), or if
 * qualification does not return `qualifies: true`.
 */
export function submitDraftToCommunity(input: SubmitDraftToCommunityInput): SubmitDraftToCommunityResult {
  const draft = getCommunitySubmission(input.submissionId);
  if (!draft) {
    return { ok: false, error: `community submission ${input.submissionId} not found` };
  }
  if (draft.submissionState !== 'LOCAL_DRAFT') {
    return {
      ok: false,
      error: `submission ${input.submissionId} is not a local draft (submissionState: ${draft.submissionState}); it cannot be submitted again`,
    };
  }

  const qualification = qualifyForUploadWithVerifiedClassification({
    hasSchemaValidation: input.hasSchemaValidation,
    hasGameIdentity: input.hasGameIdentity,
    hasTrainerIdentity: input.hasTrainerIdentity,
    hasArtifactHash: Boolean(draft.artifactHash),
    artifactHash: draft.artifactHash,
    sharingPreference: input.sharingPreference,
  });

  if (!qualification.qualifies) {
    return { ok: false, error: `qualification failed: ${qualification.reason}` };
  }

  // Re-fetch the receipt used for the decision purely to persist its evidence
  // (verdict/classifierVersion/timestamp) for audit — qualification itself
  // has already independently verified it against draft.artifactHash above.
  const receipt = getClassificationReceipt(draft.artifactHash);
  if (!receipt || receipt.verdict !== 'eligible') {
    // Defense in depth: qualification said yes, but if the receipt vanished
    // or disagrees between the two lookups, fail closed rather than persist
    // an unsupported COMMUNITY_SUBMITTED state.
    return { ok: false, error: 'classification receipt could not be re-confirmed at persistence time' };
  }

  db.prepare(
    `UPDATE community_submissions
     SET submissionState = 'COMMUNITY_SUBMITTED',
         trustState = 'NEW_COMMUNITY',
         qualifiedVerdict = ?,
         qualifiedClassifierVersion = ?,
         qualifiedAt = datetime('now'),
         updatedAt = datetime('now')
     WHERE submissionId = ? AND submissionState = 'LOCAL_DRAFT'`,
  ).run(receipt.verdict, receipt.classifierVersion, input.submissionId);

  const updated = getCommunitySubmission(input.submissionId);
  if (!updated) throw new Error(`Failed to reload community submission ${input.submissionId} after submission`);
  if (updated.submissionState !== 'COMMUNITY_SUBMITTED') {
    // The WHERE clause's submissionState guard lost a race (e.g. concurrent
    // submit) — report failure rather than claim success for a state that
    // did not actually take hold.
    return { ok: false, error: `submission ${input.submissionId} was not transitioned (concurrent modification?)` };
  }
  return { ok: true, submission: updated };
}

/**
 * Duplicate-submission query (Mission 12): two submissions can legitimately
 * share one `artifactHash` — proving one uploaded blob with two separate
 * attribution records. Ordered oldest-first.
 */
export function listCommunitySubmissionsByArtifact(artifactHash: string): CommunitySubmission[] {
  const rows = db
    .prepare('SELECT * FROM community_submissions WHERE artifactHash = ? ORDER BY submittedAt ASC, submissionId ASC')
    .all(artifactHash) as CommunitySubmissionRow[];
  return rows.map(rowToSubmission);
}

/**
 * The only forward-adjacent transitions this system recognizes. Each state
 * may only advance to the single next state in the progression — no skipping
 * ahead (e.g. NEW_COMMUNITY -> LOCALLY_VERIFIED) and no moving backward.
 */
const ALLOWED_NEXT_STATE: Record<CommunityTrustState, CommunityTrustState | null> = {
  NEW_COMMUNITY: 'AUTOMATED_CHECKS_PASSED',
  AUTOMATED_CHECKS_PASSED: 'COMMUNITY_CONFIRMED',
  COMMUNITY_CONFIRMED: 'COMMUNITY_VERIFIED',
  COMMUNITY_VERIFIED: 'LOCALLY_VERIFIED',
  LOCALLY_VERIFIED: null,
};

export type AdvanceTrustStateResult =
  | { ok: true; submission: CommunitySubmission }
  | { ok: false; error: string };

/**
 * Advances a submission's trust state by exactly one step in the defined
 * progression. Rejects (returns `{ ok: false }`, never throws) any attempt
 * to skip a stage, move backward, or move to/from an unrecognized state.
 */
export function advanceTrustState(submissionId: string, nextState: CommunityTrustState): AdvanceTrustStateResult {
  const submission = getCommunitySubmission(submissionId);
  if (!submission) {
    return { ok: false, error: `community submission ${submissionId} not found` };
  }

  if (submission.submissionState !== 'COMMUNITY_SUBMITTED' || submission.trustState === null) {
    return {
      ok: false,
      error: `submission ${submissionId} is a ${submission.submissionState} with no trust-state ladder to advance (only a submission qualified via submitDraftToCommunity has one)`,
    };
  }

  const allowedNext = ALLOWED_NEXT_STATE[submission.trustState];
  if (allowedNext !== nextState) {
    return {
      ok: false,
      error: `invalid trust state transition: ${submission.trustState} -> ${nextState} (only ${submission.trustState} -> ${allowedNext ?? '(none, already terminal)'} is allowed)`,
    };
  }

  db.prepare(`UPDATE community_submissions SET trustState = ?, updatedAt = datetime('now') WHERE submissionId = ?`).run(
    nextState,
    submissionId,
  );

  const updated = getCommunitySubmission(submissionId);
  if (!updated) throw new Error(`Failed to reload community submission ${submissionId} after trust state update`);
  return { ok: true, submission: updated };
}
