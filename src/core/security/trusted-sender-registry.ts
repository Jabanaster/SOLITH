/**
 * Centralized IPC sender validation for privileged handlers.
 *
 * `event.sender.isDestroyed()` alone only proves the WebContents object
 * hasn't been torn down — it says nothing about WHICH window sent the
 * request, whether it's the main frame (vs. a child/devtools frame), or
 * whether that window is still showing Solith's own content (vs. having
 * navigated somewhere else). This module tracks explicitly-registered
 * Solith windows and answers "is this sender one of ours, in its main
 * frame, still on an allowed URL" — the three questions isDestroyed()
 * cannot answer.
 *
 * Kept dependency-free (no Electron import) so it is unit-testable without
 * a real Electron runtime. electron/*.ts wires this against the real
 * BrowserWindow/WebContents/WebFrameMain objects at window-creation and
 * window-destruction time.
 */

export type SolithWindowType = 'main' | 'wisp-overlay' | 'trainer-overlay';

export interface TrustedWindowRegistration {
  webContentsId: number;
  windowType: SolithWindowType;
  /** URL prefixes this window is allowed to have loaded (dev server and/or packaged file://). */
  allowedUrlPrefixes: string[];
}

/** Minimal shape this needs from a real IPC event — trivially fakeable in tests. */
export interface SenderLike {
  webContentsId: number;
  isDestroyed: boolean;
  /** True when the frame that sent this IPC call is the WebContents' own main frame (not an iframe/devtools/child frame). */
  isMainFrame: boolean;
  /** The URL currently loaded in the sending frame. */
  frameUrl: string;
}

export interface SenderValidationResult {
  ok: boolean;
  reason?:
    | 'sender_destroyed'
    | 'unknown_sender'
    | 'not_main_frame'
    | 'unauthorized_window_type'
    | 'unauthorized_url';
  windowType?: SolithWindowType;
}

const trustedWindows = new Map<number, TrustedWindowRegistration>();

/** Called once per window at BrowserWindow creation time. */
export function registerTrustedWindow(registration: TrustedWindowRegistration): void {
  trustedWindows.set(registration.webContentsId, registration);
}

/** Called on the window's 'closed'/webContents 'destroyed' event. */
export function unregisterTrustedWindow(webContentsId: number): void {
  trustedWindows.delete(webContentsId);
}

/** Testing seam only. */
export function _clearTrustedWindowsForTests(): void {
  trustedWindows.clear();
}

/** Testing seam only — inspect current registrations without mutating them. */
export function _snapshotTrustedWindowsForTests(): TrustedWindowRegistration[] {
  return Array.from(trustedWindows.values());
}

/**
 * Validates that `sender` is a live, known, main-frame, on-an-allowed-URL
 * Solith window. Every check fails closed (missing/ambiguous data → reject).
 */
export function validateTrustedSender(
  sender: SenderLike,
  allowedWindowTypes?: readonly SolithWindowType[],
): SenderValidationResult {
  if (sender.isDestroyed) {
    return { ok: false, reason: 'sender_destroyed' };
  }
  const registration = trustedWindows.get(sender.webContentsId);
  if (!registration) {
    return { ok: false, reason: 'unknown_sender' };
  }
  if (!sender.isMainFrame) {
    return { ok: false, reason: 'not_main_frame' };
  }
  if (allowedWindowTypes && !allowedWindowTypes.includes(registration.windowType)) {
    return { ok: false, reason: 'unauthorized_window_type' };
  }
  const urlAllowed = registration.allowedUrlPrefixes.some((approvedUrl) =>
    isApprovedUrl(sender.frameUrl, approvedUrl),
  );
  if (!urlAllowed) {
    return { ok: false, reason: 'unauthorized_url' };
  }
  return { ok: true, windowType: registration.windowType };
}

function normalizedPathname(url: URL): string {
  if (/%2f|%5c/i.test(url.pathname)) return '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return '';
  }
  const normalized = decoded.replace(/\\/g, '/').replace(/\/+/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Exported for reuse by navigation/popup guards (electron/sender-validation.ts),
 * which must apply the exact same origin/path matching used for IPC sender
 * trust so a window's "allowed to navigate here" policy can't drift from its
 * "allowed to call privileged IPC from here" policy.
 */
export function isApprovedUrl(candidateValue: string, approvedValue: string): boolean {
  let candidate: URL;
  let approved: URL;
  try {
    candidate = new URL(candidateValue);
    approved = new URL(approvedValue);
  } catch {
    return false;
  }
  if (candidate.protocol !== approved.protocol) return false;

  const candidatePath = normalizedPathname(candidate);
  const approvedPath = normalizedPathname(approved);
  if (!candidatePath || !approvedPath) return false;

  if (approved.protocol === 'file:') {
    if (candidate.host.toLowerCase() !== approved.host.toLowerCase()) return false;
    return candidatePath === approvedPath;
  }

  if (candidate.origin !== approved.origin) return false;
  if (approvedPath === '/') return true;
  const boundary = approvedPath.endsWith('/') ? approvedPath : `${approvedPath}/`;
  return candidatePath === approvedPath || candidatePath.startsWith(boundary);
}

export function clearAllTrustedWindows(): void {
  trustedWindows.clear();
}
