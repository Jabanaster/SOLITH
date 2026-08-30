import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authorizePath, reauthorizeBeforeCommit, type FileIdentity } from './handle-path-authorization';
import { acquireFileLock, releaseFileLock } from './file-lock';

/**
 * MP-P0.4 — MutationTransactionService.
 *
 * The single authoritative pipeline for certified file mutation: authorization,
 * identity binding, durable backup, durable journal, temp write + validation,
 * pre-commit revalidation, atomic replace, final verification, durable receipt,
 * and startup recovery classification.
 *
 * This does NOT wrap atomic-write.ts. atomic-write.ts remains in place for its
 * existing DB-backed operation/backup bookkeeping; this service is a parallel,
 * self-contained durable pipeline that new and migrated mutation callers use
 * directly. Consolidating the two is out of scope for MP-P0.4.
 *
 * Concurrency coordination reuses file-lock.ts's in-process lock, keyed on the
 * lexically-canonical target path. This is a same-process mutex only — it does
 * not protect against a second Solith process instance racing the same file.
 * That is a known, disclosed limitation, not a silent gap.
 */

export type TransactionState =
  | 'PREPARING'
  | 'AUTHORIZED'
  | 'BACKUP_COMPLETE'
  | 'JOURNALED'
  | 'TEMP_WRITTEN'
  | 'TEMP_VERIFIED'
  | 'REVALIDATED'
  | 'REPLACING'
  | 'FINAL_VERIFIED'
  | 'COMMITTED'
  | 'ABORTED'
  | 'RECOVERY_REQUIRED';

const JOURNAL_SCHEMA_VERSION = 1 as const;

export interface JournalRecord {
  schemaVersion: 1;
  transactionId: string;
  provider: string;
  state: TransactionState;
  targetPath: string;
  identity: FileIdentity;
  originalHash: string;
  originalSize: number;
  backupPath: string;
  tempPath?: string;
  expectedOutputHash?: string;
  finalHash?: string;
  failureReason?: string;
  startedAt: string;
  updatedAt: string;
}

export interface TransactionReceipt {
  schemaVersion: 1;
  transactionId: string;
  provider: string;
  targetPath: string;
  identity: FileIdentity;
  originalHash: string;
  finalHash: string;
  backupPath: string;
  startedAt: string;
  committedAt: string;
  journalVersion: 1;
  status: 'COMMITTED';
}

/** Test-only failure injection point identifiers. See maybeInject() below. */
export type FailurePoint =
  | 'authorization'
  | 'preimage'
  | 'backup_write'
  | 'backup_verify'
  | 'journal_write'
  | 'temp_write'
  | 'temp_flush'
  | 'temp_validate'
  | 'pre_replace_revalidation'
  | 'replace'
  | 'final_verification'
  | 'receipt_write';

export interface MutationRequest {
  /** Absolute path to the file being mutated. */
  targetPath: string;
  /** Roots this target must resolve within (passed through to authorizePath). */
  approvedRoots: string[];
  /** Identifies the calling provider/subsystem; recorded in journal + receipt. */
  provider: string;
  /** Root under which this service stores its durable backups/journal/receipts. */
  durableRoot: string;
  /**
   * Pure transform: receives the original file bytes, returns the new file bytes.
   * Must throw to abort the transaction (e.g. optimistic-concurrency / preimage
   * mismatch, field not found). Runs once, during the preimage-verification step.
   */
  produceContent: (original: Buffer) => Buffer;
  /**
   * Optional roundtrip/structural validation of the produced content, run against
   * the flushed temp file's bytes before the pre-commit revalidation step. Should
   * throw on invalid content. Required by the plan wherever a provider exposes
   * roundtrip parsing.
   */
  validateContent?: (produced: Buffer) => void;
  /** Test-only. Ignored unless NODE_ENV=test or NODE_TEST_CONTEXT is set. */
  injectFailure?: (point: FailurePoint) => void;
}

export class TransactionAbortedError extends Error {
  readonly transactionId: string;
  readonly point: FailurePoint | 'validate_request';

