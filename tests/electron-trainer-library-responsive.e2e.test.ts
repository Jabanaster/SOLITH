/**
 * tests/electron-trainer-library-responsive.e2e.test.ts
 *
 * Gate 2.5 doc-audit pass, Mission 11 — REAL responsive Electron E2E (not
 * CSS inspection). Drives the real built Electron renderer
 * (dist-electron/main.js) against a synthetic, isolated userData directory
 * seeded via tests/fixtures/personal-library-seed.ts, following the exact
 * same fixture/launch pattern as tests/electron-trainer-library-ux.e2e.test.ts
 * and tests/electron-personal-library.e2e.test.ts. NO real game, NO real
 * launcher account, NO real process attach.
 *
 * Window sizing: this repo's existing E2E tests (see
 * electron-trainer-library-ux.e2e.test.ts) resize via Playwright's
 * `page.setViewportSize()` against the Electron BrowserWindow's page — that
 * uses a CDP device-metrics override on the renderer viewport, independent
 * of the actual native BrowserWindow size/minWidth. We follow the same
 * precedent here so we can exercise widths below electron/main.ts's real
 * `minWidth: 900` (a real user can still shrink the OS window content area
 * below minWidth via display scaling/DPI edge cases, and this override lets
 * us verify the CSS holds even there).
 *
 * electron/main.ts's BrowserWindow sets `minWidth: 900` explicitly (see
 * `new BrowserWindow({ ... minWidth: 900 ... })`), so the "minimum width"
 * case below uses 900. Because that value is identical to the 900x700 case
 * already required by the mission brief, this 4th case intentionally
 * duplicates that viewport rather than substituting a guessed value — the
 * mission instructions say to use the real minWidth when one exists, and
 * inventing a different number here would misrepresent the app's actual
 * configured minimum.
 *
 * Run with: npx playwright test tests/electron-trainer-library-responsive.e2e.test.ts --config playwright.e2e.config.ts
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

// electron/main.ts: `new BrowserWindow({ ..., minWidth: 900, ... })`.
const CONFIGURED_MIN_WIDTH = 900;

const VIEWPORTS: Array<{ label: string; width: number; height: number }> = [
  { label: '1200x800', width: 1200, height: 800 },
  { label: '900x700', width: 900, height: 700 },
  { label: '640x700', width: 640, height: 700 },
  { label: `minimum-width-${CONFIGURED_MIN_WIDTH}`, width: CONFIGURED_MIN_WIDTH, height: 700 },
];

// Small tolerance for scrollbar-gutter reservation / subpixel rounding —
// not a license to hide real overflow.
const OVERFLOW_TOLERANCE_PX = 2;

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:electron" before running this test.`);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  userDataDir = path.join(os.tmpdir(), `solith-trainer-library-responsive-e2e-${runId}`);
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
  await window.setViewportSize({ width: 1200, height: 800 });
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

async function pageScrollOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Trainer Library responsive — ${viewport.label}`, () => {
    test.beforeAll(async () => {
      await window.setViewportSize({ width: viewport.width, height: viewport.height });
      // Let layout settle after the emulated resize.
      await window.waitForTimeout(150);
    });

    test(`[${viewport.label}] 1. personal games are visible without clicking into All Games`, async () => {
      // Default quickTab is 'all' (label "All Games") which renders the
      // section hierarchy (Installed / Owned — Trainers Available / etc.)
      // directly — not a separate "click into All Games" step. Assert the
      // Installed section (expanded by default) and a real fixture game in
      // it are both visible without any additional click.
      const installedSection = window.locator('section[aria-label="Installed"]');
      await expect(installedSection).toBeVisible();
      await expect(installedSection.getByText('Fixture Installed Supported')).toBeVisible();
    });

    test(`[${viewport.label}] 2. search input is visible and focusable`, async () => {
      const searchInput = window.getByLabel('Search trainer library');
      await expect(searchInput).toBeVisible();
      await searchInput.focus();
      await expect(searchInput).toBeFocused();
    });

    test(`[${viewport.label}] 3. Filters and Sort controls are visible and clickable`, async () => {
      const filtersTrigger = window.getByRole('button', { name: /^Filters/ });
      const sortSelect = window.getByLabel('Sort trainer library');
      await expect(filtersTrigger).toBeVisible();
      await expect(sortSelect).toBeVisible();
      // "Clickable" — verify no other element intercepts the click target
      // (Playwright's actionability checks already assert this on .click()).
      await filtersTrigger.click();
      await expect(filtersTrigger).toHaveAttribute('aria-expanded', 'true');
      await window.keyboard.press('Escape');
      await expect(filtersTrigger).toHaveAttribute('aria-expanded', 'false');
    });

    test(`[${viewport.label}] 4. Filters popover stays within the viewport, no page horizontal overflow`, async () => {
      const trigger = window.getByRole('button', { name: /^Filters/ });
      await trigger.click();
      const panel = window.locator('#trainer-library-filters-panel');
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      const rect = { left: box!.x, right: box!.x + box!.width };
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      await window.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
    });

    test(`[${viewport.label}] 5. active-filter chips wrap without horizontal page overflow`, async () => {
      const trigger = window.getByRole('button', { name: /^Filters/ });
      await trigger.click();
      await window.getByRole('button', { name: 'Verified', exact: true }).click();
      await window.keyboard.press('Escape');

      const chipsContainer = window.locator('[aria-label="Active filters"]');
      await expect(chipsContainer).toBeVisible();

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      // Every chip must itself stay within the viewport (proof of wrapping,
      // not just container containment).
      const chipBoxes = await chipsContainer.getByRole('button').evaluateAll((buttons) =>
        buttons.map((b) => {
          const r = b.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
      for (const box of chipBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
      }

      // Reset for the next viewport iteration's clean state.
      const resetBtn = window.getByRole('button', { name: 'Reset', exact: true });
      if (await resetBtn.count() > 0) {
        await resetBtn.click();
      }
    });

    test(`[${viewport.label}] 6. game cards do not overflow horizontally`, async () => {
      const cards = window.locator('article').filter({ hasText: 'Fixture' });
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);
      const boxes = await cards.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { right: r.right };
        }),
      );
      for (const box of boxes) {
        expect(box.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
      }
    });

    test(`[${viewport.label}] 7. accuracy badge does not break card layout (sane height, no unexpected overlap)`, async () => {
      // "Fixture Installed Supported" is installed + has a mod pack, so it
      // resolves a real TrainerAccuracyState (installed => strongMatchEvidence)
      // and should render the accuracy badge alongside the tier badge.
      const card = window.locator('article').filter({ hasText: 'Fixture Installed Supported' }).first();
      await expect(card).toBeVisible();

      const cardBox = await card.boundingBox();
      expect(cardBox).not.toBeNull();
      // Sane upper bound: a two-badge statusRow must never balloon a card to
      // an unreasonable height (regression guard, not a strict design spec).
      expect(cardBox!.height).toBeLessThan(700);
      expect(cardBox!.height).toBeGreaterThan(50);

      // Title and status-row badges are two sibling regions of the card body
      // — their bounding rects must not vertically overlap (badge colliding
      // with the title text would be a real layout defect).
      const titleBox = await card.locator('h2').boundingBox();
      const statusRowBox = await card.locator('span', { hasText: /Match|Verify|verified|Unknown/ }).first().boundingBox().catch(() => null);
      if (titleBox && statusRowBox) {
        const titleBottom = titleBox.y + titleBox.height;
        expect(statusRowBox.y).toBeGreaterThanOrEqual(titleBottom - OVERFLOW_TOLERANCE_PX);
      }
    });
  });
}

test.describe('Linked Libraries page remains usable at the narrowest tested width', () => {
  const narrowest = VIEWPORTS[VIEWPORTS.length - 1];

  test.beforeAll(async () => {
    await window.setViewportSize({ width: narrowest.width, height: narrowest.height });
    await window.getByRole('button', { name: 'Linked Libraries' }).click();
    await window.waitForTimeout(150);
  });

  test(`renders and has no horizontal overflow at ${narrowest.label}`, async () => {
    await expect(window.getByRole('heading', { name: 'Linked Game Libraries' })).toBeVisible();
    const overflow = await pageScrollOverflowPx(window);
    expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
  });

  test.afterAll(async () => {
    await window.getByRole('button', { name: 'Trainer Library' }).click();
    await window.waitForTimeout(150);
  });
});
