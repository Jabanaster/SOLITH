import { globalShortcut, BrowserWindow, ipcMain } from 'electron';
import { isTrainerCapabilityEnabled } from '../src/core/settings/unlock-trainer-capabilities.js';
import {
  detectHotkeyConflicts,
  detectOsHotkeyWarnings,
  getTrainerHotkeyBindings,
  setTrainerHotkeyBindings,
  type TrainerHotkeyAction,
} from '../src/core/cheat-system/trainer-hotkey-bindings.js';
import {
  getTrainerHotkeyEntries,
  registerTrainerHotkeyEntries,
  unregisterTrainerHotkeyEntries,
} from '../src/core/cheat-system/trainer-hotkey-registration.js';
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
  const entries = getTrainerHotkeyEntries(bindings);
  const result = registerTrainerHotkeyEntries(entries, globalShortcut, getTrainerHotkeyCallback, console);

  registered = result.registered.length > 0 || result.failed.length > 0;
}

export function unregisterTrainerHotkeys(): void {
  if (!registered) return;
  unregisterTrainerHotkeyEntries(globalShortcut, console);
  registered = false;
}

export function registerTrainerHotkeyIpc(): void {
  ipcMain.handle('trainer-hotkeys-get-defaults', async () => ({
    success: true,
    hotkeys: getTrainerHotkeyBindings(),
  }));

  ipcMain.handle('trainer-hotkeys-get-bindings', async () => {
    const hotkeys = getTrainerHotkeyBindings();
    return {
      success: true,
      hotkeys,
      conflicts: detectHotkeyConflicts(hotkeys),
      osWarnings: detectOsHotkeyWarnings(hotkeys),
    };
  });

  ipcMain.handle('trainer-hotkeys-set-bindings', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object' || !('hotkeys' in payload)) {
      return { success: false, error: 'invalid_payload' };
    }
    const hotkeys = (payload as { hotkeys: Record<string, string> }).hotkeys;
    const merged = setTrainerHotkeyBindings(hotkeys);
    const conflicts = detectHotkeyConflicts(merged);
    const osWarnings = detectOsHotkeyWarnings(merged);
    refreshTrainerHotkeys();
    return { success: true, hotkeys: merged, conflicts, osWarnings };
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

function getTrainerHotkeyCallback(action: TrainerHotkeyAction): () => void {
  if (action === 'toggle_overlay') {
    return () => {
      if (!isTrainerCapabilityEnabled('v2OverlayEnabled')) {
        broadcastHotkey('toggle_overlay');
        return;
      }
      const visible = toggleTrainerOverlay();
      broadcastHotkey(visible ? 'toggle_overlay' : 'hide_overlay');
    };
  }

  if (action === 'hide_overlay') {
    return () => {
      hideTrainerOverlay();
      broadcastHotkey('hide_overlay');
    };
  }

  return () => broadcastHotkey(action);
}
