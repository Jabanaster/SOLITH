/**
 * SOL-1 canonical capability vocabulary (Docs/authority/SOL1_POLICY_MATRIX.md).
 *
 * A closed union — no `string` escape hatch. A capability that is not a member
 * of this union cannot be requested, so AuthorityService.evaluate() only ever
 * has to fail closed on an *unimplemented* capability, never an unrecognized one.
 *
 * Capabilities defined here but with no executor wired to Authority yet
 * (e.g. registry.write, system.settings, software.install, browser.*) are
 * intentionally present in the vocabulary with a DENY / NOT_IMPLEMENTED
 * policy — see policy-registry.ts. Do not delete them; do not implement an
 * executor for them without an explicit SOL-1+ scoping decision.
 */
export const CAPABILITIES = [
  'filesystem.read',
  'filesystem.write',

  'process.observe',
  'process.attach',
  'process.launch',
  'process.kill',

  'memory.read',
  'memory.write',

  'input.keyboard',
  'input.mouse',

  'window.observe',
  'window.modify',

  'network.request',

  'credential.use',

  'software.install',

  'system.settings',

  'registry.read',
  'registry.write',

  'destructive.delete',

  'trainer.patch.register',
  'trainer.patch.enable',
  'trainer.patch.disable',

  'savefile.modify',

  'overlay.activate',

  'hotkey.register',

  'catalog.update',

  'artwork.cache.write',

  'hook.install',

  'consent.issue',

  'audit.read',

  'browser.navigate',
  'browser.submit',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

export function isKnownCapability(value: unknown): value is Capability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}
