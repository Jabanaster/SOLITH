import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');
const TEMP_USER_DATA = path.join(
  os.tmpdir(),
  `solith-walkthrough-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}`);
  }
  fs.mkdirSync(TEMP_USER_DATA, { recursive: true });
  electronApp = await electron.launch({
    args: [MAIN_BUNDLE, '--disable-blink-features=AutomationControlled'],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: TEMP_USER_DATA,
      NODE_ENV: 'test',
    },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 15_000 });
  await window.getByRole('heading', { name: 'Game Library' }).waitFor();
});

test.afterAll(async () => {
  await electronApp?.close();
  fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
});

test('walkthrough ownership follows real navigation and preserves same-page state', async () => {
  const panel = window.locator('.page-walkthrough__panel');
  const gameHelp = window.getByRole('button', {
    name: 'How this page works: How Game Library works',
  });

  await gameHelp.click();
  await expect(panel).toHaveAttribute('aria-label', 'How Game Library works');

  await window.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(panel).toHaveAttribute('aria-label', 'How Game Library works');
  await window.getByRole('button', { name: 'Expand sidebar' }).click();

  await window.getByRole('button', { name: 'Trainer Library', exact: true }).click();
  await expect(panel).toHaveCount(0);

  const trainerHelp = window.getByRole('button', {
    name: 'How this page works: How Trainer Library works',
  });
  await trainerHelp.click();
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute('aria-label', 'How Trainer Library works');

  await window.getByRole('button', { name: 'Game Library', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(gameHelp).toHaveAttribute('aria-expanded', 'false');

  await gameHelp.click();
  await window.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(gameHelp).toBeFocused();

  await gameHelp.click();
  await window.getByRole('button', { name: 'Close page walkthrough' }).click();
  await expect(panel).toHaveCount(0);
  await expect(gameHelp).toBeFocused();
});

test('Activity Journal exposes accurate page-specific help', async () => {
  await window.getByRole('button', { name: 'Journal', exact: true }).click();
  const journalHelp = window.getByRole('button', {
    name: 'How this page works: How Activity Journal works',
  });
  await journalHelp.click();

  const panel = window.locator('.page-walkthrough__panel');
  await expect(panel).toHaveAttribute('aria-label', 'How Activity Journal works');
  await expect(panel).toContainText('local SQLite database');
  await expect(panel).toContainText('does not upload');
  await expect(panel).toContainText('no clear, delete, or export control');
});
test('Registry Explorer walkthrough stays above Wisp controls', async () => {
  await window.getByRole('button', { name: 'Registry Explorer', exact: true }).click();
  await window.getByRole('button', {
    name: 'How this page works: How Registry Explorer works',
  }).click();

  const panel = window.locator('.page-walkthrough__panel');
  const wisp = window.locator('.solith-wisp');
  await expect(panel).toHaveAttribute('aria-label', 'How Registry Explorer works');
  await expect(wisp).toBeVisible();

  const stackingLevels = await window.evaluate(() => ({
    panel: Number.parseInt(
      window.getComputedStyle(document.querySelector<HTMLElement>('.page-walkthrough__panel')!).zIndex,
      10,
    ),
    wisp: Number.parseInt(
      window.getComputedStyle(document.querySelector<HTMLElement>('.solith-wisp')!).zIndex,
      10,
    ),
  }));

  expect(stackingLevels.panel).toBeGreaterThan(stackingLevels.wisp);
  await expect(window.getByRole('button', { name: 'Close page walkthrough' })).toBeVisible();
});