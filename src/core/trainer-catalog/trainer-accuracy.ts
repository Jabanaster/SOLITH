/**
 * Trainer accuracy model (Personal Library — Mission 7) and reverify rules
 * (Mission 9).
 *
 * STORAGE/MODEL ONLY: everything in this file is a pure, deterministic
 * function of a plain evidence object. Nothing here reads a process, touches
 * game memory, or performs any real validation — callers (a later phase)
 * gather the evidence from real events (install-discovery, live-memory
 * validation receipts, etc.) and pass it in.
 */

/**
 * Trainer/game compatibility accuracy state for a single game+trainer
 * pairing. Ordered roughly from strongest to weakest evidence, with the
 * two negative/unknown states last.
 */
export type TrainerAccuracyState =
  /**
   * There exists a real local validation receipt (Mission 8) with
   * `result: 'PASS'` for this exact game+trainer pairing, AND current
   * evidence has not changed since that receipt was recorded (Mission 9's
   * `needsReverify` check says it is still valid).
   */
  | 'LOCALLY_VERIFIED'
  /**
   * Trainer/game build evidence AGREES exactly — e.g. a matching executable
   * hash, or a matching explicit version string. Never derived from title
   * text alone; the caller must never set `exactVersionEvidence` from a
   * title-only match.
   */
  | 'EXACT_VERSION_MATCH'
  /**
   * Executable/module/title evidence strongly agrees (e.g. matching
   * executable basename plus matching canonical game identity), but the
   * exact build/version is unknown or unverified.
   */
  | 'STRONG_MATCH'
  /**
   * A trainer exists for this game, but there isn't enough evidence to
   * establish compatibility at all — weaker than STRONG_MATCH, e.g. only a
   * loose title match with no executable evidence.
   */
  | 'VERSION_UNKNOWN'
  /**
   * Was previously LOCALLY_VERIFIED, but relevant evidence has since
   * changed (see `needsReverify` below) — the prior PASS can no longer be
   * trusted without re-checking.
   */
  | 'NEEDS_REVERIFY'
  /**
   * Affirmative evidence of a MISMATCH — e.g. explicit version evidence
   * disagrees, or a prior validation receipt has `result: 'FAIL'` for
   * current evidence.
   */
  | 'INCOMPATIBLE'
  /** No usable trainer/mod-pack exists for this game at all. */
  | 'NONE';

/**
 * Plain, caller-supplied evidence for `computeTrainerAccuracy`. This
 * function performs no I/O and no game/process access — every flag must be
 * computed by the caller from real evidence (install-discovery, a
 * validation-receipts store lookup, Mission 9's `needsReverify`, etc.).
 */
export interface TrainerAccuracyEvidence {
  /** No trainer/mod-pack exists for this game at all -> short-circuits to NONE if false. */
  hasTrainer: boolean;
  /** A validation receipt with `result: 'PASS'` exists for this exact game+trainer pairing. */
  hasValidationReceipt: boolean;
  /**
   * Result of Mission 9's `needsReverify` check (negated) for that PASS
   * receipt. Ignored when `hasValidationReceipt` is false.
   */
  receiptStillValid: boolean;
  /** A PASS-turned-FAIL, or an explicit FAIL receipt, exists for current evidence. */
  receiptFailed: boolean;
  /**
   * Real hash/version evidence agrees exactly. MUST NEVER be set from
   * title text alone by the caller — this is the codebase's hard rule
   * against classifying an exact version match from title text.
   */
  exactVersionEvidence: boolean;
  /** Real hash/version evidence explicitly disagrees. */
  exactVersionMismatch: boolean;
  /** Executable/module/title evidence strongly agrees; exact version unknown. */
  strongMatchEvidence: boolean;
}

