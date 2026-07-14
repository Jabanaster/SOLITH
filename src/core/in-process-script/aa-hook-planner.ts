import type { AaScriptAnalysis } from '../script-research/types.js';
import type { HookInstallPlan, HookPresetId } from './types.js';

const FRIENDSHIP_AOB = '74 ? ? 8B ? 20 E8 ? ? ? ? 3C FE 7E ?';
const FRIENDSHIP_PATCH_BYTES = 14;

function matchesFriendshipPreset(analysis: AaScriptAnalysis): boolean {
  if (!/friendship/i.test(analysis.cheatName)) return false;
  return analysis.aobScans.some(
    (scan) =>
      scan.symbol.includes('INJECT_FAST_FRIENDSHIP') &&
      scan.patternSolith.replace(/\s+/g, ' ') === FRIENDSHIP_AOB,
  );
}

export function planHookFromScriptAnalysis(
  analysis: AaScriptAnalysis,
  executable: string,
): HookInstallPlan {
  const primaryAob = analysis.aobScans[0];
  const base: HookInstallPlan = {
    cheatName: analysis.cheatName,
    executable,
    moduleName: primaryAob?.module ?? executable,
    aobSignature: primaryAob?.patternSolith ?? '',
    symbol: primaryAob?.symbol,
    patchByteCount: FRIENDSHIP_PATCH_BYTES,
    executablePlan: false,
    status: primaryAob ? 'plan_only' : 'missing_aob',
    warnings: [],
    notes: [...analysis.workflowSteps],
    sourceAnalysis: {
      replicationStrategy: analysis.replicationStrategy,
      usesCodeInjection: analysis.usesCodeInjection,
      memoryOperandHints: analysis.memoryOperandHints,
    },
  };

  if (!primaryAob) {
    base.warnings.push('No AOB scan found in script — cannot plan hook site.');
    return base;
  }

  if (matchesFriendshipPreset(analysis)) {
    const presetId: HookPresetId = 'crimson-fast-friendship';
    return {
      ...base,
      presetId,
      executablePlan: true,
      status: 'ready',
      patchByteCount: FRIENDSHIP_PATCH_BYTES,
      notes: [
        'Pilot preset: caps friendship at 100 via [rax+0x20] in a code cave (mirrors CE Fast friendship script).',
        'Requires attached CrimsonDesert.exe session with offline guards passed.',
        ...base.notes,
      ],
      warnings: [
        'In-process hook installs patched bytes in the game. Use rollback before game updates.',
      ],
    };
  }

  base.warnings.push(
    'No executable pilot preset for this script. Use memory-diff workflow or add a reviewed preset.',
  );
  base.notes.push('AA auto-hook compiler is pilot-limited — only Fast friendship is executable.');
  return base;
}

export { FRIENDSHIP_AOB, FRIENDSHIP_PATCH_BYTES };
