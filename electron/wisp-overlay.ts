import { BrowserWindow, app, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import type { SolithWindowType } from '../src/core/security/trusted-sender-registry.js';
import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTrustedSolithWindow, applyWindowNavigationPolicy } from './sender-validation.js';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

const COLLAPSED_BOUNDS = { width: 178, height: 188 };
const EXPANDED_BOUNDS = { width: 760, height: 560 };
const EDGE_PADDING = 16;

type WispOverlayPosition = {
  x: number;
  y: number;
};

let wispOverlayWindow: BrowserWindow | null = null;
let wispOverlayExpanded = false;
let wispOverlayInteractive = false;

function wispOverlayUrl(): string {
  const isDev = process.argv.includes('--dev') || process.env.SOLITH_DEV === '1';
  if (isDev) {
    return 'http://localhost:3000/#wisp-overlay';
  }
  return `file://${path.join(moduleDirectory, 'dist/index.html')}#wisp-overlay`;
}

function positionFilePath(): string {
  return path.join(app.getPath('userData'), 'wisp-overlay-position.json');
}

function clampPosition(position: WispOverlayPosition, width: number, height: number): WispOverlayPosition {
  const display = screen.getDisplayNearestPoint({ x: position.x, y: position.y });
  const workArea = display.workArea;
  const minX = workArea.x + EDGE_PADDING;
  const minY = workArea.y + EDGE_PADDING;
  const maxX = workArea.x + workArea.width - width - EDGE_PADDING;
  const maxY = workArea.y + workArea.height - height - EDGE_PADDING;
  return {
    x: Math.min(Math.max(position.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(position.y, minY), Math.max(minY, maxY)),
  };
}

function defaultCollapsedPosition(): WispOverlayPosition {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: workArea.x + workArea.width - COLLAPSED_BOUNDS.width - 24,
    y: workArea.y + workArea.height - COLLAPSED_BOUNDS.height - 24,
  };
}

function readStoredPosition(): WispOverlayPosition {
  try {
    const raw = fs.readFileSync(positionFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WispOverlayPosition>;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: Number(parsed.x), y: Number(parsed.y) };
    }
  } catch {
    // Best-effort local preference. Fall back to the current display.
  }
  return defaultCollapsedPosition();
}

function saveCollapsedPosition(position: WispOverlayPosition): void {
  try {
    fs.mkdirSync(path.dirname(positionFilePath()), { recursive: true });
    fs.writeFileSync(positionFilePath(), JSON.stringify(position, null, 2), 'utf8');
  } catch (error) {
    console.warn('[wisp-overlay] failed to persist overlay position:', error);
  }
}

function collapsedAnchorFromCurrentBounds(): WispOverlayPosition {
  if (!wispOverlayWindow || wispOverlayWindow.isDestroyed()) return readStoredPosition();
  const bounds = wispOverlayWindow.getBounds();
  if (!wispOverlayExpanded) {
    return { x: bounds.x, y: bounds.y };
  }
  return {
    x: bounds.x + (EXPANDED_BOUNDS.width - COLLAPSED_BOUNDS.width),
    y: bounds.y + (EXPANDED_BOUNDS.height - COLLAPSED_BOUNDS.height),
  };
}

function expandedPositionForAnchor(anchor: WispOverlayPosition): WispOverlayPosition {
  return clampPosition({
    x: anchor.x - (EXPANDED_BOUNDS.width - COLLAPSED_BOUNDS.width),
    y: anchor.y - (EXPANDED_BOUNDS.height - COLLAPSED_BOUNDS.height),
  }, EXPANDED_BOUNDS.width, EXPANDED_BOUNDS.height);
}

function applyOverlayBounds(expanded: boolean): void {
  if (!wispOverlayWindow || wispOverlayWindow.isDestroyed()) return;
  const collapsedAnchor = clampPosition(
    collapsedAnchorFromCurrentBounds(),
    COLLAPSED_BOUNDS.width,
    COLLAPSED_BOUNDS.height,
  );
  saveCollapsedPosition(collapsedAnchor);

  wispOverlayExpanded = expanded;
  if (expanded) {
    wispOverlayWindow.setBounds({
      ...EXPANDED_BOUNDS,
      ...expandedPositionForAnchor(collapsedAnchor),
    });
  } else {
    wispOverlayWindow.setBounds({
      ...COLLAPSED_BOUNDS,
      ...collapsedAnchor,
    });
  }
}

