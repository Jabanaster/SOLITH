import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { evaluateOnlineGuard } from '../live-memory/online-guard.js';
import type { RemoteConnectionEvidence } from '../live-memory/types.js';
import { IN_PROCESS_SCRIPT_MILESTONE } from './charter.js';
import { evaluateInProcessGate } from './guards.js';
import type { InjectorLaunchProposal, InProcessGateInput } from './types.js';

const PROPOSAL_TTL_MS = 10 * 60 * 1000;

const proposals = new Map<string, InjectorLaunchProposal>();

export interface InjectorLaunchAuditEntry {
  op: 'propose' | 'confirm';
  allowed: boolean;
  reason: string;
  proposalId?: string;
  exePath?: string;
  attachedExecutableName?: string;
  attachedPid?: number | null;
  spawnedPid?: number;
  at: string;
}

const auditLog: InjectorLaunchAuditEntry[] = [];
const MAX_AUDIT = 200;

type SpawnImpl = (exePath: string) => { pid: number };

let spawnImplForTests: SpawnImpl | null = null;

const WINDOWS_SYSTEM_ROOTS = [
  path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32').toLowerCase(),
  path.join(process.env.SystemRoot ?? 'C:\\Windows', 'SysWOW64').toLowerCase(),
  (process.env.SystemRoot ?? 'C:\\Windows').toLowerCase(),
];

