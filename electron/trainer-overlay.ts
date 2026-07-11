import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

let overlayWindow: BrowserWindow | null = null;

function overlayUrl(): string {
  const isDev = process.argv.includes('--dev') || process.env.RESOURCEFORGE_DEV === '1';
  if (isDev) {
    return 'http://localhost:3000/#trainer-overlay';
  }
  return `file://${path.join(moduleDirectory, 'dist/index.html')}#trainer-overlay`;
}

export function getTrainerOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

export function isTrainerOverlayVisible(): boolean {
  return overlayWindow !== null && !overlayWindow.isDestroyed() && overlayWindow.isVisible();
}

export function hideTrainerOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

export function showTrainerOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 380,
    height: 560,
    x: width - 400,
    y: 48,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'Solith Trainer Overlay',
    backgroundColor: '#0a0e16',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(moduleDirectory, 'preload.cjs'),
    },
  });

  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.loadURL(overlayUrl());

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

export function toggleTrainerOverlay(): boolean {
  if (isTrainerOverlayVisible()) {
    hideTrainerOverlay();
    return false;
  }
  showTrainerOverlay();
  return true;
}

export function destroyTrainerOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;
}
