/**
 * Phase 1.5 security closeout, Mission A2 — the trainer-content
 * classification trust boundary.
 *
 * Prior state (per the hostile security review that spawned this mission):
 * `classifyTrainerContentSafety` and `qualifyForUpload`
 * (src/core/community-upload/) were both pure functions that trusted their
 * `contentTypes` / `safetyClassification` input completely. Nothing in the
 * codebase independently derived a `TrainerContentClassification[]` from
 * actual artifact bytes, so any caller could claim `contentTypes: []` (or
 * omit 'autoassembler' / 'lua' / 'other-script') for an artifact that was
 * genuinely script-shaped, and the upload gate would happily let it through.
 *
 * OWNER-MANDATED ARCHITECTURE for this mission:
 *
 *   RAW TRAINER ARTIFACT BYTES
 *           |
 *           v
 *   SECURITY CLASSIFICATION            (classify.ts: classifyArtifactBytes)
 *           |
 *           v
 *   VERIFIABLE CLASSIFICATION RECEIPT  (this file's ClassificationReceipt +
 *           |                           store.ts's classification_receipts
 *           |                           table)
 *           v
 *   COMMUNITY UPLOAD QUALIFICATION     (community-upload/qualification.ts)
 *
 * This module lives OUTSIDE `community-upload/` deliberately: SOLITH's
 * security/content-classification layer produces receipts, and upload code
 * only ever CONSUMES a receipt — it must never be able to self-classify.
 *
 * `TrainerContentClassification` used to be declared in
 * community-upload/types.ts. It has moved here because it is a
 * classification-domain concept, not an upload-domain one;
 * community-upload/types.ts now re-exports it so nothing downstream breaks.
 */

/** What an artifact's content actually is, once determined. */
export type TrainerContentClassification =
  | 'native-resolver'
  | 'pointer'
  | 'module-offset'
  | 'aob'
  | 'save-backed'
  | 'registry-backed'
  | 'file-backed'
  | 'autoassembler'
  | 'lua'
  | 'other-script';

/**
 * The four states a classification result MUST distinguish (owner's Mission
 * A2 spec, verbatim):
 *
 *   - 'eligible'     classified, and eligible for further policy evaluation.
 *                    NOT a synonym for "definitely safe, upload it" —
 *                    qualifyForUpload still applies its own independent
 *                    policy gates (identity, sharing preference, prohibited
 *                    content types) on top of an 'eligible' verdict.
 *   - 'unsafe'       classified, and the content is positively prohibited.
 *   - 'inconclusive' classification was attempted but could not reach a
 *                    confident verdict either way.
 *   - 'unavailable'  no classification exists at all for this artifact
 *                    (never run, or the classifier itself failed).
 *
 * Only 'eligible' may ever let an automatic upload proceed past the
 * classification gate in qualifyForUpload.
 */
export type ClassificationVerdict = 'eligible' | 'unsafe' | 'inconclusive' | 'unavailable';

/**
 * A verifiable, content-addressed classification result.
 *
 * `artifactHash` MUST be the real SHA-256 of the exact bytes that were
 * classified (trainer-artifact-store/store.ts's `computeArtifactHash`).
 * `classifyArtifactBytes` (classify.ts) always recomputes this itself from
 * the buffer it is given — it never accepts a caller-supplied hash — so a
 * receipt can never be forged to cover the wrong artifact.
 *
 * `classifierVersion` identifies which classifier produced this receipt.
 * This mission ships exactly one, `'v0-inconclusive-only'` (see classify.ts)
 * — any future classifier capable of real content-type detection MUST use a
 * different version string so a receipt's provenance is never ambiguous.
 */
export interface ClassificationReceipt {
  artifactHash: string;
  verdict: ClassificationVerdict;
  contentTypes: TrainerContentClassification[];
  reasons: string[];
  classifiedAt: string;
  classifierVersion: string;
}
