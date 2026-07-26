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
  isWindowsSystemExecutablePath,
  proposeInjectorLaunch,
  resetInjectorLaunchTestHooks,
  setInjectorSpawnForTests,
} from '../src/core/in-process-script/injector-launcher.ts';
import {
  clearWriteConsentStore,
  issueWriteConsent,
} from '../src/core/consent/write-consent.ts';

const pilotGate = {
  featureEnabled: true,
  userConfirmedOffline: true,
  userApprovedAction: true,
  executableName: 'CrimsonDesert.exe',
} as const;

function makeHelpersRoot(dir: string): string {
  const root = path.join(dir, 'injector-helpers');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function makeHelperExe(helpersRoot: string, name = 'research-helper.exe', body = 'MZ-helper-v1'): string {
  const exePath = path.join(helpersRoot, name);
  fs.writeFileSync(exePath, Buffer.from(body));
  return exePath;
}

function issueConsentFor(proposal: { proposalId: string; exePath: string; sha256: string; attachedPid: number }) {
  return issueWriteConsent({
    operation: 'injector_confirm_launch',
    sessionKey: 'test-session',
    proposalId: proposal.proposalId,
    attachedPid: proposal.attachedPid,
    attachedExecutableName: 'CrimsonDesert.exe',
    exePath: proposal.exePath,
    exeSha256: proposal.sha256,
  });
}

async function confirmOk(input: {
  proposalId: string;
  attachedPid?: number;
  helpersRoot: string;
  consentToken: string;
  gate?: typeof pilotGate;
  remoteConnections?: { availability: 'available'; remoteConnectionCount: number; observedAt: string };
  acceptedConnectionBaseline?: number;
  verifyLiveIdentity?: () => string | null;
  consentBindingPid?: number;
}) {
  const attachedPid = input.attachedPid ?? 1001;
  const proposal = getInjectorProposal(input.proposalId);
  assert.ok(proposal);
  return confirmInjectorLaunch({
    proposalId: input.proposalId,
    attachedExecutableName: 'CrimsonDesert.exe',
    attachedPid,
    helpersRoot: input.helpersRoot,
    verifyLiveIdentity: input.verifyLiveIdentity ?? (() => null),
    consentToken: input.consentToken,
    consentBinding: {
      operation: 'injector_confirm_launch',
      sessionKey: 'test-session',
      proposalId: input.proposalId,
      attachedPid: input.consentBindingPid ?? attachedPid,
      attachedExecutableName: 'CrimsonDesert.exe',
      exePath: proposal.exePath,
      exeSha256: proposal.sha256,
    },
    gate: input.gate ?? pilotGate,
    remoteConnections: input.remoteConnections ?? {
      availability: 'available',
      remoteConnectionCount: 0,
      observedAt: new Date().toISOString(),
    },
    acceptedConnectionBaseline: input.acceptedConnectionBaseline,
  });
}

describe('Phase 3 injector destructive-operation boundary', () => {
  let tmpDir = '';
  let helpersRoot = '';

  beforeEach(() => {
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    clearWriteConsentStore();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p3-injector-'));
    helpersRoot = makeHelpersRoot(tmpDir);
  });

  afterEach(() => {
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    clearWriteConsentStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('non-pilot attached executable proposal fails', () => {
    const exePath = makeHelperExe(helpersRoot);
    assert.throws(
      () =>
        proposeInjectorLaunch({
          exePath,
          helpersRoot,
          attachedExecutableName: 'Palworld-Win64-Shipping.exe',
          attachedPid: 4242,
          gate: { ...pilotGate, executableName: 'Palworld-Win64-Shipping.exe' },
        }),
      /CrimsonDesert|limited to/i,
    );
    assert.equal(getInjectorLaunchAudit().some((e) => e.op === 'propose' && e.allowed === false), true);
  });

  test('system-directory executable proposal fails (deterministic classifier)', () => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const syntheticSystemExe = path.join(systemRoot, 'System32', 'solith-synthetic-system.exe');
    assert.equal(isWindowsSystemExecutablePath(syntheticSystemExe), true);
    assert.throws(
      () =>
        proposeInjectorLaunch({
          exePath: syntheticSystemExe,
          helpersRoot,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
        }),
      /system directories|not found|injector-helpers/i,
    );
  });

  test('executable outside injector-helpers root fails', () => {
    const outside = path.join(tmpDir, 'outside.exe');
    fs.writeFileSync(outside, Buffer.from('MZ-outside'));
    assert.throws(
      () =>
        proposeInjectorLaunch({
          exePath: outside,
          helpersRoot,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
        }),
      /injector-helpers/i,
    );
  });

  test('caller path substitution on returned proposal object fails on confirm', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const evilPath = makeHelperExe(helpersRoot, 'evil.exe', 'MZ-evil');
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    (proposal as { exePath: string }).exePath = evilPath;

    const stored = getInjectorProposal(proposal.proposalId);
    assert.ok(stored);
    assert.equal(stored.exePath, exePath);
    assert.notEqual(proposal.exePath, stored.exePath);

    const consent = issueConsentFor(stored);
    const spawned: string[] = [];
    setInjectorSpawnForTests((filePath) => {
      spawned.push(filePath);
      return { pid: 321 };
    });
    const result = await confirmOk({
      proposalId: proposal.proposalId,
      helpersRoot,
      consentToken: consent.tokenId,
    });
    assert.equal(result.pid, 321);
    assert.deepEqual(spawned, [exePath], 'confirm must spawn the stored path, not the mutated return object');
  });

  test('binary modification / hash change fails confirm', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    fs.writeFileSync(exePath, Buffer.from('MZ-tampered'));
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run after hash change');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
        }),
      /hash changed/i,
    );
    assert.equal(getInjectorLaunchAudit().some((e) => e.op === 'confirm' && e.allowed === false), true);
    assert.ok(getInjectorProposal(proposal.proposalId), 'failed confirm must not consume proposal');
  });

  test('confirmation after detachment fails', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run when detached');
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: '',
          attachedPid: null,
          helpersRoot,
          verifyLiveIdentity: () => null,
          consentToken: consent.tokenId,
          consentBinding: {
            operation: 'injector_confirm_launch',
            sessionKey: 'test-session',
            proposalId: proposal.proposalId,
            attachedPid: 1001,
            attachedExecutableName: 'CrimsonDesert.exe',
            exePath: proposal.exePath,
            exeSha256: proposal.sha256,
          },
          gate: pilotGate,
          remoteConnections: { availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString() },
        }),
      /attached|CrimsonDesert|consent_denied/i,
    );
  });

  test('confirmation after PID change fails', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run after PID change');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
          attachedPid: 9999,
          consentBindingPid: 1001,
        }),
      /PID|process|no longer matches|consent_denied/i,
    );
  });

  test('live OS identity failure blocks confirm (PID reuse mitigation)', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run after identity failure');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
          verifyLiveIdentity: () => 'Attached process creation time mismatch (possible PID reuse).',
        }),
      /PID reuse|creation time|identity/i,
    );
  });

  test('confirmation when session is online fails', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run while online');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
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
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run without waiver');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
          gate: { ...pilotGate, userConfirmedOffline: false },
        }),
      /offline|waiver|solo/i,
    );
  });

  test('confirmation without explicit approval fails', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run without approval');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
          gate: { ...pilotGate, userApprovedAction: false },
        }),
      /approval/i,
    );
  });

  test('invalid / expired / replayed consent fails', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run without valid consent');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: '00000000-0000-4000-8000-000000000000',
        }),
      /consent_denied/i,
    );

    const expired = issueWriteConsent(
      {
        operation: 'injector_confirm_launch',
        sessionKey: 'test-session',
        proposalId: proposal.proposalId,
        attachedPid: 1001,
        attachedExecutableName: 'CrimsonDesert.exe',
        exePath: proposal.exePath,
        exeSha256: proposal.sha256,
      },
      { ttlMs: 1, nowMs: Date.now() - 10_000 },
    );
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: expired.tokenId,
        }),
      /consent_denied/i,
    );

    const good = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => ({ pid: 555 }));
    await confirmOk({
      proposalId: proposal.proposalId,
      helpersRoot,
      consentToken: good.tokenId,
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: proposal.proposalId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          helpersRoot,
          verifyLiveIdentity: () => null,
          consentToken: good.tokenId,
          consentBinding: {
            operation: 'injector_confirm_launch',
            sessionKey: 'test-session',
            proposalId: proposal.proposalId,
            attachedPid: 1001,
            attachedExecutableName: 'CrimsonDesert.exe',
            exePath,
            exeSha256: proposal.sha256,
          },
          gate: pilotGate,
          remoteConnections: {
            availability: 'available',
            remoteConnectionCount: 0,
            observedAt: new Date().toISOString(),
          },
        }),
      /Unknown injector launch proposal|consent_denied/i,
    );
  });

  test('replayed proposal after successful launch fails', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    const spawnCalls: string[] = [];
    setInjectorSpawnForTests((filePath) => {
      spawnCalls.push(filePath);
      return { pid: 555 };
    });
    const first = await confirmOk({
      proposalId: proposal.proposalId,
      helpersRoot,
      consentToken: consent.tokenId,
    });
    assert.equal(first.pid, 555);
    assert.deepEqual(spawnCalls, [exePath]);
    assert.equal(getInjectorProposal(proposal.proposalId), undefined);

    const replayConsent = issueWriteConsent({
      operation: 'injector_confirm_launch',
      sessionKey: 'test-session',
      proposalId: proposal.proposalId,
      attachedPid: 1001,
      attachedExecutableName: 'CrimsonDesert.exe',
      exePath,
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
          consentToken: replayConsent.tokenId,
          consentBinding: {
            operation: 'injector_confirm_launch',
            sessionKey: 'test-session',
            proposalId: proposal.proposalId,
            attachedPid: 1001,
            attachedExecutableName: 'CrimsonDesert.exe',
            exePath,
            exeSha256: proposal.sha256,
          },
          gate: pilotGate,
          remoteConnections: {
            availability: 'available',
            remoteConnectionCount: 0,
            observedAt: new Date().toISOString(),
          },
        }),
      /Unknown injector launch proposal/i,
    );
    assert.equal(spawnCalls.length, 1);
  });

  test('unknown proposal ID fails', async () => {
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run for unknown proposal');
    });
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const fakeConsent = issueWriteConsent({
      operation: 'injector_confirm_launch',
      sessionKey: 'test-session',
      proposalId: fakeId,
      attachedPid: 1001,
      attachedExecutableName: 'CrimsonDesert.exe',
      exePath: path.join(helpersRoot, 'x.exe'),
      exeSha256: 'abc',
    });
    await assert.rejects(
      () =>
        confirmInjectorLaunch({
          proposalId: fakeId,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          helpersRoot,
          verifyLiveIdentity: () => null,
          consentToken: fakeConsent.tokenId,
          consentBinding: {
            operation: 'injector_confirm_launch',
            sessionKey: 'test-session',
            proposalId: fakeId,
            attachedPid: 1001,
            attachedExecutableName: 'CrimsonDesert.exe',
            exePath: path.join(helpersRoot, 'x.exe'),
            exeSha256: 'abc',
          },
          gate: pilotGate,
          remoteConnections: {
            availability: 'available',
            remoteConnectionCount: 0,
            observedAt: new Date().toISOString(),
          },
        }),
      /Unknown injector launch proposal/i,
    );
  });

  test('failed launch leaves proposal unconsumed and records denial', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('simulated spawn failure');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
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
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });
    assert.equal(proposal.attachedPid, 1001);
    assert.equal(proposal.attachedExecutableName, 'CrimsonDesert.exe');

    const consent = issueConsentFor(proposal);
    let spawned: string | null = null;
    setInjectorSpawnForTests((filePath) => {
      spawned = filePath;
      return { pid: 777 };
    });
    const result = await confirmOk({
      proposalId: proposal.proposalId,
      helpersRoot,
      consentToken: consent.tokenId,
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
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
      expiresAtIso: new Date(Date.now() - 1000).toISOString(),
    });
    const consent = issueConsentFor(proposal);
    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run for expired proposal');
    });
    await assert.rejects(
      () =>
        confirmOk({
          proposalId: proposal.proposalId,
          helpersRoot,
          consentToken: consent.tokenId,
        }),
      /expired/i,
    );
  });
});
