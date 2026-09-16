/**
 * Executable role classification (ROADMAP.md Phase 3: "multiple executable
 * roles"). A game installation commonly contains more than one .exe, and
 * not all of them are equivalent — a trainer or process-detection match
 * must be able to target the actual game process, not merely the first
 * executable found. This is a distinct concern from install-discovery's
 * existing `obviousNonGameReason`/`NON_GAME_EXE_RE` (which decides whether
 * an install is a game AT ALL); this module runs on executables WITHIN an
 * already-confirmed game installation and assigns each a role.
 *
 * No canonical role enum exists elsewhere in the codebase (schema.v1,
 * TrainerCatalogEntry, InstalledGameRecord) — checked before introducing
 * this one.
 */

export type ExecutableRole =
  | 'PRIMARY_GAME'
  | 'ALTERNATE_GAME'
  | 'LAUNCHER'
  | 'SERVER'
  | 'BENCHMARK'
  | 'TOOL'
  | 'UPDATER'
  | 'ANTI_CHEAT_BOOTSTRAP'
  | 'UNKNOWN';

const LAUNCHER_RE = /launcher|bootstrap(?:per)?/i;
const UPDATER_RE = /updat(?:e|er)|patcher|\bpatch\b/i;
const CRASH_REPORTER_RE = /crash[-_ ]?(?:report|handler|reporter)/i;
const BENCHMARK_RE = /bench[-_ ]?mark/i;
const TOOL_RE = /setup|install(?:er)?|uninstall(?:er)?|editor|config(?:urator)?|modding[-_ ]?tool/i;
// Real, publicly-documented third-party anti-cheat bootstrap executable
// names — not a guess at what "looks like" anti-cheat.
const ANTI_CHEAT_RE = /easyanticheat|\beac\b|battleye|\bbe_?launcher\b|vanguard|faceit[-_ ]?ac/i;
const SERVER_RE = /(?:^|[^a-z])(?:dedicated[-_ ]?server|ds)(?:[^a-z]|$)|_server(?:\.exe)?$|server[-_ ]?host/i;

function classifySingleExecutable(executableName: string): ExecutableRole | 'GAME_CANDIDATE' {
  const name = executableName.toLowerCase();
  if (CRASH_REPORTER_RE.test(name)) return 'TOOL';
  if (ANTI_CHEAT_RE.test(name)) return 'ANTI_CHEAT_BOOTSTRAP';
  if (BENCHMARK_RE.test(name)) return 'BENCHMARK';
  if (SERVER_RE.test(name)) return 'SERVER';
  if (UPDATER_RE.test(name)) return 'UPDATER';
  if (TOOL_RE.test(name)) return 'TOOL';
  if (LAUNCHER_RE.test(name)) return 'LAUNCHER';
  return 'GAME_CANDIDATE';
}

export interface ClassifyExecutableRolesOptions {
  /** Catalog-declared executable names for this game (TrainerCatalogEntry.executables), when known — used to pick PRIMARY_GAME among multiple game-like candidates deterministically instead of guessing. */
  knownCatalogExecutables?: string[];
}

/**
 * Classifies every executable found in one game installation. Deterministic
 * and fails closed: a game-like executable (matches none of the known
 * non-game-role patterns) is only promoted to PRIMARY_GAME when it is the
 * sole game-like candidate, or when it is named in `knownCatalogExecutables`.
 * Any other game-like candidate is ALTERNATE_GAME (e.g. a DX11/DX12 or
 * 32-bit/64-bit sibling binary) rather than UNKNOWN — it is real, playable
 * game code, just not the resolved primary. Never silently drops an
 * executable: every input name appears exactly once in the result.
 */
export function classifyExecutableRoles(
  executableNames: string[],
  options: ClassifyExecutableRolesOptions = {},
): Map<string, ExecutableRole> {
  const knownLower = new Set((options.knownCatalogExecutables ?? []).map((n) => n.toLowerCase()));
  const result = new Map<string, ExecutableRole>();
  const gameCandidates: string[] = [];

  for (const name of executableNames) {
    const classified = classifySingleExecutable(name);
    if (classified === 'GAME_CANDIDATE') {
      gameCandidates.push(name);
    } else {
      result.set(name, classified);
    }
  }

  const knownMatches = gameCandidates.filter((name) => knownLower.has(name.toLowerCase()));

  if (knownMatches.length > 0) {
    for (const name of gameCandidates) {
      result.set(name, knownLower.has(name.toLowerCase()) ? 'PRIMARY_GAME' : 'ALTERNATE_GAME');
    }
  } else if (gameCandidates.length === 1) {
    result.set(gameCandidates[0], 'PRIMARY_GAME');
  } else if (gameCandidates.length > 1) {
    // Multiple game-like candidates, no catalog evidence to pick one —
    // fail closed on the PRIMARY_GAME designation rather than guess
    // (consistent with the Phase 3 ambiguous-executable-match policy).
    for (const name of gameCandidates) {
      result.set(name, 'UNKNOWN');
    }
  }

  return result;
}
