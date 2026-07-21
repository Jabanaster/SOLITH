/**
 * Phase 10 — fail-closed write policy gate (Trust Shift).
 *
 * Trainer / research writes require explicit user approval + single-player waiver.
 * Research probes additionally require researchWriteMode + session snapshot backup.
 * Automated connection-count OnlineGuard is NOT used here (see evaluateWriteConsent).
 * Injection / code-exec requests are structurally absent; INJECT_FORBIDDEN is reserved.
 */

export type WriteGateCode =
  | 'NO_CONSENT'
  | 'NO_BACKUP'
  | 'NO_APPROVAL'
  | 'RESEARCH_MODE_OFF'
  | 'READONLY_MODE'
  | 'INJECT_FORBIDDEN'
  /** @deprecated Trust Shift — connection-count no longer blocks; mapped to NO_CONSENT if seen */
  | 'ONLINE';

export type WriteGateDecision =
  | { allow: true; reasons: string[] }
  | { allow: false; code: WriteGateCode; reasons: string[] };

export type WriteClass = 'trainer' | 'research_probe';

export interface WritePolicyContext {
  /** trainer = catalog/live trainer path; research_probe = Discovery/Research Lab probes */
  writeClass: WriteClass;
  /** Single-player / private-play waiver accepted (replaces connection-count isOffline). */
  singlePlayerWaiverAccepted: boolean;
  /** Research sessions must checkpoint a session snapshot before first probe write. */
  hasBackupSnapshot: boolean;
  /** Explicit user confirmation for this write/proposal. */
  userApproved: boolean;
  /** Settings flag — default OFF. Required only for research_probe. */
  researchWriteModeEnabled: boolean;
  /** Hard kill switch — blocks all writes when true. */
  readOnlyMode?: boolean;
  /**
   * @deprecated Trust Shift — ignored for allow/deny. Prefer singlePlayerWaiverAccepted.
   * Kept so older callers compiling against isOffline still type-check during migration.
   */
  isOffline?: boolean;
}

export class WritePolicyGate {
  /**
   * Trust Shift migration: `isOffline:true` still satisfies the waiver when
   * `singlePlayerWaiverAccepted` was omitted by a legacy caller. Explicit
   * `singlePlayerWaiverAccepted:false` always denies.
   */
  evaluate(context: WritePolicyContext): WriteGateDecision {
    if (context.readOnlyMode) {
      return {
        allow: false,
        code: 'READONLY_MODE',
        reasons: ['Read-only mode is enabled; all writes blocked.'],
      };
    }

    const waiverOk =
      context.singlePlayerWaiverAccepted === true ||
      (context.isOffline === true && context.singlePlayerWaiverAccepted !== false);

    if (!waiverOk) {
      return {
        allow: false,
        code: 'NO_CONSENT',
        reasons: ['Single-player / private-play waiver not accepted.'],
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
      reasons: ['Write-policy preconditions passed (waiver + approval).'],
    };
  }
}

function applyLegacyOfflineOverride(
  base: WritePolicyContext,
  overrides: Partial<WritePolicyContext>,
): WritePolicyContext {
  // Legacy callers that only set isOffline map it onto the waiver flag.
  if (overrides.singlePlayerWaiverAccepted === undefined && overrides.isOffline !== undefined) {
    return { ...base, singlePlayerWaiverAccepted: overrides.isOffline === true };
  }
  return base;
}

/** Default context for existing trainer MemoryManager paths (research mode N/A). */
export function defaultTrainerWritePolicyContext(
  overrides: Partial<WritePolicyContext> = {},
): WritePolicyContext {
  const base: WritePolicyContext = {
    writeClass: 'trainer',
    singlePlayerWaiverAccepted: true,
    hasBackupSnapshot: true,
    userApproved: true,
    researchWriteModeEnabled: false,
    readOnlyMode: false,
    ...overrides,
  };
  return applyLegacyOfflineOverride(base, overrides);
}

/**
 * Research probe context — fail-closed defaults.
 * researchWriteModeEnabled stays false unless the operator explicitly enables it;
 * hasBackupSnapshot stays false until a session snapshot checkpoint exists.
 */
export function researchProbeWritePolicyContext(
  overrides: Partial<WritePolicyContext> = {},
): WritePolicyContext {
  const base: WritePolicyContext = {
    writeClass: 'research_probe',
    singlePlayerWaiverAccepted: true,
    hasBackupSnapshot: false,
    userApproved: true,
    researchWriteModeEnabled: false,
    readOnlyMode: false,
    ...overrides,
  };
  return applyLegacyOfflineOverride(base, overrides);
}
