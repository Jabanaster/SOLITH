/**
 * Typed failure taxonomy for the canonical trainer-definition persistence
 * boundary (P4-8). Mirrors the P4-5/P4-7 convention (errors.ts +
 * runtimeError() in src/core/trainer-runtime/) — never a generic thrown
 * string for an expected record-level failure.
 */
export type TrainerStorageFailureReason =
  | 'NOT_FOUND'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'MIGRATION_FAILED'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'VERIFY_FAILED';

export interface TrainerStorageError {
  reason: TrainerStorageFailureReason;
  message: string;
  detail?: unknown;
}

export function storageError(reason: TrainerStorageFailureReason, message: string, detail?: unknown): TrainerStorageError {
  return detail === undefined ? { reason, message } : { reason, message, detail };
}
