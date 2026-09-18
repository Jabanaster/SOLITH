/**
 * Typed failure taxonomy for the canonical trainer runtime (P4-5). Every
 * expected failure mode the runtime can produce gets one of these reasons —
 * never a generic Error string — so callers can branch on `reason` instead
 * of parsing prose.
 */
export type RuntimeFailureReason =
  | 'INVALID_SCHEMA'
  | 'MIGRATION_FAILED'
  | 'SEMANTIC_INVALID'
  | 'INCOMPATIBLE_GAME'
  | 'INCOMPATIBLE_EXECUTABLE'
  | 'EXECUTABLE_ROLE_REJECTED'
  | 'IDENTITY_AMBIGUOUS'
  | 'CAPABILITY_UNAVAILABLE'
  | 'TARGET_RESOLUTION_FAILED'
  | 'CONSENT_REQUIRED'
  | 'AUTHORIZATION_FAILED'
  | 'WRITE_FAILED'
  | 'FREEZE_FAILED'
  | 'ROLLBACK_FAILED'
  | 'PROCESS_LOST'
  | 'INVALID_STATE_TRANSITION'
  | 'DISPOSED'
  | 'UNSUPPORTED_ACTION'
  // P4-7: composite/multi-action transaction reasons. Per-action failures
  // still surface their own precise reason above (WRITE_FAILED, FREEZE_FAILED,
  // PROCESS_LOST, etc.) inside a transaction's actionRecords — these five are
  // transaction-level outcomes with no existing equivalent.
  | 'TRANSACTION_VALIDATION_FAILED'
  | 'PARTIAL_ROLLBACK_FAILURE'
  | 'TRANSACTION_CONFLICT'
  | 'TRANSACTION_CANCELLED'
  | 'NESTED_TRANSACTION_UNSUPPORTED';

export interface RuntimeError {
  reason: RuntimeFailureReason;
  message: string;
  detail?: unknown;
}

export function runtimeError(reason: RuntimeFailureReason, message: string, detail?: unknown): RuntimeError {
  return detail === undefined ? { reason, message } : { reason, message, detail };
}

/**
 * Maps the free-text `error` strings LiveMemorySession/MemoryManager return
 * (see live-memory-session.ts's AttachResult/ConfirmWriteResult/RollbackResult/
 * StartFreezeResult) onto a typed RuntimeFailureReason. Single source of
 * truth for this translation — every call site that inspects a live-memory
 * result string goes through here instead of re-deriving its own mapping.
 * Falls back to CAPABILITY_UNAVAILABLE for anything unrecognized, never to a
 * silently-successful interpretation.
 */
export function classifyLiveMemoryErrorString(error: string | undefined): RuntimeFailureReason {
  if (!error) return 'CAPABILITY_UNAVAILABLE';
  if (error === 'already_attached') return 'INVALID_STATE_TRANSITION';
  if (error === 'executable_fingerprint_mismatch') return 'INCOMPATIBLE_EXECUTABLE';
  if (error === 'incomplete_process_identity') return 'IDENTITY_AMBIGUOUS';
  if (error.startsWith('Attached process identity mismatch')) return 'IDENTITY_AMBIGUOUS';
  if (error.startsWith('Unable to re-read live process identity')) return 'PROCESS_LOST';
  if (error.includes('does not match session target PID')) return 'PROCESS_LOST';
  if (error.startsWith('Refusing to attach')) return 'EXECUTABLE_ROLE_REJECTED';
  if (error.includes('Protected target indicator detected') || error.startsWith('Protected target check failed closed')) {
    return 'EXECUTABLE_ROLE_REJECTED';
  }
  if (error === 'cleanup_in_progress') return 'DISPOSED';
  if (error.startsWith('consent_denied:') || error === 'consent_binding_required') return 'CONSENT_REQUIRED';
  if (error.startsWith('write_policy_denied:')) return 'CONSENT_REQUIRED';
  if (error === 'rollback_ledger_full') return 'CAPABILITY_UNAVAILABLE';
  if (error.startsWith('expected_value_mismatch')) return 'ROLLBACK_FAILED';
  if (error.startsWith('freeze_concurrency_limit:')) return 'CAPABILITY_UNAVAILABLE';
  if (error === 'No process attached.') return 'INVALID_STATE_TRANSITION';
  if (error.includes('Unknown or already-consumed')) return 'INVALID_STATE_TRANSITION';
  if (error.startsWith('Write failed:') || error.startsWith('Failed to open process:')) return 'WRITE_FAILED';
  if (
    error.includes('A freeze is already active') ||
    error.startsWith('Freeze value must be a finite number') ||
    error.startsWith('Freeze interval must be an integer')
  ) {
    return 'FREEZE_FAILED';
  }
  return 'CAPABILITY_UNAVAILABLE';
}
