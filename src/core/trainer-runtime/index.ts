export { TrainerRuntime, validateDefinitionSemantics, type BindTarget } from './runtime.js';
export type { RuntimeLifecycleState } from './state.js';
export { canTransition, assertTransition } from './state.js';
export type { RuntimeResult, FeatureResolutionState, FeatureActivationState } from './types.js';
export { ok, fail } from './types.js';
export type { RuntimeError, RuntimeFailureReason } from './errors.js';
export { runtimeError, classifyLiveMemoryErrorString } from './errors.js';
export type { CompatibilityDecision, CompatibilityStatus, PreBindCompatibilityInput } from './compatibility.js';
export { checkPreBindCompatibility } from './compatibility.js';
export type { TrainerRuntimeCapabilities } from './capabilities.js';
export { LiveMemoryCapabilities } from './capabilities.js';
export type { RuntimeFeatureState } from './feature-runtime.js';
export { createRuntimeFeatureState, invalidateAllFeatures } from './feature-runtime.js';
export type { WriteApproval } from './action-executor.js';
export {
  resolveFeatureAction,
  dispatchWriteAction,
  startFreezeAction,
  stopFreezeAction,
  rollbackAction,
} from './action-executor.js';
