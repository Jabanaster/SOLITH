import type { CompatibilityStatus } from '../trainer-runtime/compatibility.js';
import type { RuntimeFailureReason } from '../trainer-runtime/errors.js';
import type { SessionOwnership } from '../trainer-runtime/ownership.js';
import type { TrainerRuntime } from '../trainer-runtime/runtime.js';
import type { RuntimeLifecycleState } from '../trainer-runtime/state.js';

/**
 * P4-10 mission §19: the renderer-safe projection of `TrainerRuntime` state.
 * Deliberately excludes raw process handles, internal driver objects,
 * consent tokens, raw memory snapshots, and rollback byte buffers — none of
 * which `TrainerRuntime`'s own getters expose in the first place, but this
 * type is the enforced boundary so a future IPC handler can't accidentally
 * widen it by returning the runtime object itself.
 */
export interface RuntimeStateDTO {
  state: RuntimeLifecycleState;
  ownership: SessionOwnership | null;
  trainerId: string | null;
  bound: boolean;
  processIdentity: { pid: number; executableName: string } | null;
  activeFeatureIds: string[];
  compatibility: { status: CompatibilityStatus; reason: string } | null;
  lastError: { reason: RuntimeFailureReason; message: string } | null;
}

const BOUND_STATES: RuntimeLifecycleState[] = ['BOUND', 'READY', 'ACTIVE'];

export function buildRuntimeStateDTO(runtime: TrainerRuntime): RuntimeStateDTO {
  const state = runtime.getState();
  const compatibility = runtime.getCompatibilityDecision();
  const lastFailure = runtime.getLastFailure();

  return {
    state,
    ownership: runtime.getOwnership(),
    trainerId: runtime.getDefinition()?.id ?? null,
    bound: BOUND_STATES.includes(state),
    processIdentity: runtime.getAttachedIdentitySummary(),
    activeFeatureIds: runtime.getActiveFeatureIds(),
    compatibility: compatibility ? { status: compatibility.status, reason: compatibility.reason } : null,
    lastError: lastFailure ? { reason: lastFailure.reason, message: lastFailure.message } : null,
  };
}
