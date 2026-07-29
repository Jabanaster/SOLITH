import type { IpcMainInvokeEvent, WebContents } from 'electron';
import {
  registerTrustedWindow,
  unregisterTrustedWindow,
  validateTrustedSender,
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
