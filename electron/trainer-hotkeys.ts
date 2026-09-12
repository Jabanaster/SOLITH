import { globalShortcut, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import type { SolithWindowType } from '../src/core/security/trusted-sender-registry.js';
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
  type TrainerHotkeyEntry,
} from '../src/core/cheat-system/trainer-hotkey-registration.js';
import { hideTrainerOverlay, toggleTrainerOverlay } from './trainer-overlay.js';

let registered = false;
let lastRegistrationResult: {
  registered: TrainerHotkeyEntry[];
  failed: Array<TrainerHotkeyEntry & { reason: string }>;
} = { registered: [], failed: [] };

/** Slots Electron actually rejected at last registration — for UI "needs remap" state. */
export function getTrainerHotkeyRegistrationStatus(): {
  registered: TrainerHotkeyEntry[];
  failed: Array<TrainerHotkeyEntry & { reason: string }>;
} {
  return lastRegistrationResult;
}

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

  lastRegistrationResult = result;
  registered = result.registered.length > 0 || result.failed.length > 0;
}

export function unregisterTrainerHotkeys(): void {
  if (!registered) return;
  unregisterTrainerHotkeyEntries(globalShortcut, console);
  registered = false;
  lastRegistrationResult = { registered: [], failed: [] };
}

function requireTrustedSender(
  event: IpcMainInvokeEvent,
  allowedWindowTypes: readonly SolithWindowType[],
): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, allowedWindowTypes);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

/**
 * Phase 7 B2 hardening — mirrors electron/main.ts's handleGuarded, but takes
 * an explicit allowedWindowTypes list per channel: hotkey config is a
 * main-window Settings concern, but trainer-overlay-toggle/hide are called
 * both from the main window (MultiGameTrainerPage) and by the trainer
 * overlay window itself (TrainerOverlayPage's own self-hide).
 */
function guardedHandle(
  channel: string,
  allowedWindowTypes: readonly SolithWindowType[],
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const senderCheck = requireTrustedSender(event, allowedWindowTypes);
    if (senderCheck.ok === false) {
      return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    }
    return listener(event, ...args);
  });
}

export function registerTrainerHotkeyIpc(): void {
  guardedHandle('trainer-hotkeys-get-defaults', ['main'], async () => ({
    success: true,
    hotkeys: getTrainerHotkeyBindings(),
  }));

  guardedHandle('trainer-hotkeys-get-bindings', ['main'], async () => {
    const hotkeys = getTrainerHotkeyBindings();
    return {
      success: true,
      hotkeys,
      conflicts: detectHotkeyConflicts(hotkeys),
      osWarnings: detectOsHotkeyWarnings(hotkeys),
    };
  });

  guardedHandle('trainer-hotkeys-set-bindings', ['main'], async (_event, payload: unknown) => {
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

  guardedHandle('trainer-hotkeys-get-status', ['main'], async () => ({
    success: true,
    failed: lastRegistrationResult.failed.map((entry) => ({
      action: entry.action,
      accelerator: entry.accelerator,
      reason: entry.reason,
    })),
  }));

  guardedHandle('trainer-overlay-toggle', ['main', 'trainer-overlay'], async () => {
    if (!isTrainerCapabilityEnabled('v2OverlayEnabled')) {
      return { success: false, error: 'overlay_disabled' };
    }
    const visible = toggleTrainerOverlay();
    return { success: true, visible };
  });

  guardedHandle('trainer-overlay-hide', ['main', 'trainer-overlay'], async () => {
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
