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

  return entries.filter((entry) => entry.accelerator.trim().length > 0);
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