function setWispOverlayInteractive(interactive: boolean): void {
  if (!wispOverlayWindow || wispOverlayWindow.isDestroyed()) return;
  if (wispOverlayInteractive === interactive) return;
  wispOverlayInteractive = interactive;
  wispOverlayWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

export function getWispOverlayWindow(): BrowserWindow | null {
  return wispOverlayWindow;
}

export function isWispOverlayVisible(): boolean {
  return wispOverlayWindow !== null && !wispOverlayWindow.isDestroyed() && wispOverlayWindow.isVisible();
}

export function hideWispOverlay(): void {
  if (wispOverlayWindow && !wispOverlayWindow.isDestroyed()) {
    wispOverlayWindow.hide();
  }
}

export function showWispOverlay(): void {
  const initialPosition = clampPosition(readStoredPosition(), COLLAPSED_BOUNDS.width, COLLAPSED_BOUNDS.height);

  if (wispOverlayWindow && !wispOverlayWindow.isDestroyed()) {
    wispOverlayExpanded = false;
    wispOverlayWindow.setBounds({ ...COLLAPSED_BOUNDS, ...initialPosition });
    wispOverlayWindow.showInactive();
    return;
  }

  wispOverlayWindow = new BrowserWindow({
    ...COLLAPSED_BOUNDS,
    ...initialPosition,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'Solith Wisp',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(moduleDirectory, 'preload.cjs'),
    },
  });

  wispOverlayExpanded = false;
  wispOverlayInteractive = false;
  wispOverlayWindow.setMenuBarVisibility(false);
  wispOverlayWindow.setBackgroundColor('#00000000');
  wispOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  wispOverlayWindow.loadURL(wispOverlayUrl());
  // Packaged builds must only trust the packaged file:// route — the dev-server
  // origin is attacker-bindable on any machine and must never be trusted once shipped.
  const isDev = process.argv.includes('--dev') || process.env.SOLITH_DEV === '1';
  const wispOverlayAllowedUrlPrefixes = isDev
    ? ['http://localhost:3000']
    : [`file://${path.join(moduleDirectory, 'dist/index.html')}`];
  registerTrustedSolithWindow(wispOverlayWindow.webContents, 'wisp-overlay', wispOverlayAllowedUrlPrefixes);
  applyWindowNavigationPolicy(wispOverlayWindow.webContents, wispOverlayAllowedUrlPrefixes);

  wispOverlayWindow.once('ready-to-show', () => {
    wispOverlayWindow?.showInactive();
  });

  wispOverlayWindow.on('move', () => {
    if (!wispOverlayWindow || wispOverlayWindow.isDestroyed()) return;
    saveCollapsedPosition(clampPosition(
      collapsedAnchorFromCurrentBounds(),
      COLLAPSED_BOUNDS.width,
      COLLAPSED_BOUNDS.height,
    ));
  });

  wispOverlayWindow.on('closed', () => {
    wispOverlayWindow = null;
    wispOverlayExpanded = false;
    wispOverlayInteractive = false;
  });
}

export function toggleWispOverlay(): boolean {
  if (isWispOverlayVisible()) {
    hideWispOverlay();
    return false;
  }
  showWispOverlay();
  return true;
}

export function destroyWispOverlay(): void {
  if (wispOverlayWindow && !wispOverlayWindow.isDestroyed()) {
    wispOverlayWindow.destroy();
  }
  wispOverlayWindow = null;
  wispOverlayExpanded = false;
  wispOverlayInteractive = false;
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
 * Phase 7 B2 hardening — mirrors trainer-hotkeys.ts's guardedHandle. All 5
 * wisp-overlay-* channels allow both 'main' (App.tsx mounts
 * SolithWispCompanion at the top level) and 'wisp-overlay' (the overlay's
 * own WispOverlayPage self-controls position/expanded/interactive state).
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

export function registerWispOverlayIpc(): void {
  guardedHandle('wisp-overlay-toggle', ['main', 'wisp-overlay'], async () => {
    const visible = toggleWispOverlay();
    return { success: true, visible };
  });

  guardedHandle('wisp-overlay-hide', ['main', 'wisp-overlay'], async () => {
    hideWispOverlay();
    return { success: true };
  });

  guardedHandle('wisp-overlay-set-expanded', ['main', 'wisp-overlay'], async (_event, payload: { expanded?: boolean }) => {
    applyOverlayBounds(Boolean(payload?.expanded));
    return { success: true, expanded: wispOverlayExpanded };
  });

  guardedHandle('wisp-overlay-move-by', ['main', 'wisp-overlay'], async (_event, payload: { deltaX?: number; deltaY?: number }) => {
    if (!wispOverlayWindow || wispOverlayWindow.isDestroyed()) {
      return { success: false, error: 'overlay_unavailable' };
    }
    const deltaX = Number(payload?.deltaX ?? 0);
    const deltaY = Number(payload?.deltaY ?? 0);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return { success: false, error: 'invalid_delta' };
    }
    const anchor = collapsedAnchorFromCurrentBounds();
    const nextAnchor = clampPosition(
      { x: anchor.x + deltaX, y: anchor.y + deltaY },
      COLLAPSED_BOUNDS.width,
      COLLAPSED_BOUNDS.height,
    );
    saveCollapsedPosition(nextAnchor);
    if (wispOverlayExpanded) {
      wispOverlayWindow.setBounds({
        ...EXPANDED_BOUNDS,
        ...expandedPositionForAnchor(nextAnchor),
      });
    } else {
      wispOverlayWindow.setBounds({
        ...COLLAPSED_BOUNDS,
        ...nextAnchor,
      });
    }
    return { success: true };
  });

  guardedHandle('wisp-overlay-set-interactive', ['main', 'wisp-overlay'], async (_event, payload: { interactive?: boolean }) => {
    setWispOverlayInteractive(Boolean(payload?.interactive));
    return { success: true, interactive: wispOverlayInteractive };
  });
}
