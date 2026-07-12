/**
 * Persisted global trainer hotkey bindings (main process settings).
 */
import { getSetting, setSetting } from '../settings/index.js';

export type TrainerHotkeyAction =
  | 'toggle_overlay'
  | 'hide_overlay'
  | `cheat_slot_${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

export const DEFAULT_TRAINER_HOTKEYS: Record<string, string> = {
  toggle_overlay: 'Control+Shift+O',
  hide_overlay: 'Control+Shift+\\',
};

for (let i = 1; i <= 12; i += 1) {
  DEFAULT_TRAINER_HOTKEYS[`cheat_slot_${i}`] = `F${i}`;
}

const SETTINGS_KEY = 'trainerHotkeyBindings';

export function getTrainerHotkeyBindings(): Record<string, string> {
  const raw = getSetting(SETTINGS_KEY as never);
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ...DEFAULT_TRAINER_HOTKEYS };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return { ...DEFAULT_TRAINER_HOTKEYS, ...parsed };
  } catch {
    return { ...DEFAULT_TRAINER_HOTKEYS };
  }
}

export function setTrainerHotkeyBindings(bindings: Record<string, string>): Record<string, string> {
  const merged = { ...DEFAULT_TRAINER_HOTKEYS, ...bindings };
  setSetting(SETTINGS_KEY as never, JSON.stringify(merged));
  return merged;
}

export function detectHotkeyConflicts(
  bindings: Record<string, string>,
): Array<{ accelerator: string; actions: string[] }> {
  const byAccel = new Map<string, string[]>();
  for (const [action, accel] of Object.entries(bindings)) {
    if (!accel?.trim()) continue;
    const list = byAccel.get(accel) ?? [];
    list.push(action);
    byAccel.set(accel, list);
  }
  return [...byAccel.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([accelerator, actions]) => ({ accelerator, actions }));
}
