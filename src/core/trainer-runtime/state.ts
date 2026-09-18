/**
 * Explicit trainer-runtime lifecycle. No equivalent exists in LiveMemorySession
 * (which tracks attach state via nullable fields, not a named enum) — this is
 * new, Phase-4-owned surface, formalizing the lifecycle the mission asks for
 * without inventing one for the existing live-memory layer, which does not
 * need it.
 *
 * Structural (lifecycle) failures — bad schema, failed compatibility check,
 * failed bind — transition the whole runtime to FAILED. Per-operation
 * failures (a single write/freeze/rollback call failing) do NOT force a
 * state transition; they are reported via RuntimeResult so the runtime can
 * remain READY/ACTIVE for other features, matching how MemoryManager itself
 * never tears down a session just because one write failed.
 */
export type RuntimeLifecycleState =
  | 'UNLOADED'
  | 'LOADED'
  | 'VALIDATED'
  | 'COMPATIBILITY_CHECKED'
  | 'BOUND'
  | 'READY'
  | 'ACTIVE'
  | 'DEGRADED'
  | 'FAILED'
  | 'DISPOSED';

const TRANSITIONS: Record<RuntimeLifecycleState, readonly RuntimeLifecycleState[]> = {
  UNLOADED: ['LOADED', 'FAILED', 'DISPOSED'],
  LOADED: ['VALIDATED', 'FAILED', 'DISPOSED'],
  VALIDATED: ['COMPATIBILITY_CHECKED', 'FAILED', 'DISPOSED'],
  COMPATIBILITY_CHECKED: ['BOUND', 'FAILED', 'DISPOSED'],
  BOUND: ['READY', 'FAILED', 'DISPOSED'],
  READY: ['ACTIVE', 'DEGRADED', 'FAILED', 'DISPOSED'],
  ACTIVE: ['READY', 'DEGRADED', 'FAILED', 'DISPOSED'],
  DEGRADED: ['VALIDATED', 'FAILED', 'DISPOSED'],
  FAILED: ['DISPOSED'],
  DISPOSED: [],
};

export function canTransition(from: RuntimeLifecycleState, to: RuntimeLifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RuntimeLifecycleState, to: RuntimeLifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal trainer-runtime state transition: ${from} -> ${to}`);
  }
}
