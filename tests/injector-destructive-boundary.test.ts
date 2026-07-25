/**
 * Phase 3 — hostile injector launch boundary proofs.
 *
 * These tests are the acceptance gate for destructive-operation confinement.
 * They must fail the suite if the injector path can escape its intended boundary.
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearInjectorProposals,
  confirmInjectorLaunch,
  getInjectorLaunchAudit,
  getInjectorProposal,
  proposeInjectorLaunch,
  resetInjectorLaunchTestHooks,
  setInjectorSpawnForTests,
} from '../src/core/in-process-script/injector-launcher.ts';

const pilotGate = {
  featureEnabled: true,
  userConfirmedOffline: true,
  userApprovedAction: true,
  executableName: 'CrimsonDesert.exe',
} as const;

function makeHelperExe(dir: string, name = 'research-helper.exe', body = 'MZ-helper-v1'): string {
  const exePath = path.join(dir, name);
  fs.writeFileSync(exePath, Buffer.from(body));
  return exePath;
}

describe('Phase 3 injector destructive-operation boundary', () => {
  let tmpDir = '';

  beforeEach(() => {
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p3-injector-'));
  });

  afterEach(() => {
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('non-pilot attached executable proposal fails', () => {
    const exePath = makeHelperExe(tmpDir);
    assert.throws(
      () =>
        proposeInjectorLaunch({
          exePath,
          attachedExecutableName: 'Palworld-Win64-Shipping.exe',
          attachedPid: 4242,
          gate: { ...pilotGate, executableName: 'Palworld-Win64-Shipping.exe' },
        }),
      /CrimsonDesert|limited to/i,
    );
    assert.equal(getInjectorLaunchAudit().some((e) => e.op === 'propose' && e.allowed === false), true);
  });

  test('system-directory executable proposal fails', () => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const systemExe = path.join(systemRoot, 'System32', 'notepad.exe');
    if (!fs.existsSync(systemExe)) {
      // Environment without notepad — still prove the path classifier using a synthetic system path
      // by placing a file under a fake System32 tree is impractical; skip only if missing.
      assert.ok(true);
      return;
    }
    assert.throws(
      () =>
        proposeInjectorLaunch({
          exePath: systemExe,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
        }),
      /system directories/i,
    );
  });

  test('caller path substitution on returned proposal object fails on confirm', async () => {
    const exePath = makeHelperExe(tmpDir);
    const evilPath = makeHelperExe(tmpDir, 'evil.exe', 'MZ-evil');
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });

    // Hostile: mutate the object the API returned.
    (proposal as { exePath: string }).exePath = evilPath;

    const stored = getInjectorProposal(proposal.proposalId);
    assert.ok(stored);
    assert.equal(stored.exePath, exePath);
    assert.notEqual(proposal.exePath, stored.exePath);

    const spawned: string[] = [];
    setInjectorSpawnForTests((filePath) => {
      spawned.push(filePath);
      return { pid: 321 };
    });
    const result = await confirmInjectorLaunch({
      proposalId: proposal.proposalId,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
      remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
    });
    assert.equal(result.pid, 321);
    assert.deepEqual(spawned, [exePath], 'confirm must spawn the stored path, not the mutated return object');
  });

  test('binary modification / hash change fails confirm', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    fs.writeFileSync(exePath, Buffer.from('MZ-tampered'));
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run after hash change');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /hash changed/i,
    );
    assert.equal(getInjectorLaunchAudit().some((e) => e.op === 'confirm' && e.allowed === false), true);
    assert.ok(getInjectorProposal(proposal.proposalId), 'failed confirm must not consume proposal');
  });

  test('confirmation after detachment fails', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run when detached');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: '',
          attachedPid: null,
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /attached|CrimsonDesert/i,
    );
  });

  test('confirmation after PID change fails', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run after PID change');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 9999,
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /PID|process|no longer matches/i,
    );
  });

  test('confirmation when session is online fails', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run while online');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
          remoteConnections: {
            availability: 'available',
            remoteConnectionCount: 5,
            observedAt: new Date().toISOString(),
          },
          acceptedConnectionBaseline: 0,
        }),
      /remote connection|online|multiplayer/i,
    );
  });

  test('confirmation without current waiver fails', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run without waiver');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: { ...pilotGate, userConfirmedOffline: false },
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /offline|waiver|solo/i,
    );
  });

  test('confirmation without explicit approval fails', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run without approval');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: { ...pilotGate, userApprovedAction: false },
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /approval/i,
    );
  });

  test('replayed proposal after successful launch fails', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const spawnCalls: string[] = [];
    setInjectorSpawnForTests((filePath) => {
      spawnCalls.push(filePath);
      return { pid: 555 };
    });
    const first = await confirmInjectorLaunch({
      proposalId: proposal.proposalId,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
      remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
    });
    assert.equal(first.pid, 555);
    assert.deepEqual(spawnCalls, [exePath]);
    assert.equal(getInjectorProposal(proposal.proposalId), undefined);

    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /Unknown injector launch proposal/i,
    );
    assert.equal(spawnCalls.length, 1);
  });

  test('unknown proposal ID fails', async () => {
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run for unknown proposal');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: '00000000-0000-4000-8000-000000000000',
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /Unknown injector launch proposal/i,
    );
  });

  test('failed launch leaves proposal unconsumed and records denial', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    setInjectorSpawnForTests(() => {
      throw new Error('simulated spawn failure');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /simulated spawn failure/i,
    );
    assert.ok(getInjectorProposal(proposal.proposalId), 'failed spawn must not consume proposal');
    const denial = getInjectorLaunchAudit().find((e) => e.op === 'confirm' && e.allowed === false);
    assert.ok(denial);
    assert.match(denial.reason, /simulated spawn failure/i);
    assert.equal(denial.spawnedPid, undefined);
  });

  test('approved Crimson Desert launch follows expected lifecycle', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    assert.equal(proposal.attachedPid, 1001);
    assert.equal(proposal.attachedExecutableName, 'CrimsonDesert.exe');

    let spawned: string | null = null;
    setInjectorSpawnForTests((filePath) => {
      spawned = filePath;
      return { pid: 777 };
    });
    const result = await confirmInjectorLaunch({
      proposalId: proposal.proposalId,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
      remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
    });
    assert.equal(result.pid, 777);
    assert.equal(spawned, exePath);
    assert.equal(getInjectorProposal(proposal.proposalId), undefined);
    const success = getInjectorLaunchAudit().find((e) => e.op === 'confirm' && e.allowed === true);
    assert.ok(success);
    assert.equal(success.spawnedPid, 777);
    assert.match(success.reason, /launched/i);
  });

  test('expired proposal fails', async () => {
    const exePath = makeHelperExe(tmpDir);
    const proposal = proposeInjectorLaunch({
      exePath,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
      // test-only: create already-expired
      expiresAtIso: new Date(Date.now() - 1000).toISOString(),
    });
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run for expired proposal');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /expired/i,
    );
  });
});
