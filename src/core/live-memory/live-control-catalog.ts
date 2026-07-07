import type { LiveValueType } from './types.js';
import type { LivePointerPath } from './pointer-resolver.js';

/**
 * A named, reusable live-memory trainer control backed by a restart-stable
 * pointer path — the live-memory equivalent of a file-based ProfileControl
 * (src/core/game-profiles/types.ts), but deliberately kept as a SEPARATE
 * catalog rather than added to GameProfile.controls[]: that system's
 * validateGameProfile() explicitly rejects 'memory_write'/'memory_observation'
 * backends as executable ("memory backends cannot be executable in V1
 * profiles") — a deliberate V1 safety boundary this feature must not weaken
 * or route around. This catalog is consumed only by the separately
 * feature-flagged (`v2LiveModeEnabled`) Live Memory Trainer UI/IPC.
 *
 * Every entry must be backed by real, restart-verified discovery — not a
 * guess. See the Atomfall entry below for the investigation that produced
 * it (scan for a known value -> narrow with a next scan -> reverse pointer
 * scan -> re-verified against a freshly relaunched process with a new ASLR
 * base and new heap layout).
 */
export interface LiveTrainerControl {
  id: string;
  executableName: string;
  label: string;
  description: string;
  dataType: LiveValueType;
  pointerPath: LivePointerPath;
  constraints?: { min?: number; max?: number };
  discoveredAt: string;
  evidence: string;
}

const CONTROLS: LiveTrainerControl[] = [
  {
    id: 'atomfall-current-weapon-ammo',
    executableName: 'Atomfall_dx12.exe',
    label: 'Set Current Weapon Ammo',
    description: 'Sets the loaded ammo count for your currently equipped weapon.',
    dataType: 'int32',
    pointerPath: { moduleName: 'atomfall_dx12.exe', moduleOffset: 0x1959a28, offsets: [24] },
    constraints: { min: 0, max: 999 },
    discoveredAt: '2026-07-06',
    evidence:
      'Discovered live against a real, running Atomfall process: scanFirst found the exact on-screen ' +
      'ammo value (99) at a single candidate address; scanNext (exact) narrowed 5000 candidates for ' +
      'the generic value 99 down to 1 after the value changed to 98; scanForPointerPath then found ' +
      '20 static candidate paths, of which only this one still resolved to the correct, current, ' +
      'on-screen value (97) after the game was fully closed and relaunched (new PID, new ASLR base, ' +
      'new heap layout) — the other 19 resolved to garbage (near-null pointers, a repeated poison ' +
      'value, or plain zero), confirming they were session-local coincidences, not real pointers.',
  },
];

export function listControlsForGame(executableName: string): LiveTrainerControl[] {
  return CONTROLS.filter((c) => c.executableName.toLowerCase() === executableName.toLowerCase());
}

export function getControl(id: string): LiveTrainerControl | undefined {
  return CONTROLS.find((c) => c.id === id);
}

export function listAllControls(): LiveTrainerControl[] {
  return [...CONTROLS];
}
