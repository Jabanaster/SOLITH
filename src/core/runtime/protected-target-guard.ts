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

// Finding 2 (independent security review, ef254d1): src/app/live-memory/process-picker.ts's
// BLOCKED_PROCESS_PATTERNS only filtered the renderer's process-picker UI list — a
// renderer bypassing that UI (or a compromised renderer) could still request the
// main process attach directly to a critical Windows process or to Solith's own
// process. This is the single authoritative, server-side policy: the canonical
// pattern list moved here so process-picker.ts imports it for UX filtering rather
// than maintaining its own copy, and LiveMemorySession.attach() enforces it
// directly (not merely trusting that the renderer already filtered).
export const BLOCKED_TARGET_PROCESS_PATTERNS: RegExp[] = [
  // Exact-name match only. A prefix match (/^solith/i) previously rejected
  // ANY executable merely starting with "solith" — including legitimate
  // unrelated local processes/test fixtures (e.g. SolithConsentGame.exe) —
  // even though PID and executable-path identity are already checked above.
  // This entry is defense-in-depth for Solith's own known packaged/dev
  // executable name, not a substring/branding filter.
  /^solith(?:\.exe)?$/i,
  /^electron/i,
  /^explorer(?:\.exe)?$/i,
  /^runtimebroker(?:\.exe)?$/i,
  /^applicationframehost(?:\.exe)?$/i,
  /^textinputhost(?:\.exe)?$/i,
  /^startmenuexperiencehost(?:\.exe)?$/i,
  /^shellexperiencehost(?:\.exe)?$/i,
  /^systemsettings(?:\.exe)?$/i,
  /^taskmgr(?:\.exe)?$/i,
  /^dwm(?:\.exe)?$/i,
  /^winlogon(?:\.exe)?$/i,
  /^csrss(?:\.exe)?$/i,
  /^lsass(?:\.exe)?$/i,
  /^services(?:\.exe)?$/i,
  /^svchost(?:\.exe)?$/i,
];

function normalizeTargetProcessName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^.*[\\/]/, '')
    .toLowerCase();
}

function normalizeTargetProcessPath(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\//g, '\\').toLowerCase();
}

export interface TargetProcessAuthorizationInput {
  pid: number;
  executableName: string;
  executablePath?: string | null;
}

export interface TargetProcessAuthorizationResult {
  allowed: boolean;
  reason: string;
}

/**
 * Authoritative, main-process-enforced check for whether a live-memory session
 * may attach to a target process at all — independent of, and not derived from,
 * whatever the renderer's process picker happened to display. Must be invoked
 * immediately before any attach authority is granted (see
 * LiveMemorySession.attach()), before the anti-cheat/DRM protectedTarget check,
 * and before opening a handle to the target process.
 */
export function assessTargetProcessAuthorization(
  target: TargetProcessAuthorizationInput,
): TargetProcessAuthorizationResult {
  if (!Number.isInteger(target.pid) || target.pid <= 0) {
    return { allowed: false, reason: 'Refusing to attach: target PID is invalid.' };
  }

  if (target.pid === process.pid) {
    return { allowed: false, reason: "Refusing to attach: target PID is Solith's own process." };
  }

  const name = normalizeTargetProcessName(target.executableName);
  if (!name) {
    return { allowed: false, reason: 'Refusing to attach: target process has no resolvable executable name.' };
  }

  if (BLOCKED_TARGET_PROCESS_PATTERNS.some((pattern) => pattern.test(name))) {
    return {
      allowed: false,
      reason: `Refusing to attach: "${target.executableName}" is a protected system/Solith process.`,
    };
  }

  const targetPath = normalizeTargetProcessPath(target.executablePath);
  const ownExecutablePath = normalizeTargetProcessPath(process.execPath);
  if (targetPath && ownExecutablePath && targetPath === ownExecutablePath) {
    return {
      allowed: false,
      reason: "Refusing to attach: target executable path matches Solith's own executable.",
    };
  }

  return { allowed: true, reason: 'No protected system/self-target indicators detected.' };
}

export function assertTargetProcessAllowed(target: TargetProcessAuthorizationInput): void {
  const result = assessTargetProcessAuthorization(target);
  if (!result.allowed) {
    throw new Error(result.reason);
  }
}
