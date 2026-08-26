import { getSetting, setSetting } from './index.js';

const TRAINER_CAPABILITY_KEYS = [
  'v2LiveModeEnabled',
  'v2HotkeysEnabled',
  'v2OverlayEnabled',
  'v2FreeformMemoryEnabled',
  'v2RemoteCatalogSyncEnabled',
  'v2AdaptiveWispHotkeysEnabled',
] as const;

/**
 * Capabilities that default to OFF when unset, inverting the general
 * default-on policy below. Adaptive Wisp hotkeys are a new privileged
 * execution surface (Increment 5) — unlike the existing broadcast-only
 * trainer hotkeys, activation reaches the reviewed Increment 4 executor and
 * can stage a real canonical proposal. Reusing the default-on policy would
 * auto-enable that without any existing product precedent (Section 13 of the
 * Increment 5 spec) — so this one capability opts in explicitly instead.
 */
const DEFAULT_OFF_CAPABILITY_KEYS: ReadonlySet<(typeof TRAINER_CAPABILITY_KEYS)[number]> = new Set(['v2AdaptiveWispHotkeysEnabled']);

/**
 * One-time unlock for live trainer parity (mainstream one-click trainer class UX).
 * Enables live memory, global hotkeys, and the in-game overlay unless the
 * user has explicitly disabled a capability after unlock.
 */
export function unlockTrainerCapabilities(): void {
  const migrated = getSetting('trainerCapabilitiesUnlocked');
  if (migrated === true) return;

  for (const key of TRAINER_CAPABILITY_KEYS) {
    if (DEFAULT_OFF_CAPABILITY_KEYS.has(key)) continue;
    setSetting(key, true);
  }

  setSetting('trainerCapabilitiesUnlocked', true);
}

export function isTrainerCapabilityEnabled(
  key: (typeof TRAINER_CAPABILITY_KEYS)[number],
): boolean {
  const value = getSetting(key);
  if (value === undefined) return !DEFAULT_OFF_CAPABILITY_KEYS.has(key);
  return value === true || value === 1;
}
