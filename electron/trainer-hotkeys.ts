import { globalShortcut, BrowserWindow, ipcMain } from 'electron';
import { isTrainerCapabilityEnabled } from '../src/core/settings/unlock-trainer-capabilities.js';
import { toggleTrainerOverlay, hideTrainerOverlay } from './trainer-overlay.js';

export type TrainerHotkeyAction =
  | 'toggle_overlay'
  | 'hide_overlay';

const DEFAULT_HOTKEYS: Record<TrainerHotkeyAction, string> = {
  toggle_overlay: 'Control+Shift+O',
  hide_overlay: 'Control+Shift+\\',
};

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

  if (!toggleOk || !hideOk) {
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
