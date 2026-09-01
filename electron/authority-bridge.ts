import type { IpcMainInvokeEvent } from 'electron';
import { app } from 'electron';
import {
  evaluate,
  type AuthorityRequest,
  type AuthorityIdentity,
  type AuthorityTarget,
  type Capability,
  type DecisionEvidence,
  type AuthorityEvaluationResult,
} from '../src/core/authority/index.js';
import { validateIpcSender } from './sender-validation.js';

/**
 * Global mutable authority state, set by electron/authority-ipc.ts and read
 * here when building a request's AuthorityContext. This is intentionally
 * the ONLY mutable global in the authority layer — everything else
 * (AuthorityService.evaluate, policy-registry) stays pure.
 */
let readOnlyModeEnabled = false;
let emergencyStopActive = false;

export function setAuthorityReadOnlyMode(enabled: boolean): void {
  readOnlyModeEnabled = enabled;
}

export function getAuthorityReadOnlyMode(): boolean {
  return readOnlyModeEnabled;
}

export function setAuthorityEmergencyStop(active: boolean): void {
  emergencyStopActive = active;
}

export function getAuthorityEmergencyStop(): boolean {
  return emergencyStopActive;
}

const decisionLog: DecisionEvidence[] = [];
const DECISION_LOG_MAX = 500;

function recordDecision(evidence: DecisionEvidence): void {
  decisionLog.push(evidence);
  if (decisionLog.length > DECISION_LOG_MAX) decisionLog.shift();
}

export function listRecentAuthorityDecisions(limit = 100): DecisionEvidence[] {
  return decisionLog.slice(-limit);
}

export interface BuildAuthorityRequestOptions {
  capability: Capability;
  target: AuthorityTarget;
  sessionKey?: string;
  consentTokenId?: string;
  isTestBuild?: boolean;
  operationOrigin?: AuthorityRequest['context']['operationOrigin'];
  risk?: AuthorityRequest['risk'];
  protectedTargetState?: AuthorityRequest['context']['protectedTargetState'];
}

/**
 * The single helper every IPC handler calls to construct an AuthorityRequest
 * from an IpcMainInvokeEvent. Maps event -> AuthorityIdentity via the SAME
 * trusted-sender registry used by requireTrustedSender()/handleGuarded() in
 * electron/main.ts — this bridge does not invent a parallel identity source.
 *
 * Does NOT itself decide sender trust: callers must still run
 * requireTrustedSender()/handleGuarded() first, exactly as before. This
 * bridge only reads the sender's already-validated window type into
 * AuthorityIdentity for policy purposes.
 */
export function buildIpcAuthorityRequest(event: IpcMainInvokeEvent, options: BuildAuthorityRequestOptions): AuthorityRequest {
  const senderCheck = validateIpcSender(event);
  const identity: AuthorityIdentity = {
    kind: 'ipc_sender',
    windowType: senderCheck.ok ? senderCheck.windowType : undefined,
    sessionKey: options.sessionKey,
  };
  return {
    identity,
    capability: options.capability,
    target: options.target,
    risk: options.risk ?? 'MODERATE',
    context: {
      isPackaged: app.isPackaged,
      isTestBuild: options.isTestBuild ?? process.env.SOLITH_TEST_BUILD === '1',
      consentTokenId: options.consentTokenId,
      freezeActive: false,
      emergencyStopActive,
      protectedTargetState: options.protectedTargetState,
      operationOrigin: options.operationOrigin ?? 'ipc',
      readOnlyMode: readOnlyModeEnabled,
    },
  };
}

export function buildInternalAuthorityRequest(options: BuildAuthorityRequestOptions & { subsystem: string }): AuthorityRequest {
  const identity: AuthorityIdentity = {
    kind: 'internal_subsystem',
    subsystem: options.subsystem,
    sessionKey: options.sessionKey,
  };
  return {
    identity,
    capability: options.capability,
    target: options.target,
    risk: options.risk ?? 'LOW',
    context: {
      isPackaged: app.isPackaged,
      isTestBuild: options.isTestBuild ?? process.env.SOLITH_TEST_BUILD === '1',
      consentTokenId: options.consentTokenId,
      freezeActive: false,
      emergencyStopActive,
      protectedTargetState: options.protectedTargetState,
      operationOrigin: options.operationOrigin ?? 'internal',
      readOnlyMode: readOnlyModeEnabled,
    },
  };
}

/** Evaluates a request and records its evidence. Never executes anything. */
export function evaluateAuthority(request: AuthorityRequest): AuthorityEvaluationResult {
  const result = evaluate(request);
  recordDecision(result.evidence);
  return result;
}
