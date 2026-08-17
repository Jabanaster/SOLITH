/**
 * tests/game-library-launcher-identity.e2e.test.ts — Phase 2C rendered verification (Step 16)
 *
 * Seeds a manually-added Ubisoft Connect installation through the real IPC bridge, then
 * verifies at the three required breakpoints that:
 *   - the Game Library shows the correct Ubisoft Connect badge on the canonical card
 *   - the Settings > Launchers & Accounts table lists all 8 roadmap launcher identities
 *   - no horizontal overflow / badge clipping occurs
 *   - no password input exists anywhere in the Launchers & Accounts table
 */

import { test, expect, _electron as electron, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MAIN_BUNDLE = path.join('dist-electron', 'main.js');

async function launchFresh(label: string) {
  if (!fs.existsSync(MAIN_BUNDLE)) return null;
  const runId = `gl-launcher-id-${label}-${Date.now()}`;
  const userData = path.join(os.tmpdir(), runId, 'userData');
  const appData = path.join(os.tmpdir(), runId, 'appdata');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userData,
      APPDATA: appData,
      USERPROFILE: appData,
      NODE_ENV: 'test',
    },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 15_000 });
  return { app, win, runId };
}

async function cleanup(ctx: { app: any; runId: string } | null) {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  fs.rmSync(path.join(os.tmpdir(), ctx.runId), { recursive: true, force: true });
}

async function seedUbisoftGame(win: Page) {
  await win.evaluate(async () => {
    await (window as any).electronAPI.addGame({
      name: 'Rendered Ubisoft Fixture Game',
      path: 'D:/Ubisoft/RenderedFixture',
      launcher: 'ubisoft',
    });
  });
}

async function assertNoHorizontalOverflow(win: Page) {
  const overflow = await win.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

for (const [label, size] of Object.entries({
  narrow: { width: 1024, height: 768 },
  standard: { width: 1440, height: 900 },
  maximized: { width: 1920, height: 1080 },
})) {
  test(`launcher identity renders correctly at ${label} (${size.width}x${size.height})`, async () => {
    if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
    const ctx = await launchFresh(label);
    try {
      const win = ctx!.win;
      await win.setViewportSize(size);
      await win.waitForSelector('.game-library', { timeout: 15_000 });

      await seedUbisoftGame(win);
      await win.click('button:has-text("Rescan launchers")').catch(() => {});
      await win.reload();
      await win.waitForSelector('.game-library', { timeout: 15_000 });
      await win.waitForSelector('.game-library-tabs', { timeout: 15_000 });

      await assertNoHorizontalOverflow(win);

      const cardText = await win.locator('.game-card, [class*="game-card"]').allTextContents();
      const anyCardHasUbisoft = cardText.some((text) => text.includes('Ubisoft Connect'));
      expect(anyCardHasUbisoft).toBe(true);

      // Navigate to Settings > Launchers & Accounts
      await win.click('.sidebar-settings-btn');
      await win.waitForSelector('.settings-page', { timeout: 15_000 });
      await win.click('button:has-text("Launchers & Accounts")');
      await win.waitForSelector('.settings-table', { timeout: 15_000 });

      await assertNoHorizontalOverflow(win);

      const tableText = await win.locator('.settings-table').innerText();
      for (const requiredLauncher of ['Steam', 'GOG', 'Epic Games Store', 'Xbox / Microsoft Store', 'Ubisoft Connect', 'EA app', 'Battle.net', 'Standalone']) {
        expect(tableText.includes(requiredLauncher)).toBe(true);
      }
      expect(tableText.includes('Ubisoft Connect')).toBe(true);

      const passwordInputCount = await win.locator('input[type="password"]').count();
      expect(passwordInputCount).toBe(0);
    } finally {
      await cleanup(ctx);
    }
  });
}
