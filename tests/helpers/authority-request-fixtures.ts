import type { AuthorityRequest, AuthorityContext, AuthorityIdentity, AuthorityTarget } from '../../src/core/authority/types.js';
import type { Capability } from '../../src/core/authority/capabilities.js';

export function baseContext(overrides: Partial<AuthorityContext> = {}): AuthorityContext {
  return {
    isPackaged: false,
    isTestBuild: false,
    freezeActive: false,
    emergencyStopActive: false,
    protectedTargetState: 'clear',
    operationOrigin: 'ipc',
    readOnlyMode: false,
    ...overrides,
  };
}

export function ipcIdentity(overrides: Partial<AuthorityIdentity> = {}): AuthorityIdentity {
  return { kind: 'ipc_sender', windowType: 'main', ...overrides };
}

export function internalIdentity(subsystem: string, overrides: Partial<AuthorityIdentity> = {}): AuthorityIdentity {
  return { kind: 'internal_subsystem', subsystem, ...overrides };
}

export function target(overrides: Partial<AuthorityTarget> = {}): AuthorityTarget {
  return { kind: 'none', identifier: 'test-target', ...overrides };
}

export function request(capability: Capability, overrides: Partial<AuthorityRequest> = {}): AuthorityRequest {
  return {
    identity: ipcIdentity(),
    capability,
    target: target(),
    context: baseContext(),
    risk: 'LOW',
    ...overrides,
  };
}
