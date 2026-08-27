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
  buildTrainerHotkeyRegistrationPlan,
  registerTrainerHotkeyEntries,
  unregisterTrainerHotkeyEntries,
} from '../src/core/cheat-system/trainer-hotkey-registration.js';
import { hideTrainerOverlay, toggleTrainerOverlay } from './trainer-overlay.js';
import { getAdaptiveWispQuickSlotController } from './adaptive-wisp-hotkey-composition.js';
import { isWispQuickSlot } from '../src/core/adaptive-wisp/hotkey-types.js';

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
  const wispEnabled = isTrainerCapabilityEnabled('v2AdaptiveWispHotkeysEnabled');

  // Section 21/22/47/48 — deterministic conflict handling, no silently
  // stolen key, for every hotkey family; feature-flag gating for wisp_slot_*
  // (see buildTrainerHotkeyRegistrationPlan, unit-tested directly).
  const entries = buildTrainerHotkeyRegistrationPlan(bindings, { wispEnabled });
  const result = registerTrainerHotkeyEntries(entries, globalShortcut, getTrainerHotkeyCallback, console);

  registered = result.registered.length > 0 || result.failed.length > 0;
}

export function unregisterTrainerHotkeys(): void {
  if (!registered) return;
  unregisterTrainerHotkeyEntries(globalShortcut, console);
  registered = false;
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

  const wispSlotMatch = /^wisp_slot_(\d+)$/.exec(action);
  if (wispSlotMatch) {
    const slot = Number(wispSlotMatch[1]);
    if (isWispQuickSlot(slot)) {
      // Increment 5 — the ONLY thing a Wisp quick-slot hotkey does: hand off
      // to the already-reviewed Increment 4 executor via the quick-slot
      // controller. No memory write, freeze, process attach, or consent
      // minting happens here or anywhere in the controller (Section 3/10).
      return () => {
        // globalShortcut callbacks are synchronous void — this is the
        // unavoidable outermost async boundary (not the internal
        // executeWispAction/confirmWrite chain, which stays fully awaited
        // inside the controller). Caught, never left as an unhandled
        // rejection; a caught error is treated the same as any other
        // fail-closed diagnostic — no mutation either way.
        getAdaptiveWispQuickSlotController()
          .activate(slot)
          .catch((error: unknown) => console.warn('[adaptive-wisp-hotkeys] activation failed', error));
      };
    }
  }

  return () => broadcastHotkey(action);
}
