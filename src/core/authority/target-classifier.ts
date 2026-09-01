import type { RuntimeProcessSummary } from '../runtime/process-discovery.js';
import type { RuntimeModuleInfo } from '../runtime/module-inspection.js';
import {
  assessProtectedTarget,
  assessTargetProcessAuthorization,
} from '../runtime/protected-target-guard.js';
import type { AuthorityTarget, AuthorityContext } from './types.js';

export type ProcessTargetClass =
  | 'self'
  | 'system'
  | 'anti_cheat'
  | 'protected'
  | 'supported_game'
  | 'unknown_process';

export interface ProcessTargetClassification {
  targetClass: ProcessTargetClass;
  protectedTargetState: AuthorityContext['protectedTargetState'];
  target: AuthorityTarget;
  reason: string;
}

/**
 * Classifies a process target for AuthorityRequest construction. This is a
 * bridge helper, not a policy rule — it wraps the two existing PRESERVE-
 * disposition checks (src/core/runtime/protected-target-guard.ts) without
 * reimplementing their logic, and is deliberately conservative: anything not
 * explicitly recognized as self/system/known-catalog-game becomes
 * `unknown_process`, matching SOL-0's documented "arbitrary process minus
 * deny-listed targets" scope (G3) rather than silently narrowing it.
 */
export function classifyProcessTarget(input: {
  process: RuntimeProcessSummary;
  pid: number;
  modules?: RuntimeModuleInfo[];
  isKnownCatalogGame?: boolean;
}): ProcessTargetClassification {
  const identityCheck = assessTargetProcessAuthorization({
    pid: input.pid,
    executableName: input.process.executableName,
    executablePath: input.process.executablePath,
  });

  const target: AuthorityTarget = {
    kind: 'process',
    identifier: input.process.executableName,
    detail: { pid: input.pid, executablePath: input.process.executablePath ?? undefined },
  };

  if (!identityCheck.allowed) {
    const targetClass: ProcessTargetClass = identityCheck.blockedKind === 'self' ? 'self' : 'system';
    return {
      targetClass,
      protectedTargetState: 'blocked',
      target,
      reason: identityCheck.reason,
    };
  }

  const protectedCheck = assessProtectedTarget({ process: input.process, modules: input.modules });
  if (!protectedCheck.allowed) {
    return { targetClass: 'anti_cheat', protectedTargetState: 'blocked', target, reason: protectedCheck.reason };
  }

  if (input.isKnownCatalogGame) {
    return { targetClass: 'supported_game', protectedTargetState: 'clear', target, reason: 'Target matches a supported catalog game entry.' };
  }

  return {
    targetClass: 'unknown_process',
    protectedTargetState: 'clear',
    target,
    reason: 'Target passed identity/protected-target checks but is not a recognized catalog game (SOL-0 G3: unknown-process attach remains permitted, not silently narrowed).',
  };
}
