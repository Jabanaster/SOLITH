/**
 * Public production entry point for Community upload qualification.
 *
 * Phase 2.1 security invariant closure (Item 2): the pure, unverified gate
 * logic used to live in this file as `qualifyForUpload`, directly importable
 * with a hand-forged `ClassificationReceipt` object by any future code that
 * bypassed the DB-backed wrapper below. It has moved to
 * `./internal/qualify-pure.ts` (deliberately named and located to signal
 * "do not import this from production code") and this file no longer
 * re-exports it — the ONLY thing production code can reach from this module
 * is `qualifyForUploadWithVerifiedClassification`, which looks its own
 * receipt up from `classification_receipts` rather than trusting anything a
 * caller hands it.
 *
 * `tests/source-boundaries-qualify-pure.test.ts` statically proves no file
 * under `src/` or `electron/` other than this one imports the internal pure
 * module.
 */
import { getClassificationReceipt } from '../artifact-classification/store.js';
import { qualifyForUploadPureForTesting } from './internal/qualify-pure.js';
import type { UploadQualificationInput } from './internal/qualify-pure.js';
import type { UploadQualificationResult } from './types.js';

export type { SharingPreference, UploadQualificationInput } from './internal/qualify-pure.js';

/**
 * The real caller-facing entry point (impure). Looks up the classification
 * receipt for `artifactHash` itself from the `classification_receipts`
 * store (via `getClassificationReceipt`) instead of trusting a receipt
 * object handed to it by the caller — so a caller cannot fabricate an
 * in-memory `ClassificationReceipt` claiming `verdict: 'eligible'` without
 * it having actually been produced by `classifyArtifactBytes` and recorded
 * by `recordClassificationReceipt`.
 *
 * Any real call site deciding whether to automatically upload a submission
 * MUST use this function — it is the only qualification function this
 * module exposes.
 */
export function qualifyForUploadWithVerifiedClassification(
  input: Omit<UploadQualificationInput, 'classificationReceipt'>,
): UploadQualificationResult {
  const classificationReceipt = getClassificationReceipt(input.artifactHash);
  return qualifyForUploadPureForTesting({ ...input, classificationReceipt });
}
