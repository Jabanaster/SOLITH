/**
 * tests/electron-trainer-library-ux.e2e.test.ts
 *
 * Gate 2.5 doc-audit pass — owner-directed Trainer Library UX redesign
 * ("MY games and MY trainers first"). Drives the REAL Electron renderer
 * (built dist-electron/main.js) against a fully synthetic, isolated
 * userData directory seeded via tests/fixtures/personal-library-seed.ts,
 * following the exact same fixture/launch pattern as
 * tests/electron-personal-library.e2e.test.ts. NO real game, NO real
 * launcher account, NO real process attach.
 *
 * Run with: npx playwright test tests/electron-trainer-library-ux.e2e.test.ts --config playwright.e2e.config.ts
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { seedPersonalLibraryFixtures } from './fixtures/personal-library-seed.ts';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:electron" before running this test.`);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  userDataDir = path.join(os.tmpdir(), `solith-trainer-library-ux-e2e-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  await seedPersonalLibraryFixtures(userDataDir);

  electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      NODE_ENV: 'test',
    },
  });

  window = await electronApp.firstWindow();
  // Owner's target above-the-fold size for this redesign (900x700-ish).
  await window.setViewportSize({ width: 900, height: 700 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 15_000 });

  await window.getByRole('button', { name: 'Trainer Library' }).click();
  await window.waitForSelector('text=Loading catalog…', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await expect(window.locator('section[aria-label]').first()).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await electronApp?.close();
  if (userDataDir && fs.existsSync(userDataDir)) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

test('the old 7 always-visible filter-chip-rows no longer render by default', async () => {
  // The old design rendered 7 <div class="filterSection"> rows with labels
  // Availability/Status/Mode/Catalog/Launcher/View/Genre directly on the
  // page. They now only exist inside the collapsed Filters popover.
  const visibleFilterLabels = await window.locator('text=/^(Availability|Mode|Catalog|Launcher)$/').count();
  expect(visibleFilterLabels).toBe(0);
});

test('Search, Filters, Sort, and quick-view tabs are visible above the fold with no scrolling at 900x700', async () => {
  const searchInput = window.getByLabel('Search trainer library');
  const filtersTrigger = window.getByRole('button', { name: /^Filters/ });
  const sortSelect = window.getByLabel('Sort trainer library');
  const runningTab = window.getByRole('button', { name: 'Running', exact: true });

  for (const locator of [searchInput, filtersTrigger, sortSelect, runningTab]) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(700);
  }
});

test('Filters popover: closed by default, opens on click with aria-expanded=true, Escape closes it and returns focus to the trigger', async () => {
  const trigger = window.getByRole('button', { name: /^Filters/ });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(window.locator('#trainer-library-filters-panel')).toHaveCount(0);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(window.locator('#trainer-library-filters-panel')).toBeVisible();

  await window.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(window.locator('#trainer-library-filters-panel')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('Filters trigger shows an active-count badge once a filter is applied, and clears when Reset is used', async () => {
  const trigger = window.getByRole('button', { name: /^Filters/ });
  await expect(trigger).toHaveText('Filters ▾');

  await trigger.click();
  await window.getByRole('button', { name: 'Verified', exact: true }).click();
  await expect(trigger).toHaveText('Filters (1) ▾');

  // Close the popover and reopen it via the result-summary Reset action.
  await window.keyboard.press('Escape');
  const resetBtn = window.getByRole('button', { name: 'Reset', exact: true });
  await expect(resetBtn).toBeVisible();
  await resetBtn.click();
  await expect(trigger).toHaveText('Filters ▾');
});

test('Running / Installed / Owned / Favorites / All Games quick tabs are clickable and toggle back to All Games', async () => {
  const installedTab = window.getByRole('button', { name: 'Installed', exact: true });
  const allGamesTab = window.getByRole('button', { name: 'All Games', exact: true });

  await expect(allGamesTab).toHaveAttribute('aria-pressed', 'true');
  await installedTab.click();
  await expect(installedTab).toHaveAttribute('aria-pressed', 'true');
  await expect(allGamesTab).toHaveAttribute('aria-pressed', 'false');

  // Clicking the already-active tab again returns to "All Games".
  await installedTab.click();
  await expect(installedTab).toHaveAttribute('aria-pressed', 'false');
  await expect(allGamesTab).toHaveAttribute('aria-pressed', 'true');
});

test('Result count copy matches the new "Your Games — N · X installed · Y owned" pattern', async () => {
  const summary = window.locator('text=/^Your Games — \\d[\\d,]* · \\d[\\d,]* installed · \\d[\\d,]* owned$/');
  await expect(summary).toBeVisible();
});

test('Sort control exposes Recommended as the default and every required option', async () => {
  const sortSelect = window.getByLabel('Sort trainer library');
  await expect(sortSelect).toHaveValue('recommended');
  const optionValues = await sortSelect.locator('option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  );
  for (const expected of ['recommended', 'a-z', 'z-a', 'recently-added', 'trainer-quality']) {
    expect(optionValues).toContain(expected);
  }
});

test('the Community Hub Sync and Scan for Installed Games panels are collapsed by default', async () => {
  const hubSummary = window.locator('summary', { hasText: 'Community Hub Sync' });
  const scanSummary = window.locator('summary', { hasText: 'Scan for Installed Games' });
  await expect(hubSummary).toBeVisible();
  await expect(scanSummary).toBeVisible();
  // <details> keeps its collapsed content in the DOM (just not rendered) —
  // assert on visibility, not presence.
  await expect(window.locator('text=Solith Definition Hub')).not.toBeVisible();
  await expect(window.locator('text=Installed Game Discovery')).not.toBeVisible();

  await hubSummary.click();
  await expect(window.locator('text=Solith Definition Hub')).toBeVisible();
  await hubSummary.click();
  await expect(window.locator('text=Solith Definition Hub')).not.toBeVisible();
});
