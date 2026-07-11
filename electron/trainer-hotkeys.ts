import { globalShortcut, BrowserWindow, ipcMain } from 'electron';
import { isTrainerCapabilityEnabled } from '../src/core/settings/unlock-trainer-capabilities.js';
import { toggleTrainerOverlay, hideTrainerOverlay } from './trainer-overlay.js';

export type TrainerHotkeyAction =
  | 'toggle_overlay'
  | 'hide_overlay'
  | `cheat_slot_${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

const DEFAULT_HOTKEYS: Record<string, string> = {
  toggle_overlay: 'Control+Shift+O',
  hide_overlay: 'Control+Shift+\\',
};

for (let i = 1; i <= 12; i += 1) {
  DEFAULT_HOTKEYS[`cheat_slot_${i}`] = `F${i}`;
}

let registered = false;

function broadcastHotkey(action: TrainerHotkeyAction): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('trainer-hotkey', { action });
    }
  }
}

export function registerTrainerHotkeys(): void {
  if (registered) return;
  if (!isTrainerCapabilityEnabled('v2HotkeysEnabled')) return;

  const toggleOk = globalShortcut.register(DEFAULT_HOTKEYS.toggle_overlay, () => {
    if (!isTrainerCapabilityEnabled('v2OverlayEnabled')) {
      broadcastHotkey('toggle_overlay');
      return;
    }
    const visible = toggleTrainerOverlay();
    broadcastHotkey(visible ? 'toggle_overlay' : 'hide_overlay');
  });

  const hideOk = globalShortcut.register(DEFAULT_HOTKEYS.hide_overlay, () => {
    hideTrainerOverlay();
    broadcastHotkey('hide_overlay');
  });

  let cheatSlotsOk = true;
  for (let i = 1; i <= 12; i += 1) {
    const action = `cheat_slot_${i}` as TrainerHotkeyAction;
    const key = DEFAULT_HOTKEYS[action];
    const ok = globalShortcut.register(key, () => broadcastHotkey(action));
    if (!ok) cheatSlotsOk = false;
  }

  if (!toggleOk || !hideOk || !cheatSlotsOk) {
    // eslint-disable-next-line no-console
    console.warn('[trainer-hotkeys] Failed to register one or more global shortcuts');
  }

  registered = true;
}

export function unregisterTrainerHotkeys(): void {
  if (!registered) return;
  globalShortcut.unregisterAll();
  registered = false;
}

export function registerTrainerHotkeyIpc(): void {
  ipcMain.handle('trainer-hotkeys-get-defaults', async () => ({
    success: true,
    hotkeys: DEFAULT_HOTKEYS,
  }));

  ipcMain.handle('trainer-overlay-toggle', async () => {
    if (!isTrainerCapabilityEnabled('v2OverlayEnabled')) {
      return { success: false, error: 'overlay_disabled' };
    }
    const visible = toggleTrainerOverlay();
    return { success: true, visible };
  });

  ipcMain.handle('trainer-overlay-hide', async () => {
    hideTrainerOverlay();
    return { success: true };
  });
}

export function refreshTrainerHotkeys(): void {
  unregisterTrainerHotkeys();
  registerTrainerHotkeys();
}