  constructor(transactionId: string, point: FailurePoint | 'validate_request', message: string) {
    super(message);
    this.name = 'TransactionAbortedError';
    this.transactionId = transactionId;
    this.point = point;
  }
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
}

function maybeInject(request: MutationRequest, point: FailurePoint): void {
  if (!isTestRuntime() || !request.injectFailure) return;
  request.injectFailure(point);
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function recoveryDir(durableRoot: string, sub: 'backups' | 'transactions' | 'receipts'): string {
  return path.join(durableRoot, 'recovery', sub);
}

function atomicWriteJson(targetPath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, targetPath);
}

function journalPath(durableRoot: string, transactionId: string): string {
  return path.join(recoveryDir(durableRoot, 'transactions'), `${transactionId}.json`);
}

function backupPathFor(durableRoot: string, transactionId: string): string {
  return path.join(recoveryDir(durableRoot, 'backups'), `${transactionId}.bak`);
}

function receiptPathFor(durableRoot: string, transactionId: string): string {
  return path.join(recoveryDir(durableRoot, 'receipts'), `${transactionId}.json`);
}

function persistJournal(durableRoot: string, record: JournalRecord): void {
  atomicWriteJson(journalPath(durableRoot, record.transactionId), record);
}

function validateRequestShape(request: MutationRequest): void {
  if (!request.targetPath || !path.isAbsolute(request.targetPath)) {
    throw new Error('mutation_request_invalid: targetPath must be an absolute path');
  }
  if (!Array.isArray(request.approvedRoots) || request.approvedRoots.length === 0) {
    throw new Error('mutation_request_invalid: approvedRoots must be a non-empty array');
  }
  if (!request.provider || typeof request.provider !== 'string') {
    throw new Error('mutation_request_invalid: provider must be a non-empty string');
  }
  if (!request.durableRoot || !path.isAbsolute(request.durableRoot)) {
    throw new Error('mutation_request_invalid: durableRoot must be an absolute path');
  }
  if (typeof request.produceContent !== 'function') {
    throw new Error('mutation_request_invalid: produceContent must be a function');
  }
}

/**
 * Runs one certified mutation transaction end-to-end per the MP-P0.4 pipeline.
 * Throws TransactionAbortedError (or the underlying error) on any failure; a
 * thrown error always corresponds to either ABORTED (no partial durable
 * state beyond an already-verified, harmless backup) or RECOVERY_REQUIRED
 * (persisted to the journal) depending on how far the pipeline progressed.
 */
