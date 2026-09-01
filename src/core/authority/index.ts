export { CAPABILITIES, isKnownCapability } from './capabilities.js';
export type { Capability } from './capabilities.js';

export type {
  AuthorityIdentity,
  AuthorityTarget,
  AuthorityContext,
  AuthorityRequest,
  AuthorityDecision,
  AuthorityOutcome,
  AuthorityRisk,
  IdentityKind,
  TargetKind,
} from './types.js';

export { evaluate } from './authority-service.js';
export type { AuthorityEvaluationResult } from './authority-service.js';

export { buildDecisionEvidence, newCorrelationId } from './evidence.js';
export type { DecisionEvidence } from './evidence.js';

export { POLICY_REGISTRY, evaluateWithPolicy } from './policy-registry.js';
export type { CapabilityPolicy } from './policy-registry.js';

export { classifyProcessTarget } from './target-classifier.js';
export type { ProcessTargetClass, ProcessTargetClassification } from './target-classifier.js';

export { classifyPathTarget } from './path-target-classifier.js';
export type { PathTargetClassification } from './path-target-classifier.js';

export {
  issueGrant,
  consumeGrant,
  revokeGrant,
  revokeGrantsForSession,
  clearGrantStore,
  GRANT_TTL_MS,
} from './grants.js';
export type { AuthorityGrant, GrantBinding, ConsumeGrantResult } from './grants.js';
