import { randomUUID } from 'node:crypto';
import type { MemoryDriver, LiveProcessHandle } from '../live-memory/types.js';
import { buildAbsoluteJumpPatch } from './code-cave.js';
import { allocateCodeCave, writeProcessBuffer } from './native-bridge.js';
import { buildFriendshipCapShellcode } from './presets/crimson-fast-friendship.js';
import type { HookInstallManifest, HookInstallPlan, HookInstallProposal, HookPresetId } from './types.js';

const proposals = new Map<string, HookInstallProposal>();
const activeManifests = new Map<string, HookInstallManifest>();

export function proposeHookInstall(plan: HookInstallPlan): HookInstallProposal {
  const proposal: HookInstallProposal = {
    proposalId: randomUUID(),
    plan,
    createdAt: new Date().toISOString(),
  };
  proposals.set(proposal.proposalId, proposal);
  return proposal;
}

export function getHookProposal(proposalId: string): HookInstallProposal | undefined {
  return proposals.get(proposalId);
}

export function getActiveHookManifest(sessionKey: string): HookInstallManifest | undefined {
  return activeManifests.get(sessionKey);
}

/**
 * Stage 7.4 §8 — the AOB lookup for the hook site is now done by the
 * caller (the `in-process-confirm-hook` IPC handler), routed through
 * `LiveMemorySession.scanAobViaBackend` (native by default, legacy only
 * under explicit rollback), and the resolved address is passed in as
 * `hookSite`. This function no longer performs its own scan — scoping the
 * migration to scanner resolution only, per mission §8's explicit
 * instruction not to touch unrelated hook execution/injection semantics.
 * Everything below this point (code-cave allocation, shellcode build, the
 * actual process writes) is unchanged.
 */
export function installHookFromProposal(input: {
  sessionKey: string;
  proposalId: string;
  driver: MemoryDriver;
  handle: LiveProcessHandle;
  hookSite: bigint;
}): HookInstallManifest {
  const proposal = proposals.get(input.proposalId);
  if (!proposal) throw new Error('Unknown hook proposal.');
  const { plan } = proposal;
  if (!plan.executablePlan || plan.status !== 'ready' || !plan.presetId) {
    throw new Error('Hook plan is not executable.');
  }

  const hookSite = input.hookSite;
  const patchSize = plan.patchByteCount;
  const originalBytes = input.driver.readBuffer(input.handle, hookSite, patchSize);
  const cave = allocateCodeCave(input.handle, 4096);
  const shellcode = buildShellcodeForPreset(plan.presetId, cave, hookSite, originalBytes);
  writeProcessBuffer(input.handle, cave, shellcode);
  writeProcessBuffer(input.handle, hookSite, buildAbsoluteJumpPatch(cave));

  const manifest: HookInstallManifest = {
    manifestId: randomUUID(),
    presetId: plan.presetId,
    hookSite: `0x${hookSite.toString(16)}`,
    caveAddress: `0x${cave.toString(16)}`,
    originalBytesHex: originalBytes.toString('hex'),
    installedAt: new Date().toISOString(),
  };
  activeManifests.set(input.sessionKey, manifest);
  proposals.delete(input.proposalId);
  return manifest;
}

export function rollbackHook(input: {
  sessionKey: string;
  driver: MemoryDriver;
  handle: LiveProcessHandle;
}): boolean {
  const manifest = activeManifests.get(input.sessionKey);
  if (!manifest) return false;
  const hookSite = BigInt(manifest.hookSite);
  const original = Buffer.from(manifest.originalBytesHex, 'hex');
  writeProcessBuffer(input.handle, hookSite, original);
  activeManifests.delete(input.sessionKey);
  return true;
}

function buildShellcodeForPreset(
  presetId: HookPresetId,
  cave: bigint,
  hookSite: bigint,
  originalBytes: Buffer,
): Buffer {
  switch (presetId) {
    case 'crimson-fast-friendship':
      return buildFriendshipCapShellcode(cave, hookSite, originalBytes);
    default:
      throw new Error(`Unsupported hook preset: ${presetId}`);
  }
}

export function clearHookProposals(): void {
  proposals.clear();
}
