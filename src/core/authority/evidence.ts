import { randomUUID } from 'node:crypto';
import type { AuthorityDecision, AuthorityRequest } from './types.js';

/**
 * Minimum useful decision record (SOL-1 STEP 18). Suitable input for a
 * future SOL-5 telemetry pipeline, but SOL-1 does not implement SOL-5 —
 * this only defines the shape and a constructor. Never includes secrets,
 * credentials, or raw memory contents; only identifiers already present on
 * AuthorityRequest/AuthorityDecision.
 */
export interface DecisionEvidence {
  timestamp: string;
  correlationId: string;
  identity: AuthorityRequest['identity'];
  capability: AuthorityRequest['capability'];
  targetKind: AuthorityRequest['target']['kind'];
  targetIdentifier: string;
  risk: AuthorityRequest['risk'];
  outcome: AuthorityDecision['outcome'];
  policyId: string;
  reason: string;
  sessionKey?: string;
}

export function buildDecisionEvidence(request: AuthorityRequest, decision: AuthorityDecision, nowMs: number = Date.now()): DecisionEvidence {
  return {
    timestamp: new Date(nowMs).toISOString(),
    correlationId: decision.correlationId,
    identity: request.identity,
    capability: request.capability,
    targetKind: request.target.kind,
    targetIdentifier: request.target.identifier,
    risk: request.risk,
    outcome: decision.outcome,
    policyId: decision.policyId,
    reason: decision.reason,
    sessionKey: request.identity.sessionKey,
  };
}

export function newCorrelationId(): string {
  return randomUUID();
}
