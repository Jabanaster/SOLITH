import type { RuntimeModuleInfo } from './module-inspection.js';
import type { RuntimeProcessSummary } from './process-discovery.js';

export type ProtectedTargetCategory = 'anti_cheat' | 'protected_online_runtime' | 'drm_or_license';

export interface ProtectedTargetIndicator {
  category: ProtectedTargetCategory;
  vendor: string;
  indicator: string;
  source: 'process' | 'module' | 'path';
}

export interface ProtectedTargetAssessment {
  allowed: boolean;
  indicators: ProtectedTargetIndicator[];
  reason: string;
}

const BLOCKED_NAME_PATTERNS: Array<{
  category: ProtectedTargetCategory;
  vendor: string;
  pattern: RegExp;
}> = [
  { category: 'anti_cheat', vendor: 'BattlEye', pattern: /(^|[^a-z0-9])(be(service|client|daisy)|battleye)([^a-z0-9]|$)/i },
  { category: 'anti_cheat', vendor: 'Easy Anti-Cheat', pattern: /\b(easyanticheat|easyanticheat_eos|eac)\b/i },
  { category: 'anti_cheat', vendor: 'Riot Vanguard', pattern: /\b(vanguard|vgc|vgk)\b/i },
];

function classifyName(name: string, source: ProtectedTargetIndicator['source']): ProtectedTargetIndicator[] {
  const lower = name.toLowerCase();
  return BLOCKED_NAME_PATTERNS
    .filter(({ pattern }) => pattern.test(lower))
    .map(({ category, vendor, pattern }) => ({
      category,
      vendor,
      indicator: pattern.source,
      source,
    }));
}

export function assessProtectedTarget(input: {
  process: RuntimeProcessSummary;
  modules?: RuntimeModuleInfo[];
}): ProtectedTargetAssessment {
  const indicators: ProtectedTargetIndicator[] = [
    ...classifyName(input.process.executableName, 'process'),
    ...(input.process.executablePath ? classifyName(input.process.executablePath, 'path') : []),
    ...(input.modules ?? []).flatMap((module) => classifyName(module.name, 'module')),
  ];

  if (indicators.length > 0) {
    const vendors = [...new Set(indicators.map((indicator) => indicator.vendor))].join(', ');
    return {
      allowed: false,
      indicators,
      reason: `Protected target indicator detected (${vendors}); Solith must fail closed instead of attaching.`,
    };
  }

  return {
    allowed: true,
    indicators: [],
    reason: 'No protected target indicators detected.',
  };
}

export function assertProtectedTargetAllowed(input: {
  process: RuntimeProcessSummary;
  modules?: RuntimeModuleInfo[];
}): void {
  const assessment = assessProtectedTarget(input);
  if (!assessment.allowed) {
    throw new Error(assessment.reason);
  }
}
