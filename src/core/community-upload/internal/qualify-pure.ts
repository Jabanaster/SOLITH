/**
 * Phase 2.1 security invariant closure (Item 2) — INTERNAL module.
 *
 * This file holds the pure, unverified qualification logic. It trusts
 * whatever `ClassificationReceipt` it is handed — it does NOT look anything
 * up from the database itself. That makes it fast and easy to unit-test
 * exhaustively (see tests/community-upload-qualification.test.ts), but also
 * means a caller with a hand-forged receipt object can make it say
 * `qualifies: true` for an artifact that was never actually classified.
 *
 * DO NOT import this file from production code. The only safe production
 * entry point is `qualifyForUploadWithVerifiedClassification` in
 * `../qualification.ts`, which looks the receipt up itself from
 * `classification_receipts` rather than trusting a caller-supplied object.
 * `qualification.ts` imports this module internally to avoid duplicating
 * the gate logic, but does not re-export it — so importing
 * `qualifyForUploadPureForTesting` requires reaching into this `internal/`
 * directory explicitly, rather than being one `qualifyForUpload` import
 * away from the safe wrapper.
 *
 * `tests/source-boundaries-qualify-pure.test.ts` statically proves no file
 * under `src/` or `electron/` (other than this file and `../qualification.ts`)
 * imports this module.
 */
import type { ClassificationReceipt, ClassificationVerdict } from '../../artifact-classification/types.js';
import type { TrainerContentClassification, UploadQualificationResult } from '../types.js';

const NEVER_AUTO_PASS: readonly TrainerContentClassification[] = ['autoassembler', 'lua', 'other-script'];

const VALID_VERDICTS: readonly ClassificationVerdict[] = ['eligible', 'unsafe', 'inconclusive', 'unavailable'];

export type SharingPreference = 'OFF' | 'ASK_ME' | 'ON';

export interface UploadQualificationInput {
  hasSchemaValidation: boolean;
  hasGameIdentity: boolean;
  hasTrainerIdentity: boolean;
  hasArtifactHash: boolean;
  /** The artifact hash actually being submitted for upload right now. */
  artifactHash: string;
  /**
   * The classification receipt to evaluate against `artifactHash`, or null
   * if none is available. This is deliberately caller-suppliable ONLY here,
   * in the internal pure module — it exists so unit tests can exercise every
   * gate independently. Real callers must never construct this value
   * themselves; see `qualifyForUploadWithVerifiedClassification` in
   * `../qualification.ts`.
   */
  classificationReceipt: ClassificationReceipt | null;
  sharingPreference: SharingPreference;
}

/**
 * Pure, unverified qualification gate. See the file-level warning above:
 * this function trusts `classificationReceipt` completely and must never be
 * imported by production code — only by tests exercising the gate logic
 * directly, and by `qualifyForUploadWithVerifiedClassification`
 * (`../qualification.ts`), which is the only production-safe caller because
 * it supplies a receipt it looked up itself rather than one handed to it.
 *
 * Models the "AUTOMATIC CONTRIBUTION" decision from the Phase 1
 * online-foundation prompt's sharing-preference gate, PLUS the
 * classification-receipt trust boundary stacked on top of it:
 *
 *   - sharingPreference 'OFF'    -> automatic upload is always blocked.
 *   - sharingPreference 'ASK_ME' -> automatic upload is always blocked too;
 *     ASK_ME means a human must explicitly confirm per item, which is a
 *     separate, user-initiated call path (not this function).
 *   - sharingPreference 'ON'     -> automatic upload may proceed, but only
 *     after every required-identity check passes AND the classification
 *     receipt says the content is 'eligible' for a hash that matches what's
 *     actually being submitted.
 *
 * `qualifies: true` additionally requires:
 *   - `classificationReceipt` is non-null (a null receipt means
 *     "classification unavailable" and fails closed)
 *   - `classificationReceipt.verdict` is one of the 4 real
 *     `ClassificationVerdict` literals — an invalid/forged value is
 *     rejected, not silently accepted
 *   - `classificationReceipt.artifactHash === artifactHash` — catches the
 *     "classify one hash, submit another" attack
 *   - `classificationReceipt.verdict === 'eligible'` — 'unsafe',
 *     'inconclusive', and 'unavailable' all block. This pass's real
 *     classifier (`classifyArtifactBytes`, classifierVersion
 *     'v0-inconclusive-only') only ever produces 'inconclusive', so with
 *     TODAY's honest classifier, NOTHING can pass this gate automatically
 *     yet. That is the correct, intentional current state — not a bug.
 *   - none of `classificationReceipt.contentTypes` is
 *     autoassembler/lua/other-script, even in the hypothetical case where a
 *     verdict somehow says 'eligible' anyway (belt-and-suspenders).
 *
 * A human-initiated explicit "Share Anyway" override flow (e.g. a user
 * consciously overriding ASK_ME or a manual-review block from the UI) is a
 * separate, out-of-scope-for-Phase-1 UI concern. This function deliberately
 * does not special-case it — it always answers "is the AUTOMATIC path
 * allowed", never "should a human be allowed to override".
 */
export function qualifyForUploadPureForTesting(input: UploadQualificationInput): UploadQualificationResult {
  const {
    hasSchemaValidation,
    hasGameIdentity,
    hasTrainerIdentity,
    hasArtifactHash,
    artifactHash,
    classificationReceipt,
    sharingPreference,
  } = input;

  if (sharingPreference === 'OFF') {
    return {
      qualifies: false,
      result: 'SAVE_LOCALLY',
      reason: 'sharing preference is OFF: automatic community upload is disabled, saving locally only',
    };
  }

  if (sharingPreference === 'ASK_ME') {
    return {
      qualifies: false,
      result: 'SAVE_LOCALLY',
      reason: 'sharing preference is ASK_ME: automatic upload requires explicit per-item confirmation, which is not modeled by this automatic-contribution check',
    };
  }

  if (!hasSchemaValidation) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: 'missing schema validation: the submission has not been validated against the trainer content schema',
    };
  }

  if (!hasGameIdentity) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: 'missing game identity: the submission could not be tied to a resolved game identity',
    };
  }

  if (!hasTrainerIdentity) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: 'missing trainer identity: the submission could not be tied to a resolved trainer identity',
    };
  }

  if (!hasArtifactHash) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: 'missing artifact hash: the submission has no verifiable artifact hash',
    };
  }

  if (!classificationReceipt) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: 'classification unavailable: no verified classification receipt exists for this artifact hash',
    };
  }

  if (!VALID_VERDICTS.includes(classificationReceipt.verdict)) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: `invalid classification verdict: '${String(classificationReceipt.verdict)}' is not a recognized verdict`,
    };
  }

  if (classificationReceipt.artifactHash !== artifactHash) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: `classification hash mismatch: the classification receipt is for artifact ${classificationReceipt.artifactHash}, but this submission is for artifact ${artifactHash}`,
    };
  }

  const prohibitedTypes = classificationReceipt.contentTypes.filter((type) => NEVER_AUTO_PASS.includes(type));
  if (prohibitedTypes.length > 0) {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: `prohibited content types present regardless of classification verdict: ${prohibitedTypes.join(', ')}`,
    };
  }

  if (classificationReceipt.verdict !== 'eligible') {
    return {
      qualifies: false,
      result: 'COMMUNITY_UPLOAD_BLOCKED',
      reason: `classification verdict is '${classificationReceipt.verdict}', not 'eligible': ${
        classificationReceipt.reasons.join('; ') || 'no further detail recorded'
      }`,
    };
  }

  return { qualifies: true };
}
