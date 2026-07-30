import type { IpcMainInvokeEvent, WebContents } from 'electron';
import {
  registerTrustedWindow,
  unregisterTrustedWindow,
  validateTrustedSender,
  isApprovedUrl,
  type SolithWindowType,
  type SenderValidationResult,
} from '../src/core/security/trusted-sender-registry.js';

/**
 * Registers a BrowserWindow's WebContents as a trusted Solith sender and
 * wires automatic unregistration when it's destroyed. Call once, right
 * after the window is created and its URL is known.
 */
export function registerTrustedSolithWindow(
  webContents: WebContents,
  windowType: SolithWindowType,
  allowedUrlPrefixes: string[],
): void {
  registerTrustedWindow({ webContentsId: webContents.id, windowType, allowedUrlPrefixes });
  webContents.once('destroyed', () => {
    unregisterTrustedWindow(webContents.id);
  });
}

/**
 * Validates an IPC event's sender against the trusted-window registry.
 * Use this in place of a bare `event.sender.isDestroyed()` check for any
 * handler where sender identity (not just liveness) matters.
 */
export function validateIpcSender(
  event: IpcMainInvokeEvent,
  allowedWindowTypes?: readonly SolithWindowType[],
): SenderValidationResult {
  const sender = event.sender;
  if (sender.isDestroyed()) {
    return { ok: false, reason: 'sender_destroyed' };
  }
  const frame = event.senderFrame;
  if (!frame) {
    // Electron returns null when the originating frame has already been disposed —
    // fail closed rather than treat a vanished frame as trusted.
    return { ok: false, reason: 'sender_destroyed' };
  }
  return validateTrustedSender({
    webContentsId: sender.id,
    isDestroyed: false,
    isMainFrame: frame === sender.mainFrame,
    frameUrl: frame.url,
  }, allowedWindowTypes);
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Deny-by-default navigation and popup policy for a privileged Solith
 * BrowserWindow. Call once, right after `registerTrustedSolithWindow`, with
 * the SAME `allowedUrlPrefixes` used for that registration — a window may
 * only navigate within the exact origin(s)/path(s) it was already trusted
 * for. Blocks same-window navigation to any other http(s)/file/data/custom
 * scheme.
 *
 * Every `window.open()`/target="_blank" request is denied as an in-app
 * BrowserWindow — a popup never gets privileged preload access — but a
 * strictly `https:` request is handed off to the OS's default browser via
 * `shell.openExternal` first (the app has real https external links in its
 * UI, e.g. documentation/reference links, and they must keep working; only
 * the in-app popup surface is what's being removed). `electron` is imported
 * dynamically here, not at module top level, so this file stays runnable
 * under plain Node in unit tests (see tests/new1-new2-sender-validation.test.ts) —
 * outside a real Electron process the dynamic import resolves to a non-Electron
 * value and the openExternal call is a caught no-op.
 */
export function applyWindowNavigationPolicy(webContents: WebContents, allowedUrlPrefixes: string[]): void {
  webContents.on('will-navigate', (navigationEvent, targetUrl) => {
    const allowed = allowedUrlPrefixes.some((prefix) => isApprovedUrl(targetUrl, prefix));
    if (!allowed) {
      navigationEvent.preventDefault();
    }
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpsUrl(url)) {
      import('electron')
        .then((electron) => electron.shell?.openExternal(url))
        .catch(() => { /* not running under Electron (e.g. unit tests) — no-op */ });
    }
    return { action: 'deny' };
  });
}
