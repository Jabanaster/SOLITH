/**
 * Trainer applicability boundary (ROADMAP.md Phase 3: prevent a trainer
 * from attaching to the wrong executable within an otherwise-correctly-
 * identified game install — e.g. its launcher, updater, or a benchmark
 * binary — rather than the actual game process).
 *
 * This is a standalone, read-only Phase 3 interface. It does not attach to
 * anything and does not touch Phase 2's pointer/attach internals — any
 * future live-memory/Zero-Input attach code that wants this check can call
 * it, but this module stops at exposing the check, per this stage's
 * explicit boundary.
 */
import path from 'node:path';
import { classifyExecutableRoles, type ExecutableRole } from './executable-role.js';

export interface TrainerApplicabilityResult {
  applicable: boolean;
  role: ExecutableRole;
  reason?: 'wrong_executable_role';
}

const APPLICABLE_ROLES: ReadonlySet<ExecutableRole> = new Set(['PRIMARY_GAME', 'ALTERNATE_GAME']);

/**
 * Whether a trainer/definition may target this executable at all, based on
 * its classified role. A launcher, updater, benchmark, tool, dedicated
 * server, or anti-cheat bootstrap is never a valid trainer target even if
 * its filename happens to match a catalog entry's declared executables —
 * bad catalog data (a launcher mistakenly listed among a game's
 * executables) or a scanner picking up the wrong binary should not be able
 * to attach a trainer to the wrong process.
 */
export function checkExecutableRoleApplicability(executablePath: string): TrainerApplicabilityResult {
  const name = path.basename(executablePath);
  const parentDirName = path.basename(path.dirname(executablePath));
  const role =
    classifyExecutableRoles([name], { parentDirectoryByName: { [name]: parentDirName } }).get(name) ?? 'UNKNOWN';
  if (APPLICABLE_ROLES.has(role)) {
    return { applicable: true, role };
  }
  return { applicable: false, role, reason: 'wrong_executable_role' };
}
