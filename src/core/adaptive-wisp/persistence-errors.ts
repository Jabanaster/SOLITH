/**
 * Adaptive Wisp persistence-layer structured errors (Increment 2, Section
 * 53). Kept separate from errors.ts (Increment 1's profile-validation codes)
 * so the two increments' error surfaces don't blur together.
 */
export type WispPersistenceErrorCode =
  | 'WISP_PERSISTENCE_READ_FAILED'
  | 'WISP_PERSISTENCE_WRITE_FAILED'
  | 'WISP_PERSISTENCE_CORRUPT'
  | 'WISP_PERSISTENCE_VERSION_UNSUPPORTED'
  | 'WISP_PERSISTENCE_TOO_LARGE'
  | 'WISP_PERSISTENCE_PATH_INVALID';

export interface WispPersistenceError {
  code: WispPersistenceErrorCode;
  message: string;
  /** Internal diagnostic detail (e.g. the underlying fs error) — never surfaced raw to a future UI layer. */
  cause?: string;
}

export function persistenceError(code: WispPersistenceErrorCode, message: string, cause?: unknown): WispPersistenceError {
  return cause === undefined ? { code, message } : { code, message, cause: cause instanceof Error ? cause.message : String(cause) };
}
