import type { Capability } from './capabilities.js';
import type { AuthorityOutcome, AuthorityRequest } from './types.js';
import {
  consentRequiredGate,
  destructiveDeleteGate,
  emergencyStopGate,
  notImplementedGate,
  packagedTestOverrideGate,
  protectedTargetGate,
  readOnlyKillSwitch,
} from './policy-rules.js';
import type { PolicyRule } from './policy-rules.js';

/**
 * Global rules run, in order, for every capability before the capability's
 * own default policy is consulted. Any rule returning a non-null result
 * short-circuits evaluation.
 */
const GLOBAL_RULES: Array<{ id: string; fn: PolicyRule }> = [
  notImplementedGate,
  readOnlyKillSwitch,
  emergencyStopGate,
  protectedTargetGate,
  destructiveDeleteGate,
  packagedTestOverrideGate,
  consentRequiredGate,
];

const KNOWN_NETWORK_SUBSYSTEMS: ReadonlySet<string> = new Set(['trainer-catalog-sync', 'artwork-cache', 'local-ai-probe']);

export interface CapabilityPolicy {
  /** Outcome applied when no rule (global or capability-specific) short-circuits. */
  defaultOutcome: AuthorityOutcome;
  defaultReason: string;
  /** Optional capability-specific rules, run after GLOBAL_RULES and before defaultOutcome. */
  rules?: PolicyRule[];
}

/**
 * One entry per member of CAPABILITIES (capabilities.ts). A capability
 * missing from this map is a defect — AuthorityService.evaluate() fails
 * closed on a missing entry rather than falling through silently.
 */
