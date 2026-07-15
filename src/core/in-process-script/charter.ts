/**
 * In-process script execution — Milestone M pilot charter (authoritative).
 *
 * Quarantined experimental surface: default OFF, CrimsonDesert.exe only.
 * User-facing summary: Docs/IN_PROCESS_PILOT_SAFETY_CHARTER.md
 *
 * Older product messaging that said "no DLL injection" referred to the
 * mainstream live-memory path (ReadProcessMemory/WriteProcessMemory only).
 * This pilot intentionally adds opt-in code-cave / injector primitives and
 * must remain gated; it is not a general injection framework.
 */
export const IN_PROCESS_SCRIPT_MILESTONE = {
  id: 'in-process-script-execution',
  pilotGame: 'Crimson Desert',
  /** Sole allowed target — evaluateInProcessGate rejects every other executable. */
  pilotExecutables: ['CrimsonDesert.exe'] as const,
  /** Default for settings.inProcessScriptExecutionEnabled — must stay false. */
  defaultFeatureEnabled: false as const,
  capabilities: [
    'aa_hooks',
    'code_cave',
    'launch_injectors',
    'charter_gates',
  ] as const,
  safety: [
    'Feature flag inProcessScriptExecutionEnabled (default OFF — defaultFeatureEnabled: false)',
    'Offline / solo-play confirmation required',
    'Explicit user approval per hook install and per injector launch',
    'Online-session guard rechecked before every write/patch',
    'Pilot limited to CrimsonDesert.exe only',
    'Rollback restores original bytes and frees code cave',
    'User accepts ban / AV / ToS risk when opting in (see Docs/IN_PROCESS_PILOT_SAFETY_CHARTER.md)',
  ],
  notInScope: [
    'Kernel drivers or anti-cheat bypass',
    'Multiplayer / online session use',
    'Arbitrary AA compiler for all CE scripts (pilot presets + plans only)',
    'Any executable other than CrimsonDesert.exe',
  ],
} as const;
