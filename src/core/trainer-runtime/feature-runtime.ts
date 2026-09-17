import type { MemoryFeatureV1 } from '../definitions/schema.v1.js';
import type { LiveMemoryAddress } from '../live-memory/types.js';
import type { RuntimeError } from './errors.js';
import type { FeatureActivationState, FeatureResolutionState } from './types.js';

/**
 * Runtime state for one trainer feature, kept separate from the immutable
 * canonical `definition` it was built from (mission §16/§F). Resolution
 * (has target-finding succeeded?) and activation (is the action currently
 * applied?) are tracked independently — a feature can be resolved but
 * inactive, or briefly "stale" (process rebind pending) without losing its
 * last-known address.
 */
export interface RuntimeFeatureState {
  readonly definition: MemoryFeatureV1;
  resolution: {
    state: FeatureResolutionState;
    address?: LiveMemoryAddress;
    error?: RuntimeError;
  };
  activation: {
    state: FeatureActivationState;
    /** Set while a write_once/toggle write is staged but not yet confirmed. */
    proposalId?: string;
    /** Set while this feature is the session's active freeze. */
    freezeActive?: boolean;
    error?: RuntimeError;
  };
}

export function createRuntimeFeatureState(definition: MemoryFeatureV1): RuntimeFeatureState {
  return {
    definition,
    resolution: { state: 'unresolved' },
    activation: { state: 'inactive' },
  };
}

/** Marks every feature's resolution stale and activation inactive — used on process loss / detach. */
export function invalidateAllFeatures(features: Map<string, RuntimeFeatureState>): void {
  for (const feature of features.values()) {
    if (feature.resolution.state === 'resolved') {
      feature.resolution = { state: 'stale', address: feature.resolution.address };
    }
    feature.activation = { state: 'inactive' };
  }
}
