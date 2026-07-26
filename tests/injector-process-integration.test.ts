/**
 * Phase 3 residual — real process + consent + audit sink integration proof.
 *
 * Exercises propose → consent → confirm → controlled fixture executable →
 * durable audit append → cleanup. Uses a dedicated Solith fixture exe (not notepad).
 *
 * Full Electron renderer→preload→ipcMain attach against CrimsonDesert.exe remains
 * an offline pilot manual/hostile gate; this test proves the privileged launch core.
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  setInjectorAuditSink,
} from '../src/core/in-process-script/injector-launcher.ts';
import {
  clearWriteConsentStore,
  issueWriteConsent,
} from '../src/core/consent/write-consent.ts';
import { upsertHelperManifestEntry, relativeHelperPath } from '../src/core/in-process-script/helper-manifest.ts';
import { createHash } from 'node:crypto';

const pilotGate = {
  featureEnabled: true,
  userConfirmedOffline: true,
  userApprovedAction: true,
  executableName: 'CrimsonDesert.exe',
} as const;

function buildFixtureExe(outPath: string): void {
  const srcPath = `${outPath}.cs`;
  const source = `
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
class SolithInjectorFixture {
  static int Main() {
    var nonce = Guid.NewGuid().ToString("N");
    var path = Path.Combine(Path.GetTempPath(), "solith-inj-fixture-" + Process.GetCurrentProcess().Id + ".nonce");
    File.WriteAllText(path, nonce);
    // Stay alive long enough for the test to observe the process + nonce.
    Thread.Sleep(15000);
    try { File.Delete(path); } catch {}
    return 0;
  }
}
`;
  fs.writeFileSync(srcPath, source, 'utf8');

  const frameworks = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  const csc = frameworks.find((p) => fs.existsSync(p));
  if (!csc) {
    throw new Error('csc.exe not found — cannot build injector fixture executable');
  }
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${outPath}`, srcPath], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(fs.existsSync(outPath), true, 'fixture exe must exist after compile');
}

function waitForNonce(pid: number, timeoutMs = 8_000): string {
  const noncePath = path.join(os.tmpdir(), `solith-inj-fixture-${pid}.nonce`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(noncePath)) {
      return fs.readFileSync(noncePath, 'utf8').trim();
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`Fixture nonce not found for pid ${pid}`);
}

function killPid(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true, stdio: 'ignore' });
  } catch {
    // already exited
  }
}

function rmDirWithRetry(dir: string, attempts = 8): void {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  // Last resort: leave temp dir for OS cleanup rather than failing the suite.
}

describe('injector process + consent integration', () => {
  let tmpDir = '';
  let helpersRoot = '';
  let auditPath = '';
  let spawnedPid: number | null = null;

  beforeEach(() => {
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    clearWriteConsentStore();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-inj-e2e-'));
    helpersRoot = path.join(tmpDir, 'injector-helpers');
    fs.mkdirSync(helpersRoot, { recursive: true });
    auditPath = path.join(tmpDir, 'injector-audit.jsonl');
    setInjectorAuditSink((entry) => {
      fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
    });
  });

  afterEach(() => {
    if (spawnedPid != null) {
      killPid(spawnedPid);
      spawnedPid = null;
    }
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    clearWriteConsentStore();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    rmDirWithRetry(tmpDir);
  });

  test('happy path: consent-bound confirm spawns fixture, audits, and cleans up', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    const exePath = path.join(helpersRoot, 'solith-injector-fixture.exe');
    buildFixtureExe(exePath);
    const sha256 = createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
    upsertHelperManifestEntry(helpersRoot, {
      relativePath: relativeHelperPath(helpersRoot, exePath),
      sha256,
      registeredAt: new Date().toISOString(),
    });

    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueWriteConsent({
      operation: 'injector_confirm_launch',
      sessionKey: 'e2e-session',
      proposalId: proposal.proposalId,
      attachedPid: 1001,
      attachedExecutableName: 'CrimsonDesert.exe',
      executablePath: 'C:\\Games\\CrimsonDesert.exe',
      processStartTime: '2020-01-01T00:00:00.000Z',
      exePath: proposal.exePath,
      exeSha256: proposal.sha256,
    });

    const result = await confirmInjectorLaunch({
      proposalId: proposal.proposalId,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      helpersRoot,
      verifyLiveIdentity: () => null,
      consentToken: consent.tokenId,
      consentBinding: {
        operation: 'injector_confirm_launch',
        sessionKey: 'e2e-session',
        proposalId: proposal.proposalId,
        attachedPid: 1001,
        attachedExecutableName: 'CrimsonDesert.exe',
        executablePath: 'C:\\Games\\CrimsonDesert.exe',
        processStartTime: '2020-01-01T00:00:00.000Z',
        exePath: proposal.exePath,
        exeSha256: proposal.sha256,
      },
      gate: pilotGate,
      remoteConnections: {
        availability: 'available',
        remoteConnectionCount: 0,
        observedAt: new Date().toISOString(),
      },
    });

    spawnedPid = result.pid;
    assert.ok(result.pid > 0);
    const nonce = waitForNonce(result.pid);
    assert.match(nonce, /^[a-f0-9]{32}$/i);
    assert.equal(getInjectorProposal(proposal.proposalId), undefined);

    const auditText = fs.readFileSync(auditPath, 'utf8');
    assert.match(auditText, /"op":"propose"/);
    assert.match(auditText, /"op":"confirm"/);
    assert.match(auditText, /"allowed":true/);
    assert.match(auditText, new RegExp(`"spawnedPid":${result.pid}`));

    killPid(result.pid);
    spawnedPid = null;
    const memSuccess = getInjectorLaunchAudit().find((e) => e.op === 'confirm' && e.allowed === true);
    assert.ok(memSuccess);
  });

  test('changed helper path after proposal fails confirm without spawn', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    const exePath = path.join(helpersRoot, 'solith-injector-fixture.exe');
    buildFixtureExe(exePath);
    const sha256 = createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
    upsertHelperManifestEntry(helpersRoot, {
      relativePath: relativeHelperPath(helpersRoot, exePath),
      sha256,
      registeredAt: new Date().toISOString(),
    });
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const moved = path.join(helpersRoot, 'moved-fixture.exe');
    fs.renameSync(exePath, moved);
    const consent = issueWriteConsent({
      operation: 'injector_confirm_launch',
      sessionKey: 'e2e-session',
      proposalId: proposal.proposalId,
      attachedPid: 1001,
      attachedExecutableName: 'CrimsonDesert.exe',
      executablePath: 'C:\\Games\\CrimsonDesert.exe',
      processStartTime: '2020-01-01T00:00:00.000Z',
      exePath: proposal.exePath,
      exeSha256: proposal.sha256,
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          helpersRoot,
          verifyLiveIdentity: () => null,
          consentToken: consent.tokenId,
          consentBinding: {
            operation: 'injector_confirm_launch',
            sessionKey: 'e2e-session',
            proposalId: proposal.proposalId,
            attachedPid: 1001,
            attachedExecutableName: 'CrimsonDesert.exe',
            executablePath: 'C:\\Games\\CrimsonDesert.exe',
            processStartTime: '2020-01-01T00:00:00.000Z',
            exePath: proposal.exePath,
            exeSha256: proposal.sha256,
          },
          gate: pilotGate,
          remoteConnections: {
            availability: 'available',
            remoteConnectionCount: 0,
            observedAt: new Date().toISOString(),
          },
        }),
      /not found|hash changed|injector-helpers/i,
    );
    assert.ok(getInjectorProposal(proposal.proposalId));
  });

  test('IPC schema surfaces require consent tokens (static proof)', async () => {
    const { LiveMemoryConfirmWriteSchema, InProcessConfirmInjectorSchema } = await import(
      '../electron/ipc-validation.ts'
    );
    assert.throws(() => LiveMemoryConfirmWriteSchema.parse({ proposalId: 'x' }), /consentToken|Required/i);
    assert.throws(
      () => InProcessConfirmInjectorSchema.parse({ proposalId: 'x', userApprovedAction: true }),
      /consentToken|Required/i,
    );
    const okMem = LiveMemoryConfirmWriteSchema.parse({
      proposalId: 'p1',
      consentToken: '00000000-0000-4000-8000-000000000001',
    });
    assert.equal(okMem.consentToken.length > 0, true);
  });
});
