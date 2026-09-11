/**
 * Phase 1 online-foundation, Mission 11 (+ the duplicate-submission half of
 * Mission 12) — types for the community upload trust/qualification pipeline.
 *
 * Backing table: `community_submissions` (src/core/database/index.ts
 * applySchema()). `artifactHash` references `trainer_artifacts.artifactHash`
 * (owned by a parallel Mission implementing src/core/trainer-artifact-store/)
 * as a plain string column — no runtime FK enforcement is assumed here since
 * sql.js may not enforce declared foreign keys.
 */
import type { TrainerContentClassification } from '../artifact-classification/types.js';

/**
 * Community trust-state progression. A brand-new upload is NEVER immediately
 * "Verified" — it must climb this ladder one stage at a time:
 *
 *   NEW_COMMUNITY -> AUTOMATED_CHECKS_PASSED -> COMMUNITY_CONFIRMED
 *     -> COMMUNITY_VERIFIED -> LOCALLY_VERIFIED
 */
export type CommunityTrustState =
  | 'NEW_COMMUNITY'
  | 'AUTOMATED_CHECKS_PASSED'
  | 'COMMUNITY_CONFIRMED'
  | 'COMMUNITY_VERIFIED'
  | 'LOCALLY_VERIFIED';

/**
 * Classification of what a trainer artifact's content actually is. This
 * drives the safety gate: script/executable-shaped content (autoassembler,
 * lua, other-script) must never auto-pass automated checks.
 *
 * MOVED (Phase 1.5 security closeout, Mission A2) to
 * `src/core/artifact-classification/types.ts` — it is a
 * classification-domain concept, not an upload-domain one: upload code
 * CONSUMES a classification receipt, it never derives content types itself.
 * Re-exported here so nothing that imported it from this module breaks.
 */
export type { TrainerContentClassification } from '../artifact-classification/types.js';

/**
 * Phase 2.1 security invariant closure (Mission 2) — a row's lifecycle
 * state, independent of `trustState`. A `LOCAL_DRAFT` row's `trustState` is
 * always `null`; only `submitDraftToCommunity` (store.ts) may transition a
 * row to `COMMUNITY_SUBMITTED` (at which point `trustState` becomes
 * `'NEW_COMMUNITY'`). This is what makes a draft structurally incapable of
 * being read as upload-eligible/remotely-approved/verified/queued: any
 * consumer must check `submissionState === 'COMMUNITY_SUBMITTED'` before
 * treating a row as a real Community submission at all.
 */
export type CommunitySubmissionState = 'LOCAL_DRAFT' | 'COMMUNITY_SUBMITTED';

/** Row shape for the `community_submissions` table. */
export interface CommunitySubmission {
  submissionId: string;
  gameId?: string;
  customGameId?: string;
  trainerId: string;
  artifactHash: string;
  authorLabel?: string;
  submissionState: CommunitySubmissionState;
  /** Null for a LOCAL_DRAFT; only ever set by submitDraftToCommunity. */
  trustState: CommunityTrustState | null;
  safetyClassification: SafetyClassification | null;
  /** Evidence persisted at the moment submitDraftToCommunity qualified this row. */
  qualifiedVerdict?: string;
  qualifiedClassifierVersion?: string;
  qualifiedAt?: string;
  submittedAt: string;
  updatedAt: string;
}

/** Result of classifying an artifact's declared content types for safety purposes. */
export interface SafetyClassification {
  contentTypes: TrainerContentClassification[];
  requiresManualReview: boolean;
  reasons: string[];
}

/**
 * Result of the automatic-contribution qualification decision. `qualifies:
 * true` means the automatic upload path may proceed (still gated further by
 * the sharing-preference caller); `qualifies: false` always carries a
 * `result` ('SAVE_LOCALLY' or 'COMMUNITY_UPLOAD_BLOCKED') and a plain-text
 * `reason` — an upload must never be silently dropped nor silently uploaded.
 */
export type UploadQualificationResult =
  | { qualifies: true }
  | { qualifies: false; result: 'SAVE_LOCALLY' | 'COMMUNITY_UPLOAD_BLOCKED'; reason: string };
