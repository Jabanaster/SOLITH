import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAaScript } from '../src/core/script-research/aa-script-analyzer.ts';
import { IN_PROCESS_SCRIPT_MILESTONE } from '../src/core/in-process-script/charter.ts';
import { evaluateInProcessGate } from '../src/core/in-process-script/guards.ts';
import { planHookFromScriptAnalysis, FRIENDSHIP_AOB } from '../src/core/in-process-script/aa-hook-planner.ts';
import { proposeHookInstall } from '../src/core/in-process-script/hook-engine.ts';
import { proposeInjectorLaunch } from '../src/core/in-process-script/injector-launcher.ts';
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

  test('stages hook and injector proposals', () => {
    const analysis = analyzeAaScript('Fast friendship', FRIENDSHIP_SCRIPT, 'CrimsonDesert.exe')!;
    const plan = planHookFromScriptAnalysis(analysis, 'CrimsonDesert.exe');
    const hookProposal = proposeHookInstall(plan);
    assert.ok(hookProposal.proposalId);

    assert.throws(() => proposeInjectorLaunch('not-a-file.bin'));
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
