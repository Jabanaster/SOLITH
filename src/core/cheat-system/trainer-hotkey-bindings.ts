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

for (let i = 1; i <= 11; i += 1) {
  DEFAULT_TRAINER_HOTKEYS[`cheat_slot_${i}`] = `F${i}`;
}
// Plain F12 is unreliable as a global shortcut: isolated real-Electron
// testing showed globalShortcut.register('F12', ...) returning false
// deterministically (18/18 runs) regardless of window/DevTools/order,
// while CommandOrControl+Shift+F12 registered successfully (3/3 runs).
DEFAULT_TRAINER_HOTKEYS.cheat_slot_12 = 'CommandOrControl+Shift+F12';

const SETTINGS_KEY = 'trainerHotkeyBindings';

/**
 * Bare F12 was the pre-fix default for cheat_slot_12 and registers false
 * 18/18 in real-Electron testing (see DEFAULT_TRAINER_HOTKEYS comment above).
 * Bindings persisted before the fix still carry this value, so it never
 * self-heals from the DEFAULT_TRAINER_HOTKEYS merge below (persisted values
 * win). Migrate it forward to the working default on load.
 */
const LEGACY_UNRELIABLE_SLOT_12_ACCELERATOR = 'F12';

export function getTrainerHotkeyBindings(): Record<string, string> {
  const raw = getSetting(SETTINGS_KEY as never);
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ...DEFAULT_TRAINER_HOTKEYS };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const merged = { ...DEFAULT_TRAINER_HOTKEYS, ...parsed };
    if (merged.cheat_slot_12 === LEGACY_UNRELIABLE_SLOT_12_ACCELERATOR) {
      merged.cheat_slot_12 = DEFAULT_TRAINER_HOTKEYS.cheat_slot_12;
      setSetting(SETTINGS_KEY as never, JSON.stringify(merged));
    }
    return merged;
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

/** Common OS / desktop shortcuts that may not reach the trainer reliably. */
export const OS_RESERVED_ACCELERATORS = new Set([
  'Alt+Tab',
  'Alt+F4',
  'Control+Alt+Delete',
  'Control+Shift+Escape',
  'Meta+L',
  'Meta+D',
  'Meta+Tab',
  'Super+L',
  'Super+D',
  'F11',
  'PrintScreen',
]);

export function detectOsHotkeyWarnings(
  bindings: Record<string, string>,
): Array<{ accelerator: string; action: string; reason: string }> {
  const warnings: Array<{ accelerator: string; action: string; reason: string }> = [];
  for (const [action, accel] of Object.entries(bindings)) {
    if (!accel?.trim()) continue;
    const normalized = accel.replace(/CommandOrControl/g, 'Control').replace(/Super/g, 'Meta');
    if (OS_RESERVED_ACCELERATORS.has(normalized)) {
      warnings.push({
        accelerator: accel,
        action,
        reason: 'May be captured by the OS or desktop shell before Solith receives it',
      });
    }
    if (/^Alt\+/i.test(normalized) && !normalized.startsWith('Alt+Shift')) {
      warnings.push({
        accelerator: accel,
        action,
        reason: 'Alt combinations often activate window menus on Windows',
      });
    }
  }
  return warnings;
}
