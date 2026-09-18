/**
 * Explicit composite-transaction lifecycle (P4-7). Separate state machine
 * from RuntimeLifecycleState (state.ts) — a transaction is a short-lived
 * orchestration record layered above an already-BOUND TrainerRuntime, not a
 * replacement for the runtime's own lifecycle.
 *
 * CREATED/VALIDATING are transient (set and advanced within one
 * prepareTransaction() call); READY/EXECUTING/ROLLING_BACK are the states a
 * transaction can be observed in between calls. All other states are
 * terminal and immutable — no outgoing transitions.
 */
export type TransactionLifecycleState =
  | 'CREATED'
  | 'VALIDATING'
  | 'READY'
  | 'EXECUTING'
  | 'ROLLING_BACK'
  | 'COMMITTED'
  | 'ROLLED_BACK'
  | 'PARTIAL_ROLLBACK_FAILURE'
  | 'FAILED'
  | 'CANCELLED';

const TRANSITIONS: Record<TransactionLifecycleState, readonly TransactionLifecycleState[]> = {
  CREATED: ['VALIDATING'],
  VALIDATING: ['READY', 'FAILED'],
  READY: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['COMMITTED', 'ROLLING_BACK'],
  ROLLING_BACK: ['ROLLED_BACK', 'PARTIAL_ROLLBACK_FAILURE', 'CANCELLED'],
  COMMITTED: [],
  ROLLED_BACK: [],
  PARTIAL_ROLLBACK_FAILURE: [],
  FAILED: [],
  CANCELLED: [],
};

export const TRANSACTION_TERMINAL_STATES: ReadonlySet<TransactionLifecycleState> = new Set([
  'COMMITTED',
  'ROLLED_BACK',
  'PARTIAL_ROLLBACK_FAILURE',
  'FAILED',
  'CANCELLED',
]);

export function canTransitionTransaction(from: TransactionLifecycleState, to: TransactionLifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransitionTransaction(from: TransactionLifecycleState, to: TransactionLifecycleState): void {
  if (!canTransitionTransaction(from, to)) {
    throw new Error(`Illegal composite-transaction state transition: ${from} -> ${to}`);
  }
}