export const POLICY_REGISTRY: Record<Capability, CapabilityPolicy> = {
  'filesystem.read': { defaultOutcome: 'ALLOW', defaultReason: 'Filesystem reads are non-consequential by default.' },
  'filesystem.write': { defaultOutcome: 'ALLOW', defaultReason: 'Filesystem write authorized (consent/approval already satisfied upstream).' },

  'process.observe': { defaultOutcome: 'ALLOW', defaultReason: 'Read-only process observation is non-consequential.' },
  'process.attach': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Attaching to a process requires explicit approval.' },
  'process.launch': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Launching a process requires explicit approval.' },
  'process.kill': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Terminating a process requires explicit approval.' },

  'memory.read': { defaultOutcome: 'ALLOW', defaultReason: 'Memory read on an already-attached, identity-verified session is non-consequential.' },
  'memory.write': { defaultOutcome: 'ALLOW', defaultReason: 'Memory write authorized (consent token present, identity/protected-target checks pass upstream).' },

  'input.keyboard': { defaultOutcome: 'DENY', defaultReason: 'SOLITH has no keyboard-input executor; denied by design.' },
  'input.mouse': { defaultOutcome: 'DENY', defaultReason: 'SOLITH has no mouse-input executor; denied by design.' },

  'window.observe': { defaultOutcome: 'ALLOW', defaultReason: 'Window observation is non-consequential.' },
  'window.modify': { defaultOutcome: 'DENY', defaultReason: 'SOLITH has no window-modification executor; denied by design.' },

  'network.request': {
    defaultOutcome: 'DENY',
    defaultReason: 'Network destination not recognized as a bounded internal subsystem target.',
    rules: [
      (request: AuthorityRequest) => {
        if (request.identity.kind === 'internal_subsystem' && request.identity.subsystem && KNOWN_NETWORK_SUBSYSTEMS.has(request.identity.subsystem)) {
          return { outcome: 'ALLOW', reason: `Bounded network access for known internal subsystem "${request.identity.subsystem}".` };
        }
        return null;
      },
    ],
  },

  'credential.use': { defaultOutcome: 'DENY', defaultReason: 'SOLITH has no credential-use executor; denied by design.' },

  'software.install': { defaultOutcome: 'DENY', defaultReason: 'SOLITH has no software-install executor; denied by design.' },

  'system.settings': { defaultOutcome: 'DENY', defaultReason: 'SOLITH has no system-settings-mutation executor; denied by design.' },

  'registry.read': {
    defaultOutcome: 'DENY',
    defaultReason: 'Registry read not recognized as a known install-discovery target.',
    rules: [
      (request: AuthorityRequest) => {
        if (request.identity.kind === 'internal_subsystem' && request.identity.subsystem === 'install-discovery') {
          return { outcome: 'ALLOW', reason: 'Bounded registry read for known install-discovery target.' };
        }
        return null;
      },
    ],
  },
  'registry.write': { defaultOutcome: 'DENY', defaultReason: 'Registry writes are not implemented; denied by design.' },

  'destructive.delete': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Destructive delete always requires explicit approval.' },

  'trainer.patch.register': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Registering a trainer patch requires explicit approval.' },
  'trainer.patch.enable': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Enabling a trainer patch requires explicit approval.' },
  'trainer.patch.disable': { defaultOutcome: 'ALLOW', defaultReason: 'Disabling a trainer patch reduces active mutation and is non-consequential.' },

  'savefile.modify': { defaultOutcome: 'ALLOW', defaultReason: 'Save-file modification authorized (existing safety pipeline satisfied upstream).' },

  'overlay.activate': { defaultOutcome: 'ALLOW', defaultReason: 'Overlay activation is a non-consequential UI action.' },

  'hotkey.register': { defaultOutcome: 'ALLOW', defaultReason: 'Hotkey registration is a non-consequential UI action.' },

  'catalog.update': {
    defaultOutcome: 'DENY',
    defaultReason: 'Catalog update not recognized as the known catalog-sync subsystem.',
    rules: [
      (request: AuthorityRequest) => {
        if (request.identity.kind === 'internal_subsystem' && request.identity.subsystem === 'trainer-catalog-sync') {
          return { outcome: 'ALLOW', reason: 'Bounded catalog update from the known catalog-sync subsystem.' };
        }
        return null;
      },
    ],
  },

  'artwork.cache.write': {
    defaultOutcome: 'DENY',
    defaultReason: 'Artwork cache write not recognized as the known artwork-cache subsystem.',
    rules: [
      (request: AuthorityRequest) => {
        if (request.identity.kind === 'internal_subsystem' && request.identity.subsystem === 'artwork-cache') {
          return { outcome: 'ALLOW', reason: 'Bounded artwork cache write from the known artwork-cache subsystem.' };
        }
        return null;
      },
    ],
  },

  'hook.install': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Installing an in-process hook requires explicit approval.' },

  'consent.issue': { defaultOutcome: 'REQUIRE_APPROVAL', defaultReason: 'Issuing a consent token itself requires a main-process confirmation surface.' },

  'audit.read': { defaultOutcome: 'ALLOW', defaultReason: 'Reading the authority/journal audit trail is non-consequential.' },

  'browser.navigate': { defaultOutcome: 'DENY', defaultReason: 'Browser navigation is not implemented; denied by design (reserved vocabulary only).' },
  'browser.submit': { defaultOutcome: 'DENY', defaultReason: 'Browser form submission is not implemented; denied by design (reserved vocabulary only).' },
};

export function evaluateWithPolicy(request: AuthorityRequest): { outcome: AuthorityOutcome; reason: string; policyId: string } {
  for (const { id, fn } of GLOBAL_RULES) {
    const result = fn(request);
    if (result) return { ...result, policyId: id };
  }

  const policy = POLICY_REGISTRY[request.capability];
  if (!policy) {
    // Defect guard: every Capability must have a registry entry. Fail closed.
    return { outcome: 'DENY', reason: `No policy registered for capability "${request.capability}"; failing closed.`, policyId: 'missing-policy' };
  }

  const capabilityRules = policy.rules ?? [];
  for (let index = 0; index < capabilityRules.length; index += 1) {
    const result = capabilityRules[index](request);
    if (result) return { ...result, policyId: `${request.capability}:custom:${index}` };
  }

  return { outcome: policy.defaultOutcome, reason: policy.defaultReason, policyId: `${request.capability}:default` };
}
