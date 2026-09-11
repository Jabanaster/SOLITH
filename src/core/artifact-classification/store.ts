/**
 * Phase 1.5 security closeout, Mission A2 — persistence for verifiable
 * classification receipts.
 *
 * Backing table: `classification_receipts` (src/core/database/index.ts
 * applySchema()), PRIMARY KEY on `artifactHash` — following the same
 * CREATE TABLE IF NOT EXISTS pattern used for `trainer_artifacts` /
 * `community_submissions`.
 *
 * A receipt recorded here is what `qualifyForUploadWithVerifiedClassification`
 * (community-upload/qualification.ts) actually consults — never an
 * in-memory `ClassificationReceipt` object handed to it directly by a
 * caller. That is the whole point of the trust boundary: a caller cannot
 * fabricate `verdict: 'eligible'` without it having genuinely been produced
 * by classify.ts and persisted here first.
 */
import db from '../database/index.js';
import type { ClassificationReceipt, ClassificationVerdict, TrainerContentClassification } from './types.js';

interface ClassificationReceiptRow {
  artifactHash: string;
  verdict: string;
  contentTypesJson: string;
  reasonsJson: string;
  classifiedAt: string;
  classifierVersion: string;
}

/**
 * Hostile security review finding (Phase 2.1 Mission 8, P3): a corrupted
 * contentTypesJson/reasonsJson blob must never crash the read path, and —
 * because this row feeds the classification trust boundary directly — must
 * never be silently coerced into something that could look 'eligible'.
 * Returns null on any parse failure so the caller (getClassificationReceipt)
 * reports "no receipt found", which qualifyForUpload already fails closed
 * on via its "classification unavailable" branch.
 */
function rowToReceipt(row: ClassificationReceiptRow): ClassificationReceipt | null {
  try {
    return {
      artifactHash: row.artifactHash,
      verdict: row.verdict as ClassificationVerdict,
      contentTypes: JSON.parse(row.contentTypesJson) as TrainerContentClassification[],
      reasons: JSON.parse(row.reasonsJson) as string[],
      classifiedAt: row.classifiedAt,
      classifierVersion: row.classifierVersion,
    };
  } catch {
    return null;
  }
}

/**
 * Records a classification receipt, keyed by `artifactHash`.
 *
 * IMMUTABILITY POLICY: a receipt is immutable once recorded for a given
 * hash.
 *   - Re-recording the SAME (verdict, contentTypes, classifierVersion) for a
 *     hash that already has a receipt is treated as an idempotent no-op —
 *     re-classifying identical bytes with the same classifier version
 *     naturally reproduces the same result, and callers should not have to
 *     special-case "already classified".
 *   - Re-recording a DIFFERENT (verdict, contentTypes, classifierVersion)
 *     for a hash that already has a receipt is REJECTED (throws). Silently
 *     overwriting a stored receipt would undermine the entire point of
 *     tying a receipt to content identity — anything already relying on the
 *     old receipt would have the ground shift under it. Deliberately
 *     upgrading a hash's classification (e.g. a new classifierVersion
 *     becoming available) is out of scope for this pass; today, one
 *     artifact hash has at most one recorded receipt, ever.
 */
export function recordClassificationReceipt(receipt: ClassificationReceipt): ClassificationReceipt {
  const existing = getClassificationReceipt(receipt.artifactHash);
  if (existing) {
    const sortedExistingTypes = JSON.stringify([...existing.contentTypes].sort());
    const sortedNewTypes = JSON.stringify([...receipt.contentTypes].sort());
    const isIdenticalResult =
      existing.verdict === receipt.verdict &&
      existing.classifierVersion === receipt.classifierVersion &&
      sortedExistingTypes === sortedNewTypes;

    if (isIdenticalResult) return existing;

    throw new Error(
      `classification receipt for artifact ${receipt.artifactHash} already exists and disagrees with the new ` +
        `receipt (existing: verdict=${existing.verdict} classifierVersion=${existing.classifierVersion}; ` +
        `new: verdict=${receipt.verdict} classifierVersion=${receipt.classifierVersion}) — classification ` +
        'receipts are immutable per artifact hash',
    );
  }

  db.prepare(
    `INSERT INTO classification_receipts (artifactHash, verdict, contentTypesJson, reasonsJson, classifiedAt, classifierVersion)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    receipt.artifactHash,
    receipt.verdict,
    JSON.stringify(receipt.contentTypes),
    JSON.stringify(receipt.reasons),
    receipt.classifiedAt,
    receipt.classifierVersion,
  );

  const stored = getClassificationReceipt(receipt.artifactHash);
  if (!stored) throw new Error(`Failed to persist classification receipt for artifact ${receipt.artifactHash}`);
  return stored;
}

export function getClassificationReceipt(artifactHash: string): ClassificationReceipt | null {
  const row = db.prepare(`SELECT * FROM classification_receipts WHERE artifactHash = ?`).get(artifactHash) as
    | ClassificationReceiptRow
    | undefined;
  return row ? rowToReceipt(row) : null;
}
