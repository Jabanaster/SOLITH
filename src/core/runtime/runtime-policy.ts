export interface RuntimePolicy {
  readOnly: true;
  requireExplicitProcessSelection: true;
  allowWrites: false;
  allowAutoAttach: false;
  allowPrivilegeEscalation: false;
  maxScanBytes: number;
  timeoutMs: number;
}

export const DEFAULT_RUNTIME_POLICY: RuntimePolicy = {
  readOnly: true,
  requireExplicitProcessSelection: true,
  allowWrites: false,
  allowAutoAttach: false,
  allowPrivilegeEscalation: false,
  maxScanBytes: 64 * 1024 * 1024,
  timeoutMs: 10_000,
};

export function assertReadOnlyPolicy(policy: RuntimePolicy = DEFAULT_RUNTIME_POLICY): void {
  if (!policy.readOnly || policy.allowWrites || policy.allowAutoAttach || policy.allowPrivilegeEscalation) {
    throw new Error('Runtime policy must remain explicit, read-only, non-elevating, and non-writing.');
  }
}
