import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getOverlayLayoutPreset } from '../src/core/cheat-system/overlay-layout-presets.js';

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

export function showTrainerOverlay(gameId?: string | null): void {
  const preset = getOverlayLayoutPreset(gameId);
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setBounds({
      width: preset.width,
      height: preset.height,
      x: screenWidth - preset.width - preset.marginRight,
      y: preset.marginTop,
    });
    overlayWindow.show();
    overlayWindow.focus();
    return;
  }

  overlayWindow = new BrowserWindow({
    width: preset.width,
    height: preset.height,
    x: screenWidth - preset.width - preset.marginRight,
    y: preset.marginTop,
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

export function toggleTrainerOverlay(gameId?: string | null): boolean {
  if (isTrainerOverlayVisible()) {
    hideTrainerOverlay();
    return false;
  }
  showTrainerOverlay(gameId);
  return true;
}

export function destroyTrainerOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;
}
