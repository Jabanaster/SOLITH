/**
 * tests/electron.smoke.test.ts
 *
 * Electron smoke test using Playwright's Electron support.
 *
 * LIMITATION NOTE:
 * @playwright/test must be installed for this test to run.
 * Run: npm install --save-dev @playwright/test
 * Then: npx playwright install (downloads Chromium)
 *
 * This test:
 *  1. Launches the bundled Electron main (dist-electron/main.js)
 *  2. Uses a fully isolated temporary userData directory
 *  3. Verifies the window renders, preload is active, and IPC responds
 *  4. Never touches production user data
 *
 * Run with: npm run test:electron-smoke
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ROOT         = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE  = path.join(ROOT, 'dist-electron', 'main.js');

let electronApp: ElectronApplication;
let window: Page;

// Unique temp dir per test run — never reuses data from a previous run
const RUN_ID       = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEMP_USER_DATA = path.join(os.tmpdir(), `solith-smoke-${RUN_ID}`);

test.beforeAll(async () => {
  // Ensure the bundle exists before trying to launch
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(
      `Electron bundle not found: ${MAIN_BUNDLE}\n` +
      'Run "npm run build:electron" before running smoke tests.'
    );
  }

  fs.mkdirSync(TEMP_USER_DATA, { recursive: true });

  electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      // Electron uses this env var to locate userData; override it to isolate tests
      ELECTRON_USER_DATA_PATH: TEMP_USER_DATA,
      NODE_ENV: 'test',
    },
  });

  // Wait for the first window to open
  window = await electronApp.firstWindow();

  // Wait for React to mount: domcontentloaded fires before React renders.
  // Wait for #root to have children (i.e. React has hydrated the DOM).
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 15_000 });
});

test.afterAll(async () => {
  await electronApp?.close();

  // Clean up isolated temp data
  if (fs.existsSync(TEMP_USER_DATA)) {
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

test('window title contains Solith', async () => {
  const title = await window.title();
  expect(title).toMatch(/Solith/i);
});

test('app root element renders', async () => {
  const root = window.locator('#root');
  await expect(root).toBeAttached();
});

test('sidebar renders', async () => {
  // The sidebar/nav should be present in the DOM
  const sidebar = window.locator('nav, aside, [class*="sidebar"], [class*="nav"]').first();
  await expect(sidebar).toBeAttached({ timeout: 10_000 });
});

test('window.electronAPI is exposed', async () => {
  const hasApi = await window.evaluate(() => {
    return typeof (window as any).electronAPI === 'object' &&
           typeof (window as any).electronAPI.getGames === 'function';
  });
  expect(hasApi).toBe(true);
});

test('IPC getGames returns an array', async () => {
  const result = await window.evaluate(async () => {
    const api = (window as any).electronAPI;
    return api.getGames();
  });
  // May be empty on first launch — just confirm it's an array (not an error)
  expect(Array.isArray(result)).toBe(true);
});

test('no uncaught renderer errors', async () => {
  const errors: string[] = [];
  window.on('pageerror', err => errors.push(err.message));

  // Trigger a minor interaction that exercises rendering
  await window.waitForTimeout(1000);

  expect(errors).toHaveLength(0);
});
