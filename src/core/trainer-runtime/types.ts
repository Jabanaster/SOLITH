import type { RuntimeError } from './errors.js';

/**
 * Uniform outcome shape for canonical-runtime operations. Matches the
 * `success: true/false` discriminant already dominant across the codebase
 * (src/core/definitions/migrations, live-memory's own Attach/ConfirmWrite/
 * Rollback results) rather than introducing an `ok:`-style convention.
 */
export type RuntimeResult<T> = { success: true; value: T } | { success: false; error: RuntimeError };

export function ok<T>(value: T): RuntimeResult<T> {
  return { success: true, value };
}

export function fail<T = never>(error: RuntimeError): RuntimeResult<T> {
  return { success: false, error };
}

export type FeatureResolutionState = 'unresolved' | 'resolving' | 'resolved' | 'stale' | 'failed';
export type FeatureActivationState = 'inactive' | 'activating' | 'active' | 'deactivating' | 'failed';
