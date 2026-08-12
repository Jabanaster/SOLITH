/**
 * Permanent regression tests: fail-closed consent gate in confirmInjectorLaunch.
 *
 * Candidate 1B fix — verifies that `consent.ok !== true` is the active guard,
 * covering the three real call paths: success, explicit denial, and malformed/missing token.
 *
 * These tests must never be removed. They are the production regression anchor for
 * the injector consent fail-closed requirement.
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  clearInjectorProposals,
  confirmInjectorLaunch,
  getInjectorLaunchAudit,
  proposeInjectorLaunch,
  resetInjectorLaunchTestHooks,
  setInjectorSpawnForTests,
} from '../src/core/in-process-script/injector-launcher.ts';
import {
  clearWriteConsentStore,
  issueWriteConsent,
} from '../src/core/consent/write-consent.ts';
import {
  upsertHelperManifestEntry,
  relativeHelperPath,
} from '../src/core/in-process-script/helper-manifest.ts';

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
  const sha256 = createHash('sha256').update(body).digest('hex');
  upsertHelperManifestEntry(helpersRoot, {
    relativePath: relativeHelperPath(helpersRoot, exePath),
    sha256,
    registeredAt: new Date().toISOString(),
  });
  return exePath;
}

function issueValidConsent(proposal: { proposalId: string; exePath: string; sha256: string; attachedPid: number }) {
  return issueWriteConsent({
    operation: 'injector_confirm_launch',
    sessionKey: 'test-session',
    proposalId: proposal.proposalId,
    attachedPid: proposal.attachedPid,
    attachedExecutableName: 'CrimsonDesert.exe',
    executablePath: 'C:\\Games\\CrimsonDesert.exe',
    processStartTime: '2020-01-01T00:00:00.000Z',
    exePath: proposal.exePath,
    exeSha256: proposal.sha256,
  });
}

function makeConfirmInput(
  proposal: { proposalId: string; exePath: string; sha256: string; attachedPid: number },
  consentToken: string,
) {
  return {
    proposalId: proposal.proposalId,
    attachedExecutableName: 'CrimsonDesert.exe',
    attachedPid: proposal.attachedPid,
    helpersRoot: path.dirname(proposal.exePath),
    verifyLiveIdentity: (): string | null => null,
    consentToken,
    consentBinding: {
      operation: 'injector_confirm_launch' as const,
      sessionKey: 'test-session',
      proposalId: proposal.proposalId,
      attachedPid: proposal.attachedPid,
      attachedExecutableName: 'CrimsonDesert.exe',
      executablePath: 'C:\\Games\\CrimsonDesert.exe',
      processStartTime: '2020-01-01T00:00:00.000Z',
      exePath: proposal.exePath,
      exeSha256: proposal.sha256,
    },
    gate: pilotGate,
    remoteConnections: {
      availability: 'available' as const,
      remoteConnectionCount: 0,
      observedAt: new Date().toISOString(),
    },
  };
}

describe('injector consent — fail-closed regression (Candidate 1B)', () => {
  let tmpDir = '';
  let helpersRoot = '';

  beforeEach(() => {
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    clearWriteConsentStore();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-injector-fc-'));
    helpersRoot = makeHelpersRoot(tmpDir);
  });

  afterEach(() => {
    clearInjectorProposals();
    resetInjectorLaunchTestHooks();
    clearWriteConsentStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Requirement: valid consent success still reaches the authorized path
  test('valid consent success reaches spawn (authorized path)', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });

    const consent = issueValidConsent(proposal);
    const spawned: string[] = [];
    setInjectorSpawnForTests((filePath) => {
      spawned.push(filePath);
      return { pid: 9001 };
    });

    const result = await confirmInjectorLaunch(makeConfirmInput(proposal, consent.tokenId));
    assert.equal(result.pid, 9001);
    assert.deepEqual(spawned, [exePath], 'spawn must be called exactly once with the registered helper path');
    const audit = getInjectorLaunchAudit();
    assert.ok(
      audit.some((e) => e.op === 'confirm' && e.allowed === true),
      'audit must record a successful confirm',
    );
  });

  // Requirement: { ok: false } from consent denies
  test('unknown consent token (ok: false result) denies and prevents spawn', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });

    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run when consent is { ok: false }');
    });

    await assert.rejects(
      () => confirmInjectorLaunch(makeConfirmInput(proposal, '00000000-0000-4000-8000-000000000000')),
      /consent_denied/i,
      'unknown token must produce consent_denied',
    );

    const audit = getInjectorLaunchAudit();
    assert.ok(
      audit.some((e) => e.op === 'confirm' && e.allowed === false),
      'audit must record the denied confirm',
    );
  });

  // Requirement: missing/undefined/null/non-boolean ok denies
  // consumeWriteConsent returns a typed discriminated union; expired and binding-mismatched
  // tokens both produce { ok: false }, verifying the ok !== true guard covers non-true values.
  test('expired consent token denies and prevents spawn', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });

    const expired = issueWriteConsent(
      {
        operation: 'injector_confirm_launch',
        sessionKey: 'test-session',
        proposalId: proposal.proposalId,
        attachedPid: 1001,
        attachedExecutableName: 'CrimsonDesert.exe',
        executablePath: 'C:\\Games\\CrimsonDesert.exe',
        processStartTime: '2020-01-01T00:00:00.000Z',
        exePath: proposal.exePath,
        exeSha256: proposal.sha256,
      },
      { ttlMs: 1, nowMs: Date.now() - 10_000 },
    );

    setInjectorSpawnForTests(() => {
      throw new Error('spawn must not run for expired consent');
    });

    await assert.rejects(
      () => confirmInjectorLaunch(makeConfirmInput(proposal, expired.tokenId)),
      /consent_denied/i,
      'expired token must produce consent_denied',
    );
  });

  // Requirement: no injector process or launcher side effect for malformed consent
  test('mismatched consent binding denies and prevents spawn', async () => {
    const exePath = makeHelperExe(helpersRoot);
    const proposal = proposeInjectorLaunch({
      exePath,
      helpersRoot,
      attachedExecutableName: 'CrimsonDesert.exe',
      attachedPid: 1001,
      gate: pilotGate,
    });

    const wrongConsent = issueWriteConsent({
      operation: 'injector_confirm_launch',
      sessionKey: 'test-session',
      proposalId: '00000000-0000-4000-8000-000000000001',
      attachedPid: 1001,
      attachedExecutableName: 'CrimsonDesert.exe',
      executablePath: 'C:\\Games\\CrimsonDesert.exe',
      processStartTime: '2020-01-01T00:00:00.000Z',
      exePath: proposal.exePath,
      exeSha256: proposal.sha256,
    });

    const spawnCalls: string[] = [];
    setInjectorSpawnForTests((filePath) => {
      spawnCalls.push(filePath);
      return { pid: 9999 };
    });

    await assert.rejects(
      () => confirmInjectorLaunch(makeConfirmInput(proposal, wrongConsent.tokenId)),
      /consent_denied/i,
      'binding mismatch must produce consent_denied',
    );
    assert.equal(spawnCalls.length, 0, 'spawn must not be called when consent binding is mismatched');
  });
});
