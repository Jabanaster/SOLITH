import type { DumpspaceImportSummary } from './types.js';
import type { CtScriptResearchReport } from '../script-research/types.js';
import type { MergedUeScriptHint } from '../script-research/types.js';

function tokenizeName(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreMemberMatch(cheatName: string, memberName: string): number {
  const cheatTokens = tokenizeName(cheatName);
  const memberTokens = tokenizeName(memberName);
  let score = 0;
  for (const token of cheatTokens) {
    if (memberTokens.some((m) => m.includes(token) || token.includes(m))) score += 2;
    if (memberName.toLowerCase().includes(token)) score += 1;
  }
  return score;
}

export function mergeDumpspaceWithScriptResearch(
  dumpspace: DumpspaceImportSummary,
  scriptReport: CtScriptResearchReport,
): MergedUeScriptHint[] {
  return scriptReport.scripts.map((script) => {
    let bestMember = dumpspace.cheatCandidates[0];
    let bestScore = 0;
    for (const member of dumpspace.cheatCandidates) {
      const score = scoreMemberMatch(script.cheatName, member.memberName);
      if (score > bestScore) {
        bestScore = score;
        bestMember = member;
      }
    }

    const workflowSteps = [...script.workflowSteps];
    if (bestMember && bestScore >= 2) {
      workflowSteps.push(
        `UEDumper hint: ${bestMember.className}.${bestMember.memberName} @ 0x${bestMember.offset.toString(16)} (${bestMember.typeLabel})`,
      );
      workflowSteps.push('Cross-check diff results against this UE struct offset when the game is UE-based.');
    }

    return {
      cheatName: script.cheatName,
      scriptStrategy: bestMember && bestScore >= 2 ? 'ue_dumpspace_member' : script.replicationStrategy,
      ueClassMember: bestMember && bestScore >= 2 ? `${bestMember.className}.${bestMember.memberName}` : undefined,
      ueOffset: bestMember && bestScore >= 2 ? bestMember.offset : undefined,
      ueTypeLabel: bestMember && bestScore >= 2 ? bestMember.typeLabel : undefined,
      workflowSteps,
    };
  });
}
