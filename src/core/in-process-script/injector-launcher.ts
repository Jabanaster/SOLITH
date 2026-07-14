import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { InjectorLaunchProposal } from './types.js';

const proposals = new Map<string, InjectorLaunchProposal>();

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

export function proposeInjectorLaunch(exePath: string): InjectorLaunchProposal {
  const resolved = path.resolve(exePath);
  if (!fs.existsSync(resolved)) {
    throw new Error('Trainer executable not found.');
  }
  if (!resolved.toLowerCase().endsWith('.exe')) {
    throw new Error('Only .exe trainers may be launched from the research lab.');
  }

  const proposal: InjectorLaunchProposal = {
    proposalId: randomUUID(),
    exePath: resolved,
    fileName: path.basename(resolved),
    sha256: sha256File(resolved),
    warnings: [
      'Solith will spawn this process detached. You are responsible for what the trainer does.',
      'Attach to the game process in Solith separately — not the trainer process.',
      'Offline / solo-play only. Close trainer when finished.',
    ],
    createdAt: new Date().toISOString(),
  };
  proposals.set(proposal.proposalId, proposal);
  return proposal;
}

export function getInjectorProposal(proposalId: string): InjectorLaunchProposal | undefined {
  return proposals.get(proposalId);
}

export async function confirmInjectorLaunch(proposalId: string): Promise<{ pid: number }> {
  const proposal = proposals.get(proposalId);
  if (!proposal) throw new Error('Unknown injector launch proposal.');

  return await new Promise((resolve, reject) => {
    const child = spawn(proposal.exePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    if (child.pid == null) {
      reject(new Error('Failed to spawn trainer process.'));
      return;
    }
    proposals.delete(proposalId);
    resolve({ pid: child.pid });
  });
}

export function clearInjectorProposals(): void {
  proposals.clear();
}
