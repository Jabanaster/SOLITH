import { globalShortcut, BrowserWindow, ipcMain } from 'electron';
import { isTrainerCapabilityEnabled } from '../src/core/settings/unlock-trainer-capabilities.js';
import {
  detectHotkeyConflicts,
  getTrainerHotkeyBindings,
  setTrainerHotkeyBindings,
  type TrainerHotkeyAction,
} from '../src/core/cheat-system/trainer-hotkey-bindings.js';
import { hideTrainerOverlay, toggleTrainerOverlay } from './trainer-overlay.js';

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

  const bindings = getTrainerHotkeyBindings();
  let allOk = true;

  const toggleOk = globalShortcut.register(bindings.toggle_overlay, () => {
    if (!isTrainerCapabilityEnabled('v2OverlayEnabled')) {
      broadcastHotkey('toggle_overlay');
      return;
    }
    const visible = toggleTrainerOverlay();
    broadcastHotkey(visible ? 'toggle_overlay' : 'hide_overlay');
  });
  if (!toggleOk) allOk = false;

  const hideOk = globalShortcut.register(bindings.hide_overlay, () => {
    hideTrainerOverlay();
    broadcastHotkey('hide_overlay');
  });
  if (!hideOk) allOk = false;

  for (let i = 1; i <= 12; i += 1) {
    const action = `cheat_slot_${i}` as TrainerHotkeyAction;
    const key = bindings[action];
    if (!key) continue;
    const ok = globalShortcut.register(key, () => broadcastHotkey(action));
    if (!ok) allOk = false;
  }

  if (!allOk) {
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
    hotkeys: getTrainerHotkeyBindings(),
  }));

  ipcMain.handle('trainer-hotkeys-get-bindings', async () => ({
    success: true,
    hotkeys: getTrainerHotkeyBindings(),
    conflicts: detectHotkeyConflicts(getTrainerHotkeyBindings()),
  }));

  ipcMain.handle('trainer-hotkeys-set-bindings', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object' || !('hotkeys' in payload)) {
      return { success: false, error: 'invalid_payload' };
    }
    const hotkeys = (payload as { hotkeys: Record<string, string> }).hotkeys;
    const merged = setTrainerHotkeyBindings(hotkeys);
    const conflicts = detectHotkeyConflicts(merged);
    refreshTrainerHotkeys();
    return { success: true, hotkeys: merged, conflicts };
  });

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