export function runMutationTransaction(request: MutationRequest): TransactionReceipt {
  // 2. Validate request schema.
  validateRequestShape(request);

  const transactionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let lockAcquired = false;
  let lockKey = '';
  let tmpPath = '';
  let journaled = false;

  try {
    // 3+4. Bind to approved root / acquire P0.5 handle authorization.
    maybeInject(request, 'authorization');
    const authorization = authorizePath(request.targetPath, request.approvedRoots);
    if (!authorization.authorized || !authorization.identity || authorization.fd === undefined || !authorization.canonicalPath) {
      throw new TransactionAbortedError(transactionId, 'authorization', authorization.reason || 'Path authorization failed.');
    }
    const canonicalPath = authorization.canonicalPath;
    const identity = authorization.identity;
    fs.closeSync(authorization.fd);

    // 6. Per-target transaction coordination — reject silent races outright.
    lockKey = canonicalPath;
    lockAcquired = acquireFileLock(lockKey);
    if (!lockAcquired) {
      throw new TransactionAbortedError(
        transactionId,
        'authorization',
        `Target "${path.basename(canonicalPath)}" already has an active mutation transaction.`,
      );
    }

    // 5. Capture preimage identity/size/hash.
    const originalBuffer = fs.readFileSync(canonicalPath);
    const originalHash = sha256(originalBuffer);
    const originalSize = originalBuffer.length;

    // 7. Revalidate current preimage + run the provider's transform (which is
    // where optimistic-concurrency / "value changed since proposal" checks live).
    maybeInject(request, 'preimage');
    const producedBuffer = request.produceContent(originalBuffer);

    // 8-10. Create + flush + hash-verify durable backup BEFORE journaling.
    const backupPath = backupPathFor(request.durableRoot, transactionId);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    maybeInject(request, 'backup_write');
    fs.writeFileSync(backupPath, originalBuffer);
    maybeInject(request, 'backup_verify');
    const backupHash = sha256(fs.readFileSync(backupPath));
    if (backupHash !== originalHash) {
      fs.unlinkSync(backupPath);
      throw new TransactionAbortedError(transactionId, 'backup_verify', 'Backup hash mismatch — backup corrupted during write.');
    }

    // 11. Persist durable transaction journal BEFORE any irreversible replacement work.
    const baseRecord: JournalRecord = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      transactionId,
      provider: request.provider,
      state: 'JOURNALED',
      targetPath: canonicalPath,
      identity,
      originalHash,
      originalSize,
      backupPath,
      startedAt,
      updatedAt: new Date().toISOString(),
    };
    maybeInject(request, 'journal_write');
    persistJournal(request.durableRoot, baseRecord);
    journaled = true;

    // 12-13. Generate + flush temporary output.
    tmpPath = path.join(path.dirname(canonicalPath), `${path.basename(canonicalPath)}.solith-txn-${transactionId}.tmp`);
    maybeInject(request, 'temp_write');
    fs.writeFileSync(tmpPath, producedBuffer);
    maybeInject(request, 'temp_flush');
    const tempHash = sha256(fs.readFileSync(tmpPath));

    persistJournal(request.durableRoot, {
      ...baseRecord,
      state: 'TEMP_WRITTEN',
      tempPath: tmpPath,
      expectedOutputHash: tempHash,
      updatedAt: new Date().toISOString(),
    });

    // 14. Validate produced content (roundtrip parsing where the provider has one).
    maybeInject(request, 'temp_validate');
    if (request.validateContent) {
      request.validateContent(fs.readFileSync(tmpPath));
    }

    persistJournal(request.durableRoot, {
      ...baseRecord,
      state: 'TEMP_VERIFIED',
      tempPath: tmpPath,
      expectedOutputHash: tempHash,
      updatedAt: new Date().toISOString(),
    });

    // 15-17. Re-run P0.5 authorization immediately before replacement; abort if
    // anything about the target changed externally since step 4. Identity
    // (dev/ino) alone is not enough — MP-P0.6: a same-inode in-place rewrite by
    // an external process (same dev/ino, different bytes) would pass identity
    // revalidation but silently discard that process's edit when we replace.
    // The plan's step 16 explicitly requires verifying "expected preimage" in
    // addition to identity, so re-hash the live content here too.
    maybeInject(request, 'pre_replace_revalidation');
    const revalidation = reauthorizeBeforeCommit(canonicalPath, identity);
    let preimageChanged = false;
    if (revalidation.valid) {
      const liveHash = sha256(fs.readFileSync(canonicalPath));
      preimageChanged = liveHash !== originalHash;
    }
    if (!revalidation.valid || preimageChanged) {
      // Replace has not happened yet — the original file is untouched, so this is
      // a genuinely safe abort, not a recovery-required state.
      const reason = !revalidation.valid
        ? revalidation.reason || 'identity mismatch'
        : 'Preimage changed externally since capture (content modified in place on the same file identity).';
      persistJournal(request.durableRoot, {
        ...baseRecord,
        state: 'ABORTED',
        tempPath: undefined,
        expectedOutputHash: tempHash,
        failureReason: `Pre-commit revalidation failed: ${reason}`,
        updatedAt: new Date().toISOString(),
      });
      throw new TransactionAbortedError(transactionId, 'pre_replace_revalidation', reason);
    }

    persistJournal(request.durableRoot, {
      ...baseRecord,
      state: 'REVALIDATED',
      tempPath: tmpPath,
      expectedOutputHash: tempHash,
      updatedAt: new Date().toISOString(),
    });

    // 18. Atomic replacement.
    maybeInject(request, 'replace');
    persistJournal(request.durableRoot, {
      ...baseRecord,
      state: 'REPLACING',
      tempPath: tmpPath,
      expectedOutputHash: tempHash,
      updatedAt: new Date().toISOString(),
    });
    fs.renameSync(tmpPath, canonicalPath);
    tmpPath = '';

    // 19-20. Reopen/re-authorize final target and verify expected output hash.
    maybeInject(request, 'final_verification');
    const finalHash = sha256(fs.readFileSync(canonicalPath));
    if (finalHash !== tempHash) {
      // The replace already happened — this is not a safe rollback point.
      // Mark RECOVERY_REQUIRED rather than attempting to silently restore.
      persistJournal(request.durableRoot, {
        ...baseRecord,
        state: 'RECOVERY_REQUIRED',
        tempPath: undefined,
        expectedOutputHash: tempHash,
        finalHash,
        failureReason: 'Final hash mismatch after replacement.',
        updatedAt: new Date().toISOString(),
      });
      throw new TransactionAbortedError(transactionId, 'final_verification', 'Final replacement verification failed: hash mismatch.');
    }

    persistJournal(request.durableRoot, {
      ...baseRecord,
      state: 'FINAL_VERIFIED',
      tempPath: undefined,
      expectedOutputHash: tempHash,
      finalHash,
      updatedAt: new Date().toISOString(),
    });

    // 21. Persist durable receipt.
    const committedAt = new Date().toISOString();
    const receipt: TransactionReceipt = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      transactionId,
      provider: request.provider,
      targetPath: canonicalPath,
      identity,
      originalHash,
      finalHash,
      backupPath,
      startedAt,
      committedAt,
      journalVersion: JOURNAL_SCHEMA_VERSION,
      status: 'COMMITTED',
    };
    maybeInject(request, 'receipt_write');
    atomicWriteJson(receiptPathFor(request.durableRoot, transactionId), receipt);

    // 22. Mark transaction COMMITTED.
    persistJournal(request.durableRoot, {
      ...baseRecord,
      state: 'COMMITTED',
      tempPath: undefined,
      expectedOutputHash: tempHash,
      finalHash,
      updatedAt: committedAt,
    });

    return receipt;
  } catch (error) {
    if (journaled) {
      // Best-effort terminal marker for anything that got far enough to journal but
      // didn't already record a more specific terminal state above. Whether it is
      // safe to call this ABORTED depends entirely on whether the physical replace
      // (fs.renameSync) had already happened: REPLACING/FINAL_VERIFIED mean the
      // target file was mutated and the failure occurred with unverified/uncertain
      // content in place — that must never be labeled ABORTED (which implies the
      // original was untouched). Anything strictly before REPLACING is genuinely safe.
      try {
        const existing = readJournalRecord(journalPath(request.durableRoot, transactionId));
        if (existing && existing.state !== 'COMMITTED' && existing.state !== 'RECOVERY_REQUIRED' && existing.state !== 'ABORTED') {
          const replaceMayHaveHappened = existing.state === 'REPLACING' || existing.state === 'FINAL_VERIFIED';
          persistJournal(request.durableRoot, {
            ...existing,
            state: replaceMayHaveHappened ? 'RECOVERY_REQUIRED' : 'ABORTED',
            failureReason: String(error),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {
        // Journal itself is unreadable/corrupt — leave as-is for recovery classification.
      }
    }
    throw error;
  } finally {
    // 24. Safely clean eligible temp artifact (only ours, only if replace never happened).
    if (tmpPath && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure — recovery will classify any leftover on next startup.
      }
    }
    // 23. Release coordination.
    if (lockAcquired) {
      releaseFileLock(lockKey);
    }
  }
}

function readJournalRecord(filePath: string): JournalRecord | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidJournalRecord(parsed)) return null;
  return parsed;
}

