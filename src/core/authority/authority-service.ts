import { isKnownCapability } from './capabilities.js';
import { evaluateWithPolicy } from './policy-registry.js';
import { buildDecisionEvidence, newCorrelationId } from './evidence.js';
import type { DecisionEvidence } from './evidence.js';
import type { AuthorityDecision, AuthorityRequest } from './types.js';

export interface AuthorityEvaluationResult {
  decision: AuthorityDecision;
  evidence: DecisionEvidence;
}

/**
 * Central SOL-1 authority evaluator (SOL-1 STEP 5).
 *
 * Deterministic, side-effect free, fail-closed. evaluate() NEVER performs
 * the privileged action itself — callers remain responsible for routing
 * DENY/REQUIRE_APPROVAL/ALLOW to the existing IPC-sender validation,
 * consent, and executor layers. Same request (all fields) -> same decision
 * (SOL-1 STEP 22), since evaluate() reads only its argument.
 */
export function evaluate(request: AuthorityRequest, nowMs: number = Date.now()): AuthorityEvaluationResult {
  const correlationId = newCorrelationId();

  if (!isKnownCapability(request.capability)) {
    const decision: AuthorityDecision = {
      outcome: 'DENY',
      reason: `Unknown capability "${String(request.capability)}"; failing closed.`,
      policyId: 'unknown-capability',
      capability: request.capability,
      target: request.target,
      correlationId,
    };
    return { decision, evidence: buildDecisionEvidence(request, decision, nowMs) };
  }

  const { outcome, reason, policyId } = evaluateWithPolicy(request);
  const decision: AuthorityDecision = {
    outcome,
    reason,
    policyId,
    capability: request.capability,
    target: request.target,
    correlationId,
  };
  return { decision, evidence: buildDecisionEvidence(request, decision, nowMs) };
}
