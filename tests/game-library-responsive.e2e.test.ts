/**
 * tests/game-library-responsive.e2e.test.ts — Phase 2B responsive verification (Step 26)
 *
 * Verifies the rebuilt Game Library renders without horizontal overflow and keeps
 * filters/search/tabs reachable at the three required breakpoints.
 */

import { test, expect, _electron as electron, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MAIN_BUNDLE = path.join('dist-electron', 'main.js');

async function launchFresh(label: string) {
  if (!fs.existsSync(MAIN_BUNDLE)) return null;
  const runId = `gl-responsive-${label}-${Date.now()}`;
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

async function assertNoHorizontalOverflow(win: Page) {
  const overflow = await win.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

for (const [label, size] of Object.entries({
  narrow: { width: 1024, height: 768 },
  standard: { width: 1440, height: 900 },
  maximized: { width: 1920, height: 1080 },
})) {
  test(`game library renders without overflow at ${label} (${size.width}x${size.height})`, async () => {
    if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
    const ctx = await launchFresh(label);
    try {
      const win = ctx!.win;
      await win.setViewportSize(size);
      await win.waitForSelector('.game-library', { timeout: 15_000 });
      await win.waitForSelector('.game-library-tabs', { timeout: 15_000 });

      await assertNoHorizontalOverflow(win);

      const tabsVisible = await win.isVisible('.game-library-tabs');
      expect(tabsVisible).toBe(true);

      const searchVisible = await win.isVisible('.game-library-search');
      expect(searchVisible).toBe(true);

      const addButtonVisible = await win.isVisible('#game-library-add-manual');
      expect(addButtonVisible).toBe(true);
    } finally {
      await cleanup(ctx);
    }
  });
}
