import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeAaScript } from '../src/core/script-research/aa-script-analyzer.ts';
import { IN_PROCESS_SCRIPT_MILESTONE } from '../src/core/in-process-script/charter.ts';
import { evaluateInProcessGate } from '../src/core/in-process-script/guards.ts';
import { planHookFromScriptAnalysis, FRIENDSHIP_AOB } from '../src/core/in-process-script/aa-hook-planner.ts';
import { proposeHookInstall } from '../src/core/in-process-script/hook-engine.ts';
import {
  clearInjectorProposals,
  confirmInjectorLaunch,
  proposeInjectorLaunch,
} from '../src/core/in-process-script/injector-launcher.ts';
import { clearWriteConsentStore, issueWriteConsent } from '../src/core/consent/write-consent.ts';
import { upsertHelperManifestEntry, relativeHelperPath } from '../src/core/in-process-script/helper-manifest.ts';
import { createHash } from 'node:crypto';
import { buildFriendshipCapShellcode } from '../src/core/in-process-script/presets/crimson-fast-friendship.ts';
import { buildAbsoluteJumpPatch } from '../src/core/in-process-script/code-cave.ts';

const FRIENDSHIP_SCRIPT = `
aobscanmodule(INJECT_FAST_FRIENDSHIP,$process,74 ?? ?? 8B ?? 20 E8 ?? ?? ?? ?? 3C FE 7E ??)
alloc(newmem,$1000)
code:
  cmp qword ptr [rax+20], 64
  mov qword ptr [rax+20], 64
registersymbol(INJECT_FAST_FRIENDSHIP)
`;

const pilotGate = {
  featureEnabled: true,
  userConfirmedOffline: true,
  userApprovedAction: true,
  executableName: 'CrimsonDesert.exe',
} as const;

describe('in-process script execution milestone', () => {
  test('charter limits pilot to CrimsonDesert.exe and defaults OFF', () => {
    assert.deepEqual(IN_PROCESS_SCRIPT_MILESTONE.pilotExecutables, ['CrimsonDesert.exe']);
    assert.equal(IN_PROCESS_SCRIPT_MILESTONE.defaultFeatureEnabled, false);
  });

  test('gate blocks when feature disabled or wrong executable', () => {
    const blocked = evaluateInProcessGate({
      featureEnabled: false,
      userConfirmedOffline: true,
      userApprovedAction: true,
      executableName: 'CrimsonDesert.exe',
    });
    assert.equal(blocked.allowed, false);

    const wrongGame = evaluateInProcessGate({
      featureEnabled: true,
      userConfirmedOffline: true,
      userApprovedAction: true,
      executableName: 'Palworld-Win64-Shipping.exe',
    });
    assert.equal(wrongGame.allowed, false);

    const ok = evaluateInProcessGate({
      featureEnabled: true,
      userConfirmedOffline: true,
      userApprovedAction: true,
      executableName: 'CrimsonDesert.exe',
    });
    assert.equal(ok.allowed, true);
  });

  test('plans executable friendship hook preset from AA analysis', () => {
    const analysis = analyzeAaScript('Fast friendship', FRIENDSHIP_SCRIPT, 'CrimsonDesert.exe')!;
    assert.equal(analysis.aobScans[0]?.patternSolith, FRIENDSHIP_AOB);
    const plan = planHookFromScriptAnalysis(analysis, 'CrimsonDesert.exe');
    assert.equal(plan.presetId, 'crimson-fast-friendship');
    assert.equal(plan.executablePlan, true);
    assert.equal(plan.status, 'ready');
  });

  test('stages hook and rejects unbound injector proposals', () => {
    const analysis = analyzeAaScript('Fast friendship', FRIENDSHIP_SCRIPT, 'CrimsonDesert.exe')!;
    const plan = planHookFromScriptAnalysis(analysis, 'CrimsonDesert.exe');
    const hookProposal = proposeHookInstall(plan);
    assert.ok(hookProposal.proposalId);
    const helpersRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-helpers-'));

    assert.throws(
      () =>
        proposeInjectorLaunch({
          exePath: 'not-a-file.bin',
          helpersRoot,
          attachedExecutableName: 'CrimsonDesert.exe',
          attachedPid: 1001,
          gate: pilotGate,
        }),
      /Trainer executable not found|Only \.exe|injector-helpers/,
    );

    assert.throws(
      () =>
        proposeInjectorLaunch({
          exePath: path.join(helpersRoot, 'x.exe'),
          helpersRoot,
          attachedExecutableName: 'Palworld-Win64-Shipping.exe',
          attachedPid: 1001,
          gate: { ...pilotGate, executableName: 'Palworld-Win64-Shipping.exe' },
        }),
      /limited to|CrimsonDesert/i,
    );
    fs.rmSync(helpersRoot, { recursive: true, force: true });
  });

  test('injector confirm re-checks gate, attachment, and file hash', async () => {
    clearInjectorProposals();
    clearWriteConsentStore();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-injector-'));
    const helpersRoot = path.join(tmpDir, 'injector-helpers');
    fs.mkdirSync(helpersRoot, { recursive: true });
    const exePath = path.join(helpersRoot, 'research-helper.exe');
    try {
      fs.writeFileSync(exePath, Buffer.from('MZ-fake-helper-v1'));
      const sha256 = createHash('sha256').update('MZ-fake-helper-v1').digest('hex');
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
      assert.equal(proposal.attachedExecutableName, 'CrimsonDesert.exe');
      assert.ok(proposal.sha256);

      const consentWrong = issueWriteConsent({
        operation: 'injector_confirm_launch',
        sessionKey: 't',
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
            attachedExecutableName: 'OtherGame.exe',
            attachedPid: 1001,
            helpersRoot,
            verifyLiveIdentity: () => null,
            consentToken: consentWrong.tokenId,
            consentBinding: {
              operation: 'injector_confirm_launch',
              sessionKey: 't',
              proposalId: proposal.proposalId,
              attachedPid: 1001,
              attachedExecutableName: 'CrimsonDesert.exe',
              executablePath: 'C:\\Games\\CrimsonDesert.exe',
              processStartTime: '2020-01-01T00:00:00.000Z',
              exePath: proposal.exePath,
              exeSha256: proposal.sha256,
            },
            gate: { ...pilotGate, executableName: 'OtherGame.exe' },
            remoteConnections: {
              availability: 'available',
              remoteConnectionCount: 0,
              observedAt: new Date().toISOString(),
            },
          }),
        /no longer matches|limited to/i,
      );

      fs.writeFileSync(exePath, Buffer.from('MZ-fake-helper-TAMPERED'));
      const consentHash = issueWriteConsent({
        operation: 'injector_confirm_launch',
        sessionKey: 't',
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
            consentToken: consentHash.tokenId,
            consentBinding: {
              operation: 'injector_confirm_launch',
              sessionKey: 't',
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
        /hash changed|manifest|SHA-256/i,
      );
    } finally {
      clearInjectorProposals();
      clearWriteConsentStore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('builds friendship shellcode and 14-byte jump patch', () => {
    const original = Buffer.alloc(14, 0x90);
    const cave = BigInt(0x7ff100001000);
    const site = BigInt(0x7ff100000000);
    const shellcode = buildFriendshipCapShellcode(cave, site, original);
    assert.ok(shellcode.length > original.length);
    const patch = buildAbsoluteJumpPatch(cave);
    assert.equal(patch.length, 14);
    assert.equal(patch[0], 0xff);
  });
});