/**
 * Deterministic precedence (highest to lowest):
 *   1. !hasTrainer                                -> NONE
 *   2. receiptFailed || exactVersionMismatch       -> INCOMPATIBLE
 *   3. hasValidationReceipt && receiptStillValid   -> LOCALLY_VERIFIED
 *   4. hasValidationReceipt && !receiptStillValid  -> NEEDS_REVERIFY
 *   5. exactVersionEvidence                        -> EXACT_VERSION_MATCH
 *   6. strongMatchEvidence                         -> STRONG_MATCH
 *   7. otherwise                                   -> VERSION_UNKNOWN
 *
 * Rationale: affirmative mismatch/failure evidence always wins over any
 * positive match evidence (INCOMPATIBLE outranks EXACT_VERSION_MATCH), a
 * real local validation receipt outranks any inferred version match (a
 * receipt is stronger evidence than static hash/version comparison), and
 * EXACT_VERSION_MATCH always outranks STRONG_MATCH since it requires
 * strictly stronger evidence (see `exactVersionEvidence` doc — never set
 * from title text alone).
 *
 * Pure function: no I/O, no DB access, no game/process access.
 */
export function computeTrainerAccuracy(evidence: TrainerAccuracyEvidence): TrainerAccuracyState {
  if (!evidence.hasTrainer) return 'NONE';
  if (evidence.receiptFailed || evidence.exactVersionMismatch) return 'INCOMPATIBLE';
  if (evidence.hasValidationReceipt && evidence.receiptStillValid) return 'LOCALLY_VERIFIED';
  if (evidence.hasValidationReceipt && !evidence.receiptStillValid) return 'NEEDS_REVERIFY';
  if (evidence.exactVersionEvidence) return 'EXACT_VERSION_MATCH';
  if (evidence.strongMatchEvidence) return 'STRONG_MATCH';
  return 'VERSION_UNKNOWN';
}

/**
 * Reverify rules (Personal Library — Mission 9).
 *
 * Comparable identity/version fields carried by both a stored validation
 * receipt and the current evidence snapshot, for the purpose of deciding
 * whether a prior PASS receipt should still be trusted.
 */
export interface ReverifyComparableFields {
  executableName: string;
  executableVersion?: string;
  executableHash?: string;
  trainerSource: string;
  trainerVersionHint?: string;
}

export interface ReverifyCheckInput {
  /** The comparable fields recorded on the trusted (PASS) validation receipt. */
  receipt: ReverifyComparableFields;
  /**
   * The comparable fields observed right now, plus two additional
   * evidence-of-change signals that don't have a receipt-side counterpart.
   */
  current: ReverifyComparableFields & {
    /** True if install-discovery evidence says the canonical executable identity changed. */
    canonicalExecutableIdentityChanged?: boolean;
    /** True if evidence says the launcher build changed materially (e.g. a build/branch switch). */
    launcherBuildChangedMaterially?: boolean;
  };
}

/**
 * Returns true if a prior LOCALLY_VERIFIED receipt should be degraded to
 * NEEDS_REVERIFY given the current evidence snapshot.
 *
 * Deliberate "both present and differ" rule: for optional fields
 * (`executableVersion`, `executableHash`, `trainerVersionHint`), reverify
 * triggers ONLY when BOTH the receipt and current evidence have a value AND
 * those values differ. Missing optional evidence on either side is NOT
 * itself evidence of a change — absence of hash evidence isn't evidence
 * that the hash changed. Required fields (`executableName`,
 * `trainerSource`) are always present and compared directly.
 *
 * A normal app restart with no evidence change (every field identical,
 * both boolean flags false/undefined) returns false — this is the
 * "restart is safe" guarantee validated in the accompanying test suite.
 *
 * Pure function: no I/O, no DB access, no game/process access.
 */
export function needsReverify(input: ReverifyCheckInput): boolean {
  const { receipt, current } = input;

  if (receipt.executableName !== current.executableName) return true;
  if (receipt.trainerSource !== current.trainerSource) return true;

  if (bothPresentAndDiffer(receipt.executableVersion, current.executableVersion)) return true;
  if (bothPresentAndDiffer(receipt.executableHash, current.executableHash)) return true;
  if (bothPresentAndDiffer(receipt.trainerVersionHint, current.trainerVersionHint)) return true;

  if (current.canonicalExecutableIdentityChanged === true) return true;
  if (current.launcherBuildChangedMaterially === true) return true;

  return false;
}

function bothPresentAndDiffer(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a !== b;
}