function isValidJournalRecord(value: unknown): value is JournalRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === JOURNAL_SCHEMA_VERSION &&
    typeof v.transactionId === 'string' &&
    typeof v.provider === 'string' &&
    typeof v.state === 'string' &&
    typeof v.targetPath === 'string' &&
    typeof v.originalHash === 'string' &&
    typeof v.backupPath === 'string' &&
    typeof v.startedAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    !!v.identity &&
    typeof (v.identity as FileIdentity).dev === 'number' &&
    typeof (v.identity as FileIdentity).ino === 'number'
  );
}

export type RecoveryClassification = 'SAFE_ABORT' | 'ALREADY_COMMITTED' | 'RECOVERY_REQUIRED' | 'CORRUPT_RECORD';

export interface RecoveryReport {
  transactionId: string;
  journalFile: string;
  classification: RecoveryClassification;
  detail: string;
  cleanedTemp?: boolean;
}

const TERMINAL_STATES: ReadonlySet<TransactionState> = new Set(['COMMITTED', 'ABORTED']);

/**
 * Scans the durable transactions directory and classifies every non-terminal
 * journal. Never mutates the original or the backup. The only mutation this
 * function performs is deleting a leftover Solith-owned temp file when the
 * journal proves that deletion is unambiguously safe (SAFE_ABORT). Safe to
 * call multiple times — re-classifying an already-terminal or already-cleaned
 * journal is a no-op.
 */
