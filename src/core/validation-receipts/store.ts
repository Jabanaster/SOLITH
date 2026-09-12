import crypto from 'node:crypto';
import { z } from 'zod';
import db from '../database/index.js';

/**
 * Local validation receipts (Personal Library — Mission 8).
 *
 * STORAGE ONLY: this module records/reads metadata ABOUT a validation event
 * that happened elsewhere (a later phase wires real read/write-confirmed
 * checks to `recordValidationReceipt`). It never launches a game, never
 * attaches to or reads/writes game memory, and never executes Lua/Auto
 * Assembler. No arbitrary memory contents may ever be stored here — only
 * the specific metadata fields below.
 *
 * Every query is scoped by `gameId` + `trainerId` (or `gameId` alone for
 * `listReceiptsForGame`) — there is no "list all receipts" function, so a
 * caller can never accidentally see cross-game/cross-trainer data.
 *
 * Mirrors the plain-function, `db.prepare(...).run/get/all(...)` style of
 * `favorites/store.ts` and `support-requests/store.ts` — no ORM.
 */

export type ValidationType = 'READ_CONFIRMED' | 'WRITE_CONFIRMED';
export type ValidationResult = 'PASS' | 'FAIL' | 'STALE';

export interface ValidationReceipt {
  receiptId: string;
  gameId: string;
  trainerId: string;
  cheatId?: string;
  executableName: string;
  executableVersion?: string;
  executableHash?: string;
  trainerSource: string;
  trainerVersionHint?: string;
  validatedAt: string;
  validationType: ValidationType;
  result: ValidationResult;
}

interface ValidationReceiptRow {
  receiptId: string;
  gameId: string;
  trainerId: string;
  cheatId: string | null;
  executableName: string;
  executableVersion: string | null;
  executableHash: string | null;
  trainerSource: string;
  trainerVersionHint: string | null;
  validatedAt: string;
  validationType: ValidationType;
  result: ValidationResult;
}

const SELECT_COLUMNS = `
  receiptId, gameId, trainerId, cheatId, executableName, executableVersion,
  executableHash, trainerSource, trainerVersionHint, validatedAt, validationType, result
`;

function rowToReceipt(row: ValidationReceiptRow): ValidationReceipt {
  return {
    receiptId: row.receiptId,
    gameId: row.gameId,
    trainerId: row.trainerId,
    cheatId: row.cheatId ?? undefined,
    executableName: row.executableName,
    executableVersion: row.executableVersion ?? undefined,
    executableHash: row.executableHash ?? undefined,
    trainerSource: row.trainerSource,
    trainerVersionHint: row.trainerVersionHint ?? undefined,
    validatedAt: row.validatedAt,
    validationType: row.validationType,
    result: row.result,
  };
}

/**
 * Schema-boundary validation for `recordValidationReceipt`'s input, using
 * zod like `electron/personal-library-ipc.ts`'s `RequestSupportSchema`.
 * Required fields per the mission spec: gameId, trainerId, executableName,
 * trainerSource, validationType, result.
 */
const RecordValidationReceiptSchema = z
  .object({
    gameId: z.string().min(1).max(200),
    trainerId: z.string().min(1).max(200),
    cheatId: z.string().min(1).max(200).optional(),
    executableName: z.string().min(1).max(300),
    executableVersion: z.string().min(1).max(200).optional(),
    executableHash: z.string().min(1).max(200).optional(),
    trainerSource: z.string().min(1).max(200),
    trainerVersionHint: z.string().min(1).max(200).optional(),
    validationType: z.enum(['READ_CONFIRMED', 'WRITE_CONFIRMED']),
    result: z.enum(['PASS', 'FAIL', 'STALE']),
  })
  .strict();

export type RecordValidationReceiptInput = z.infer<typeof RecordValidationReceiptSchema>;

/**
 * Records a new validation receipt. Throws a clear zod error if required
 * fields are missing or the wrong type / enum value.
 */
export function recordValidationReceipt(input: RecordValidationReceiptInput): ValidationReceipt {
  const parsed = RecordValidationReceiptSchema.parse(input);
  const receiptId = crypto.randomUUID();

  db.prepare(
    `INSERT INTO validation_receipts
       (receiptId, gameId, trainerId, cheatId, executableName, executableVersion, executableHash,
        trainerSource, trainerVersionHint, validatedAt, validationType, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
  ).run(
    receiptId,
    parsed.gameId,
    parsed.trainerId,
    parsed.cheatId ?? null,
    parsed.executableName,
    parsed.executableVersion ?? null,
    parsed.executableHash ?? null,
    parsed.trainerSource,
    parsed.trainerVersionHint ?? null,
    parsed.validationType,
    parsed.result,
  );

  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM validation_receipts WHERE receiptId = ?`)
    .get(receiptId) as ValidationReceiptRow;
  return rowToReceipt(row);
}

/** Most recent receipt for this exact game+trainer pairing, or null if none exists. */
export function getLatestReceipt(gameId: string, trainerId: string): ValidationReceipt | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM validation_receipts
       WHERE gameId = ? AND trainerId = ?
       ORDER BY validatedAt DESC, rowid DESC
       LIMIT 1`,
    )
    .get(gameId, trainerId) as ValidationReceiptRow | undefined;
  return row ? rowToReceipt(row) : null;
}

/** All receipts for this exact game+trainer pairing, newest first. */
export function listReceiptsForTrainer(gameId: string, trainerId: string): ValidationReceipt[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM validation_receipts
       WHERE gameId = ? AND trainerId = ?
       ORDER BY validatedAt DESC, rowid DESC`,
    )
    .all(gameId, trainerId) as ValidationReceiptRow[];
  return rows.map(rowToReceipt);
}

/** All receipts for this game (across all trainers for that game), newest first. */
export function listReceiptsForGame(gameId: string): ValidationReceipt[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM validation_receipts
       WHERE gameId = ?
       ORDER BY validatedAt DESC, rowid DESC`,
    )
    .all(gameId) as ValidationReceiptRow[];
  return rows.map(rowToReceipt);
}
