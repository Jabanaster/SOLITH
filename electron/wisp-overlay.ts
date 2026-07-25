import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

let wispOverlayWindow: BrowserWindow | null = null;

function wispOverlayUrl(): string {
  const isDev = process.argv.includes('--dev') || process.env.SOLITH_DEV === '1';
  if (isDev) {
    return 'http://localhost:3000/#wisp-overlay';
  }
  return `file://${path.join(moduleDirectory, 'dist/index.html')}#wisp-overlay`;
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
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 470;
  const height = 220;
  const x = workArea.x + workArea.width - width - 24;
  const y = workArea.y + workArea.height - height - 24;

  if (wispOverlayWindow && !wispOverlayWindow.isDestroyed()) {
    wispOverlayWindow.setBounds({ width, height, x, y });
    wispOverlayWindow.show();
    wispOverlayWindow.focus();
    return;
  }

  wispOverlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'Solith Wisp',
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(moduleDirectory, 'preload.cjs'),
    },
  });

  wispOverlayWindow.setMenuBarVisibility(false);
  wispOverlayWindow.loadURL(wispOverlayUrl());

  wispOverlayWindow.once('ready-to-show', () => {
    wispOverlayWindow?.show();
  });

  wispOverlayWindow.on('closed', () => {
    wispOverlayWindow = null;
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
}

export function registerWispOverlayIpc(): void {
  ipcMain.handle('wisp-overlay-toggle', async () => {
    const visible = toggleWispOverlay();
    return { success: true, visible };
  });

  ipcMain.handle('wisp-overlay-hide', async () => {
    hideWispOverlay();
    return { success: true };
  });
}
