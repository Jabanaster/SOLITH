import type { Capability } from './capabilities.js';

/**
 * SOL-1 authority request/decision contract.
 *
 * This module must stay Electron-free (mirrors src/core/consent/write-consent.ts)
 * so AuthorityService is unit-testable under `tsx --test` without a running
 * Electron process.
 */

export type IdentityKind = 'ipc_sender' | 'internal_subsystem' | 'system';

export interface AuthorityIdentity {
  kind: IdentityKind;
  /** For ipc_sender: the trusted-window type (see electron/sender-validation.ts). */
  windowType?: string;
  /** For internal_subsystem: a stable name, e.g. 'trainer-catalog-sync', 'crash-recovery'. */
  subsystem?: string;
  /** Opaque session identifier, when one exists (live-memory session key, trainer-host session). */
  sessionKey?: string;
}

export type TargetKind =
  | 'filesystem_path'
  | 'process'
  | 'registry_path'
  | 'network_destination'
  | 'patch'
  | 'savefile'
  | 'helper_executable'
  | 'setting'
  | 'consent_token'
  | 'none';

export interface AuthorityTarget {
  kind: TargetKind;
  /** Human/log-safe identifier for the target — never a secret. */
  identifier: string;
  /** Additional non-sensitive detail used by classifiers (path, pid, host, etc.). */
  detail?: Record<string, string | number | boolean | undefined>;
}

export interface AuthorityContext {
  isPackaged: boolean;
  isTestBuild: boolean;
  sessionGeneration?: number;
  consentTokenId?: string;
  freezeActive: boolean;
  emergencyStopActive: boolean;
  protectedTargetState?: 'clear' | 'blocked';
  offlineConfirmed?: boolean;
  operationOrigin: 'ipc' | 'internal' | 'crash_recovery' | 'startup';
  readOnlyMode: boolean;
}

export type AuthorityRisk = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface AuthorityRequest {
  identity: AuthorityIdentity;
  capability: Capability;
  target: AuthorityTarget;
  context: AuthorityContext;
  risk: AuthorityRisk;
}

export type AuthorityOutcome = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface AuthorityDecision {
  outcome: AuthorityOutcome;
  reason: string;
  policyId: string;
  capability: Capability;
  target: AuthorityTarget;
  /** Correlates this decision to its DecisionEvidence record. */
  correlationId: string;
}
