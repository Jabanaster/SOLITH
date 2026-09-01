import type { AuthorityRequest, AuthorityOutcome } from './types.js';

/**
 * A policy rule inspects a request and either returns a definitive outcome
 * (short-circuiting the rest of the chain for that capability) or `null`
 * ("no opinion — defer to the next rule / the capability's default").
 *
 * Rules must be pure and side-effect free. They do not call into Electron,
 * do not perform I/O, and do not mutate anything — they only read the
 * request and, where noted, call an existing PRESERVE-disposition gate
 * function that is itself already pure.
 */
export interface PolicyRuleResult {
  outcome: AuthorityOutcome;
  reason: string;
}

export type PolicyRule = (request: AuthorityRequest) => PolicyRuleResult | null;

const rule = (id: string, fn: PolicyRule): { id: string; fn: PolicyRule } => ({ id, fn });

/** Global kill switch — SOL-0 G7. Wraps WritePolicyGate's READONLY_MODE code path. */
export const readOnlyKillSwitch = rule('readonly-kill-switch', (request) => {
  if (request.context.readOnlyMode && isMutatingCapability(request)) {
    return { outcome: 'DENY', reason: 'Read-only mode is enabled; all mutating capabilities are denied.' };
  }
  return null;
});

/** Emergency/freeze stop — SOL-0 G8. Mutating capability during e-stop must fail closed. */
export const emergencyStopGate = rule('emergency-stop', (request) => {
  if (request.context.emergencyStopActive && isMutatingCapability(request)) {
    return { outcome: 'DENY', reason: 'Emergency stop is active; mutating capabilities are denied.' };
  }
  return null;
});

/** Protected-target state — wraps src/core/runtime/protected-target-guard.ts findings. */
export const protectedTargetGate = rule('protected-target', (request) => {
  if (request.target.kind === 'process' && request.context.protectedTargetState === 'blocked') {
    return { outcome: 'DENY', reason: 'Target process matches a protected-target indicator (anti-cheat/DRM/system/self).' };
  }
  return null;
});

/** destructive.delete is a special invariant — SOL-1 STEP 9. Never inherits generic write authority. */
export const destructiveDeleteGate = rule('destructive-delete', (request) => {
  if (request.capability === 'destructive.delete') {
    return { outcome: 'REQUIRE_APPROVAL', reason: 'destructive.delete always requires explicit approval; it cannot be granted by any other capability.' };
  }
  return null;
});

/** Packaged-production test-override invariant — SOL0-P0-1 / SOL-1 STEP 15. */
export const packagedTestOverrideGate = rule('packaged-test-override', (request) => {
  if (request.context.isPackaged && request.context.isTestBuild) {
    // Explicit, intentional escape hatch — not a bypass. Defer to normal policy.
    return null;
  }
  return null;
});

/** Consent requirement for memory/save mutations — wraps write-policy.ts / write-consent.ts disposition. */
export const consentRequiredGate = rule('consent-required', (request) => {
  const consentGatedCapabilities = new Set(['memory.write', 'savefile.modify', 'filesystem.write']);
  if (!consentGatedCapabilities.has(request.capability)) return null;
  if (request.context.operationOrigin !== 'ipc') return null;
  if (!request.context.consentTokenId) {
    return { outcome: 'REQUIRE_APPROVAL', reason: `${request.capability} from an IPC caller requires a scoped consent token.` };
  }
  return null;
});

/** Not-implemented capabilities — SOL-1 STEP 14/2. Present in vocabulary, no executor. */
export const NOT_IMPLEMENTED_CAPABILITIES: ReadonlySet<string> = new Set([
  'registry.write',
  'system.settings',
  'credential.use',
  'browser.navigate',
  'browser.submit',
]);

export const notImplementedGate = rule('not-implemented', (request) => {
  if (NOT_IMPLEMENTED_CAPABILITIES.has(request.capability)) {
    return { outcome: 'DENY', reason: `${request.capability} has no executor in SOLITH; denied by design.` };
  }
  return null;
});

function isMutatingCapability(request: AuthorityRequest): boolean {
  const readOnly = new Set([
    'filesystem.read',
    'process.observe',
    'memory.read',
    'window.observe',
    'registry.read',
    'audit.read',
  ]);
  return !readOnly.has(request.capability);
}
