import { validatePathSafety } from '../safety/path-safety.js';
import type { AuthorityTarget } from './types.js';

export interface PathTargetClassification {
  safe: boolean;
  reason?: string;
  target: AuthorityTarget;
}

/**
 * Classifies a filesystem target for AuthorityRequest construction. Wraps
 * src/core/safety/path-safety.ts's validatePathSafety (PRESERVE) without
 * reimplementing containment/system-directory/symlink logic.
 */
export function classifyPathTarget(targetPath: string, approvedRoots: string[] = []): PathTargetClassification {
  const result = validatePathSafety(targetPath, approvedRoots);
  return {
    safe: result.safe,
    reason: result.reason,
    target: { kind: 'filesystem_path', identifier: targetPath },
  };
}