export function reconcileMutationTransactions(durableRoot: string): RecoveryReport[] {
  const dir = recoveryDir(durableRoot, 'transactions');
  if (!fs.existsSync(dir)) return [];

  const reports: RecoveryReport[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const journalFile = path.join(dir, entry);
    const record = readJournalRecord(journalFile);

    if (!record) {
      reports.push({
        transactionId: entry.replace(/\.json$/, ''),
        journalFile,
        classification: 'CORRUPT_RECORD',
        detail: 'Journal record is missing, malformed, or fails schema validation.',
      });
      continue;
    }

    if (record.state === 'COMMITTED') {
      reports.push({
        transactionId: record.transactionId,
        journalFile,
        classification: 'ALREADY_COMMITTED',
        detail: 'Transaction committed successfully; nothing to recover.',
      });
      continue;
    }

    if (record.state === 'ABORTED') {
      reports.push({
        transactionId: record.transactionId,
        journalFile,
        classification: 'SAFE_ABORT',
        detail: 'Transaction was already marked ABORTED before crash/restart.',
      });
      continue;
    }

    // Non-terminal state at startup: was there ever a chance the replace happened?
    const replaceMayHaveStarted = record.state === 'REPLACING' || record.state === 'FINAL_VERIFIED';

    if (!replaceMayHaveStarted) {
      // Original untouched, backup already durable+verified, temp (if any) is ours
      // and disposable, replacement never began. Safe to clean up and mark aborted.
      let cleanedTemp = false;
      if (record.tempPath && fs.existsSync(record.tempPath)) {
        try {
          fs.unlinkSync(record.tempPath);
          cleanedTemp = true;
        } catch {
          // Leave for a future pass; do not escalate a cleanup failure to RECOVERY_REQUIRED.
        }
      }
      try {
        persistJournal(durableRoot, { ...record, state: 'ABORTED', failureReason: 'Recovered at startup: replacement never began.', updatedAt: new Date().toISOString() });
      } catch {
        // Best-effort; classification below still stands even if the marker write failed.
      }
      reports.push({
        transactionId: record.transactionId,
        journalFile,
        classification: 'SAFE_ABORT',
        detail: 'Original unchanged, backup valid, replacement never began.',
        cleanedTemp,
      });
      continue;
    }

    // Ambiguous: crash occurred during or immediately after the replace. Do not
    // guess — never overwrite original or backup without positive evidence.
    reports.push({
      transactionId: record.transactionId,
      journalFile,
      classification: 'RECOVERY_REQUIRED',
      detail: `Crash during/after replacement (last known state: ${record.state}). Manual or provider-specific recovery required.`,
    });
  }

  return reports;
}
