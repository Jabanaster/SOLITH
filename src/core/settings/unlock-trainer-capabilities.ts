import { getSetting, setSetting } from './index.js';

const TRAINER_CAPABILITY_KEYS = [
  'v2LiveModeEnabled',
  'v2HotkeysEnabled',
  'v2OverlayEnabled',
  'v2FreeformMemoryEnabled',
  'v2RemoteCatalogSyncEnabled',
] as const;

/**
 * One-time unlock for live trainer parity (mainstream one-click trainer class UX).
 * Enables live memory, global hotkeys, and the in-game overlay unless the
 * user has explicitly disabled a capability after unlock.
 */
export function unlockTrainerCapabilities(): void {
  const migrated = getSetting('trainerCapabilitiesUnlocked');
  if (migrated === true) return;

  for (const key of TRAINER_CAPABILITY_KEYS) {
    setSetting(key, true);
  }

  setSetting('trainerCapabilitiesUnlocked', true);
}

export function isTrainerCapabilityEnabled(
  key: (typeof TRAINER_CAPABILITY_KEYS)[number],
): boolean {
  const value = getSetting(key);
  if (value === undefined) return true;
  return value === true || value === 1;
}
