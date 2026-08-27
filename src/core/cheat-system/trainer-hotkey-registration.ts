import type { TrainerHotkeyAction } from './trainer-hotkey-bindings.js';

export type TrainerHotkeyEntry = {
  action: TrainerHotkeyAction;
  accelerator: string;
  description: string;
};

export type TrainerShortcutApi = {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  isRegistered: (accelerator: string) => boolean;
};

export type TrainerHotkeyLogger = Pick<Console, 'info' | 'warn'>;

const ownedTrainerShortcuts = new Set<string>();

export function getTrainerHotkeyEntries(bindings: Record<string, string>): TrainerHotkeyEntry[] {
  const entries: TrainerHotkeyEntry[] = [
    {
      action: 'toggle_overlay',
      accelerator: bindings.toggle_overlay,
      description: 'toggle trainer overlay',
    },
    {
      action: 'hide_overlay',
      accelerator: bindings.hide_overlay,
      description: 'hide trainer overlay',
    },
  ];

  for (let i = 1; i <= 12; i += 1) {
    const action = `cheat_slot_${i}` as TrainerHotkeyAction;
    const accelerator = bindings[action];
    if (!accelerator) continue;
    entries.push({
      action,
      accelerator,
      description: `trigger trainer slot ${i}`,
    });
  }

  // Increment 5 — Adaptive Wisp quick slots. Deliberately no default
  // accelerator (see DEFAULT_TRAINER_HOTKEYS) so they never silently collide
  // with the existing cheat_slot_1..6 F1-F6 defaults; only a user-configured
  // binding reaches this list. Merging into the SAME entries array/call as
  // cheat_slot means conflict detection and dedup-by-accelerator (the
  // registration engine's ownedTrainerShortcuts set) apply uniformly across
  // both hotkey families for free.
  for (let i = 1; i <= 6; i += 1) {
    const action = `wisp_slot_${i}` as TrainerHotkeyAction;
    const accelerator = bindings[action];
    if (!accelerator) continue;
    entries.push({
      action,
      accelerator,
      description: `activate Wisp quick slot ${i}`,
    });
  }

  return entries.filter((entry) => entry.accelerator.trim().length > 0);
}

/**
 * Excludes every entry whose accelerator is claimed by more than one action
 * (Increment 5, Section 21/22/47/48). The registration engine below has no
 * cross-entry conflict detection of its own — given two entries that share
 * one accelerator in the same call, whichever is processed second silently
 * takes over the first's registration via the owned-shortcut re-bind path.
 * That is fine when it is the SAME action re-registering its own key (a
 * remap), but wrong when two DIFFERENT actions collide — nothing should
 * silently steal a key from another action. Filtering conflicts out here,
 * before registration, keeps that guarantee for every hotkey family that
 * reuses this engine, without changing register/unregister's own behavior.
 */
export function filterOutConflictingEntries(entries: TrainerHotkeyEntry[]): TrainerHotkeyEntry[] {
  const countByAccelerator = new Map<string, number>();
  for (const entry of entries) {
    countByAccelerator.set(entry.accelerator, (countByAccelerator.get(entry.accelerator) ?? 0) + 1);
  }
  return entries.filter((entry) => countByAccelerator.get(entry.accelerator) === 1);
}

/**
 * Pure composition of the three decisions `registerTrainerHotkeys()` (in
 * electron/trainer-hotkeys.ts) makes before ever touching `globalShortcut`:
 * drop wisp_slot_* bindings entirely when the feature is disabled, build the
 * entries list, then filter out cross-entry conflicts. Extracted so this
 * exact composed decision is unit-testable without importing 'electron'
 * (review-discovered test-integrity gap, Increment 5 remediation — the
 * individual pieces were tested, but nothing exercised them wired together
 * the way the real function actually calls them).
 */
export function buildTrainerHotkeyRegistrationPlan(bindings: Record<string, string>, options: { wispEnabled: boolean }): TrainerHotkeyEntry[] {
  const filteredBindings = options.wispEnabled ? bindings : Object.fromEntries(Object.entries(bindings).filter(([action]) => !action.startsWith('wisp_slot_')));
  return filterOutConflictingEntries(getTrainerHotkeyEntries(filteredBindings));
}

export function registerTrainerHotkeyEntries(
  entries: TrainerHotkeyEntry[],
  shortcutApi: TrainerShortcutApi,
  callbackForAction: (action: TrainerHotkeyAction) => () => void,
  logger: TrainerHotkeyLogger = console,
): { registered: TrainerHotkeyEntry[]; failed: Array<TrainerHotkeyEntry & { reason: string }> } {
  const registered: TrainerHotkeyEntry[] = [];
  const failed: Array<TrainerHotkeyEntry & { reason: string }> = [];

  for (const entry of entries) {
    if (ownedTrainerShortcuts.has(entry.accelerator)) {
      shortcutApi.unregister(entry.accelerator);
      ownedTrainerShortcuts.delete(entry.accelerator);
    } else if (shortcutApi.isRegistered(entry.accelerator)) {
      failed.push({ ...entry, reason: 'shortcut already registered' });
      logger.warn(`[trainer-hotkeys] failed ${entry.accelerator} -> ${entry.description}: shortcut already registered`);
      continue;
    }

    const ok = shortcutApi.register(entry.accelerator, callbackForAction(entry.action));
    if (ok) {
      ownedTrainerShortcuts.add(entry.accelerator);
      registered.push(entry);
      logger.info(`[trainer-hotkeys] registered ${entry.accelerator} -> ${entry.description}`);
    } else {
      failed.push({ ...entry, reason: 'Electron rejected accelerator' });
      logger.warn(`[trainer-hotkeys] failed ${entry.accelerator} -> ${entry.description}: Electron rejected accelerator`);
    }
  }

  return { registered, failed };
}

export function unregisterTrainerHotkeyEntries(
  shortcutApi: Pick<TrainerShortcutApi, 'unregister'>,
  logger: TrainerHotkeyLogger = console,
): string[] {
  const unregistered: string[] = [];
  for (const accelerator of ownedTrainerShortcuts) {
    shortcutApi.unregister(accelerator);
    unregistered.push(accelerator);
    logger.info(`[trainer-hotkeys] unregistered ${accelerator}`);
  }
  ownedTrainerShortcuts.clear();
  return unregistered;
}

export function resetTrainerHotkeysForTests(): void {
  ownedTrainerShortcuts.clear();
}
