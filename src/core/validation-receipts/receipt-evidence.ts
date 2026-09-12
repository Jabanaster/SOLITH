/**
 * Validation-receipts -> trainer-accuracy evidence bridge (Mission 6,
 * hostile-review follow-up: closing the "hasValidationReceipt is always
 * hardcoded false" gap).
 *
 * PURE / NO I/O: this module never touches the database, a process, or game
 * memory. It only translates a `ValidationReceipt` the caller already looked
 * up (via `validation-receipts/store.ts`) plus a plain "current evidence"
 * snapshot into the three `TrainerAccuracyEvidence` fields that describe a
 * receipt (`hasValidationReceipt`, `receiptStillValid`, `receiptFailed`).
 *
 * It deliberately does NOT reimplement the reverify decision — "is this PASS
 * receipt still trustworthy given what's true right now" is entirely
 * `needsReverify`'s call (see `trainer-catalog/trainer-accuracy.ts`). This
 * module only decides which receipt fields to feed into that existing rule,
 * based on the receipt's own `result`.
 */
import type { ValidationReceipt } from './store.js';
import { needsReverify, type ReverifyComparableFields } from '../trainer-catalog/trainer-accuracy.js';

export interface ReceiptDerivedEvidence {
  /** A validation receipt with `result: 'PASS'` exists for this exact game+trainer pairing. */
  hasValidationReceipt: boolean;
  /** Only meaningful when `hasValidationReceipt` is true — negated `needsReverify`. */
  receiptStillValid: boolean;
  /** A PASS-turned-FAIL, or an explicit FAIL receipt, exists for current evidence. */
  receiptFailed: boolean;
}

/**
 * Derives the receipt-shaped slice of `TrainerAccuracyEvidence` from the most
 * recent receipt for a game+trainer pairing (typically `getLatestReceipt`'s
 * return value) and the current comparable evidence snapshot.
 *
 * Result mapping (per `ValidationReceipt['result']`):
 *  - no receipt at all                -> no receipt evidence at all (all false)
 *  - `'FAIL'`                          -> `receiptFailed: true` (INCOMPATIBLE,
 *    per computeTrainerAccuracy's precedence — a failure is never silently
 *    dropped to VERSION_UNKNOWN)
 *  - `'STALE'`                         -> treated as no usable receipt; a
 *    stale/inconclusive result is neither a trusted PASS nor an affirmative
 *    FAIL, so it must never fabricate LOCALLY_VERIFIED or INCOMPATIBLE
 *  - `'PASS'`                          -> `hasValidationReceipt: true`, with
 *    `receiptStillValid` set to the negation of the EXISTING `needsReverify`
 *    check against `current` (never reimplemented here)
 */
export function deriveReceiptEvidence(
  latestReceipt: ValidationReceipt | null,
  current: ReverifyComparableFields,
): ReceiptDerivedEvidence {
  if (!latestReceipt) {
    return { hasValidationReceipt: false, receiptStillValid: false, receiptFailed: false };
  }

  if (latestReceipt.result === 'FAIL') {
    return { hasValidationReceipt: false, receiptStillValid: false, receiptFailed: true };
  }

  if (latestReceipt.result === 'STALE') {
    return { hasValidationReceipt: false, receiptStillValid: false, receiptFailed: false };
  }

  // result === 'PASS'
  const receiptComparableFields: ReverifyComparableFields = {
    executableName: latestReceipt.executableName,
    executableVersion: latestReceipt.executableVersion,
    executableHash: latestReceipt.executableHash,
    trainerSource: latestReceipt.trainerSource,
    trainerVersionHint: latestReceipt.trainerVersionHint,
  };
  const staleReceipt = needsReverify({ receipt: receiptComparableFields, current });
  return { hasValidationReceipt: true, receiptStillValid: !staleReceipt, receiptFailed: false };
}