function recordAudit(entry: Omit<InjectorLaunchAuditEntry, 'at'>): void {
  auditLog.push({ ...entry, at: new Date().toISOString() });
  while (auditLog.length > MAX_AUDIT) auditLog.shift();
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function cloneProposal(proposal: InjectorLaunchProposal): InjectorLaunchProposal {
  return {
    proposalId: proposal.proposalId,
    exePath: proposal.exePath,
    fileName: proposal.fileName,
    sha256: proposal.sha256,
    attachedExecutableName: proposal.attachedExecutableName,
    attachedPid: proposal.attachedPid,
    userConfirmedOffline: proposal.userConfirmedOffline,
    warnings: [...proposal.warnings],
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
  };
}

function assertPilotInjectorPath(resolved: string): void {
  if (!fs.existsSync(resolved)) {
    throw new Error('Trainer executable not found.');
  }
  if (!resolved.toLowerCase().endsWith('.exe')) {
    throw new Error('Only .exe trainers may be launched from the research lab.');
  }
  const normalized = path.resolve(resolved).toLowerCase();
  const sep = path.sep.toLowerCase();
  for (const root of WINDOWS_SYSTEM_ROOTS) {
    if (normalized === root || normalized.startsWith(root + sep)) {
      throw new Error('Refusing to launch executables from Windows system directories.');
    }
  }
}

function assertGate(gate: InProcessGateInput): void {
  const decision = evaluateInProcessGate(gate);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  const allowed = IN_PROCESS_SCRIPT_MILESTONE.pilotExecutables.some(
    (name) => name.toLowerCase() === gate.executableName.toLowerCase(),
  );
  if (!allowed) {
    throw new Error(
      `Injector launch is limited to attached ${IN_PROCESS_SCRIPT_MILESTONE.pilotExecutables.join(', ')}.`,
    );
  }
}

function denyPropose(reason: string, detail: Partial<InjectorLaunchAuditEntry> = {}): never {
  recordAudit({ op: 'propose', allowed: false, reason, ...detail });
  throw new Error(reason);
}

function denyConfirm(reason: string, detail: Partial<InjectorLaunchAuditEntry> = {}): never {
  recordAudit({ op: 'confirm', allowed: false, reason, ...detail });
  throw new Error(reason);
}

export interface ProposeInjectorLaunchInput {
  exePath: string;
  gate: InProcessGateInput;
  /** Must be the currently attached pilot game executable name. */
  attachedExecutableName: string;
  /** Must be the currently attached pilot process id. */
  attachedPid: number;
  /** Test-only override for expiry timestamp. */
  expiresAtIso?: string;
}

export function proposeInjectorLaunch(input: ProposeInjectorLaunchInput): InjectorLaunchProposal {
  const attachedExecutableName = input.attachedExecutableName.trim();
  if (!attachedExecutableName) {
    denyPropose('Injector launch requires an attached CrimsonDesert.exe session.');
  }
  if (!Number.isInteger(input.attachedPid) || input.attachedPid <= 0) {
    denyPropose('Injector launch requires a valid attached process PID.');
  }

  const gate: InProcessGateInput = {
    ...input.gate,
    executableName: attachedExecutableName,
  };
  try {
    assertGate(gate);
  } catch (err) {
    denyPropose(err instanceof Error ? err.message : String(err), {
      attachedExecutableName,
      attachedPid: input.attachedPid,
    });
  }

  let resolved: string;
  try {
    resolved = path.resolve(input.exePath);
    assertPilotInjectorPath(resolved);
  } catch (err) {
    denyPropose(err instanceof Error ? err.message : String(err), {
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: input.exePath,
    });
  }

  const sha256 = sha256File(resolved);
  const createdAt = new Date().toISOString();
  const expiresAt =
    input.expiresAtIso ?? new Date(Date.parse(createdAt) + PROPOSAL_TTL_MS).toISOString();

  const proposal: InjectorLaunchProposal = {
    proposalId: randomUUID(),
    exePath: resolved,
    fileName: path.basename(resolved),
    sha256,
    attachedExecutableName,
    attachedPid: input.attachedPid,
    userConfirmedOffline: gate.userConfirmedOffline === true,
    warnings: [
      'Solith will spawn this process detached. You are responsible for what the trainer does.',
      'Attach to CrimsonDesert.exe in Solith — not the trainer process.',
      'Offline / solo-play only. Close trainer when finished.',
      `Bound to attached ${attachedExecutableName} PID ${input.attachedPid}; confirm re-checks gates, PID, online state, and file hash.`,
    ],
    createdAt,
    expiresAt,
  };
  // Store an independent clone so callers cannot mutate the live proposal.
  proposals.set(proposal.proposalId, cloneProposal(proposal));
  recordAudit({
    op: 'propose',
    allowed: true,
    reason: 'Injector launch proposal staged.',
    proposalId: proposal.proposalId,
    exePath: proposal.exePath,
    attachedExecutableName,
    attachedPid: input.attachedPid,
  });
  return cloneProposal(proposal);
}

export function getInjectorProposal(proposalId: string): InjectorLaunchProposal | undefined {
  const proposal = proposals.get(proposalId);
  return proposal ? cloneProposal(proposal) : undefined;
}

export interface ConfirmInjectorLaunchInput {
  proposalId: string;
  gate: InProcessGateInput;
  /** Must still match the attached pilot game executable. */
  attachedExecutableName: string;
  /** Must still match the attached pilot process id. */
  attachedPid: number | null;
  /** Live remote-connection evidence — required for online fail-closed confirm. */
  remoteConnections: RemoteConnectionEvidence;
  /** Reviewed connection baseline for this executable (default 0). */
  acceptedConnectionBaseline?: number;
}

function spawnDetached(exePath: string): { pid: number } {
  if (spawnImplForTests) {
    return spawnImplForTests(exePath);
  }
  const child = spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  if (child.pid == null) {
    throw new Error('Failed to spawn trainer process.');
  }
  return { pid: child.pid };
}

export async function confirmInjectorLaunch(
  input: ConfirmInjectorLaunchInput,
): Promise<{ pid: number }> {
  const proposal = proposals.get(input.proposalId);
  if (!proposal) {
    denyConfirm('Unknown injector launch proposal.', { proposalId: input.proposalId });
  }

  const attachedExecutableName = (input.attachedExecutableName ?? '').trim();
  if (!attachedExecutableName) {
    denyConfirm('Injector confirm requires an attached CrimsonDesert.exe session.', {
      proposalId: proposal.proposalId,
    });
  }
  if (input.attachedPid == null || !Number.isInteger(input.attachedPid) || input.attachedPid <= 0) {
    denyConfirm('Injector confirm requires an attached CrimsonDesert.exe session.', {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
    });
  }
  if (attachedExecutableName.toLowerCase() !== proposal.attachedExecutableName.toLowerCase()) {
    denyConfirm('Attached process no longer matches the injector launch proposal.', {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }
  if (input.attachedPid !== proposal.attachedPid) {
    denyConfirm('Attached process PID no longer matches the injector launch proposal.', {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }

  if (Date.parse(proposal.expiresAt) <= Date.now()) {
    proposals.delete(input.proposalId);
    denyConfirm('Injector launch proposal expired; create a new proposal.', {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }

  const gate: InProcessGateInput = {
    ...input.gate,
    executableName: attachedExecutableName,
    userConfirmedOffline: input.gate.userConfirmedOffline === true,
  };
  try {
    assertGate(gate);
  } catch (err) {
    denyConfirm(err instanceof Error ? err.message : String(err), {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }

  const online = evaluateOnlineGuard({
    userConfirmedOffline: gate.userConfirmedOffline,
    remoteConnections: input.remoteConnections,
    acceptedConnectionBaseline: input.acceptedConnectionBaseline ?? 0,
  });
  if (!online.allowed) {
    denyConfirm(online.reason, {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }

  try {
    assertPilotInjectorPath(proposal.exePath);
  } catch (err) {
    denyConfirm(err instanceof Error ? err.message : String(err), {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }

  const currentHash = sha256File(proposal.exePath);
  if (!proposal.sha256 || currentHash !== proposal.sha256) {
    denyConfirm('Injector executable hash changed since proposal; relaunch proposal required.', {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }

  try {
    const result = spawnDetached(proposal.exePath);
    proposals.delete(input.proposalId);
    recordAudit({
      op: 'confirm',
      allowed: true,
      reason: 'Injector helper launched.',
      proposalId: proposal.proposalId,
      exePath: proposal.exePath,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      spawnedPid: result.pid,
    });
    return result;
  } catch (err) {
    denyConfirm(err instanceof Error ? err.message : String(err), {
      proposalId: proposal.proposalId,
      attachedExecutableName,
      attachedPid: input.attachedPid,
      exePath: proposal.exePath,
    });
  }
}

export function clearInjectorProposals(): void {
  proposals.clear();
}

export function getInjectorLaunchAudit(): InjectorLaunchAuditEntry[] {
  return auditLog.map((entry) => ({ ...entry }));
}

export function clearInjectorLaunchAudit(): void {
  auditLog.length = 0;
}

/** Test-only: replace process spawn. */
export function setInjectorSpawnForTests(impl: SpawnImpl | null): void {
  spawnImplForTests = impl;
}

export function resetInjectorLaunchTestHooks(): void {
  spawnImplForTests = null;
  clearInjectorLaunchAudit();
}
