export const IN_PROCESS_SCRIPT_MILESTONE = {
  id: 'in-process-script-execution',
  pilotGame: 'Crimson Desert',
  pilotExecutables: ['CrimsonDesert.exe'] as const,
  capabilities: [
    'aa_hooks',
    'code_cave',
    'launch_injectors',
    'charter_gates',
  ] as const,
  safety: [
    'Feature flag inProcessScriptExecutionEnabled (default OFF)',
    'Offline / solo-play confirmation required',
    'Explicit user approval per hook install and per injector launch',
    'Online-session guard rechecked before every write/patch',
    'Pilot limited to CrimsonDesert.exe only',
    'Rollback restores original bytes and frees code cave',
  ],
  notInScope: [
    'Kernel drivers or anti-cheat bypass',
    'Multiplayer / online session use',
    'Arbitrary AA compiler for all CE scripts (pilot presets + plans only)',
  ],
} as const;
