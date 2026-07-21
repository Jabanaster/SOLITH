/**
 * Phase 10 — fail-closed write policy gate.
 *
 * Trainer writes (default product path) require offline confirmation + approval.
 * Research probe writes additionally require researchWriteMode + session snapshot backup.
 * Injection / code-exec requests are structurally absent; INJECT_FORBIDDEN is reserved.
 *
 * Does NOT replace LiveMemorySession's online-guard recheck — it is an additional
 * policy layer. Online guard remains count-ceiling only (KI-017 residual risk).
 */

export type WriteGateCode =
  | 'ONLINE'
  | 'NO_BACKUP'
  | 'NO_APPROVAL'
  | 'RESEARCH_MODE_OFF'
  | 'READONLY_MODE'
  | 'INJECT_FORBIDDEN';

export type WriteGateDecision =
  | { allow: true; reasons: string[] }
  | { allow: false; code: WriteGateCode; reasons: string[] };

export type WriteClass = 'trainer' | 'research_probe';

export interface WritePolicyContext {
  /** trainer = catalog/live trainer path; research_probe = Discovery/Research Lab probes */
  writeClass: WriteClass;
  /** True when online-session guard would allow (count ≤ baseline + user offline confirm). */
  isOffline: boolean;
  /** Research sessions must checkpoint a session snapshot before first probe write. */
  hasBackupSnapshot: boolean;
  /** Explicit user confirmation for this write/proposal. */
  userApproved: boolean;
  /** Settings flag — default OFF. Required only for research_probe. */
  researchWriteModeEnabled: boolean;
  /** Hard kill switch — blocks all writes when true. */
  readOnlyMode?: boolean;
}

export class WritePolicyGate {
  evaluate(context: WritePolicyContext): WriteGateDecision {
    if (context.readOnlyMode) {
      return {
        allow: false,
        code: 'READONLY_MODE',
        reasons: ['Read-only mode is enabled; all writes blocked.'],
      };
    }
    if (!context.isOffline) {
      return {
        allow: false,
        code: 'ONLINE',
        reasons: ['Online-session guard / offline confirm failed. Writes blocked.'],
      };
    }
    if (!context.userApproved) {
      return {
        allow: false,
        code: 'NO_APPROVAL',
        reasons: ['Explicit user confirmation was not satisfied.'],
      };
    }

    if (context.writeClass === 'research_probe') {
      if (!context.researchWriteModeEnabled) {
        return {
          allow: false,
          code: 'RESEARCH_MODE_OFF',
          reasons: ['Research Write Mode is disabled by default.'],
        };
      }
      if (!context.hasBackupSnapshot) {
        return {
          allow: false,
          code: 'NO_BACKUP',
          reasons: ['No research session snapshot checkpoint established.'],
        };
      }
    }

    return {
      allow: true,
      reasons: ['All write-policy preconditions passed.'],
    };
  }
}

/** Default context for existing trainer MemoryManager paths (research mode N/A). */
export function defaultTrainerWritePolicyContext(
  overrides: Partial<WritePolicyContext> = {},
): WritePolicyContext {
  return {
    writeClass: 'trainer',
    isOffline: true,
    hasBackupSnapshot: true,
    userApproved: true,
    researchWriteModeEnabled: false,
    readOnlyMode: false,
    ...overrides,
  };
}

/**
 * Research probe context — fail-closed defaults.
 * researchWriteModeEnabled stays false unless the operator explicitly enables it;
 * hasBackupSnapshot stays false until a session snapshot checkpoint exists.
 */
export function researchProbeWritePolicyContext(
  overrides: Partial<WritePolicyContext> = {},
): WritePolicyContext {
  return {
    writeClass: 'research_probe',
    isOffline: true,
    hasBackupSnapshot: false,
    userApproved: true,
    researchWriteModeEnabled: false,
    readOnlyMode: false,
    ...overrides,
  };
}
