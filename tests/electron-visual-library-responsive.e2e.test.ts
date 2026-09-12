/**
 * tests/electron-visual-library-responsive.e2e.test.ts
 *
 * Real responsive Electron E2E (not CSS inspection) for the Visual Library
 * 2.0 surfaces added this session: AppSidebar, HomePage (+ HomeShelf),
 * MyGamesPage (+ ViewModeToggle), and GameDetailPage (+ DetailBanner /
 * GameInfoSection / TrainerSection / TrainerSourcesSection). Follows the
 * exact harness pattern of tests/electron-trainer-library-responsive.e2e.test.ts
 * (same Electron launch/close lifecycle, same fixture seed, same
 * `page.setViewportSize()` real-measurement approach via boundingBox()/
 * scrollWidth — never CSS-inspection-only).
 *
 * Drives the real built Electron renderer (dist-electron/main.js) against a
 * synthetic, isolated userData directory seeded via
 * tests/fixtures/personal-library-seed.ts. NO real game, NO real launcher
 * account, NO real process attach, NO live-game interaction.
 *
 * Run with: npx playwright test tests/electron-visual-library-responsive.e2e.test.ts --config playwright.e2e.config.ts
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

// electron/main.ts: `new BrowserWindow({ ..., minWidth: 900, ... })` — same
// constant tests/electron-trainer-library-responsive.e2e.test.ts documents.
const CONFIGURED_MIN_WIDTH = 900;

const VIEWPORTS: Array<{ label: string; width: number; height: number }> = [
  { label: '1200x800', width: 1200, height: 800 },
  { label: '900x700', width: 900, height: 700 },
  { label: '640x700', width: 640, height: 700 },
  { label: `minimum-width-${CONFIGURED_MIN_WIDTH}`, width: CONFIGURED_MIN_WIDTH, height: 700 },
];

// Small tolerance for scrollbar-gutter reservation / subpixel rounding —
// not a license to hide real overflow. Matches the sibling suite's constant.
const OVERFLOW_TOLERANCE_PX = 2;

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:electron" before running this test.`);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  userDataDir = path.join(os.tmpdir(), `solith-visual-library-responsive-e2e-${runId}`);
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

  // Land on Home via the new AppSidebar's static nav (real View id 'home' —
  // src/app/nav-views.ts). AppSidebar itself only ever renders for one of
  // the APP_SIDEBAR_VIEWS at a time (App.tsx's isAppSidebarView switch), so
  // it is already visible from the app's default 'library' view? No — the
  // default view is 'library', which is NOT in APP_SIDEBAR_VIEWS, so the
  // legacy nav renders first. Reach the new sidebar via the legacy nav's
  // real "Trainer Library" entry (an APP_SIDEBAR_VIEWS member), matching the
  // sibling suite's own first navigation step.
  await window.getByRole('button', { name: 'Trainer Library' }).click();
  await window.waitForSelector('text=Loading catalog…', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await expect(window.locator('[data-testid="app-sidebar"]')).toBeVisible({ timeout: 30_000 });
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

async function goHome(): Promise<void> {
  await window.locator('[data-testid="app-sidebar-nav-home"]').click();
  await expect(window.locator('[data-testid="home-page"]')).toBeVisible();
}

async function goMyGames(): Promise<void> {
  await window.locator('[data-testid="app-sidebar-nav-my-games"]').click();
  await expect(window.locator('[data-testid="my-games-page"]')).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(`Visual Library responsive — ${viewport.label}`, () => {
    test.beforeAll(async () => {
      await window.setViewportSize({ width: viewport.width, height: viewport.height });
      await window.waitForTimeout(150);
    });

    test(`[${viewport.label}] 1. AppSidebar is visible and does not cause page horizontal overflow`, async () => {
      await goHome();
      const sidebar = window.locator('[data-testid="app-sidebar"]');
      await expect(sidebar).toBeVisible();

      const box = await sidebar.boundingBox();
      expect(box).not.toBeNull();
      // Sidebar must stay within the viewport — never push content off-screen
      // or force the page itself to scroll horizontally.
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    });

    test(`[${viewport.label}] 2. AppSidebar nav items stay within the viewport and remain clickable`, async () => {
      const navHome = window.locator('[data-testid="app-sidebar-nav-home"]');
      await expect(navHome).toBeVisible();
      const box = await navHome.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);

      // Real click — Playwright's own actionability checks assert nothing
      // else intercepts the click target.
      await window.locator('[data-testid="app-sidebar-nav-my-games"]').click();
      await expect(window.locator('[data-testid="my-games-page"]')).toBeVisible();
      // Return to Home for the remaining tests at this viewport.
      await goHome();
    });

    test(`[${viewport.label}] 3. HomePage hero does not overflow the viewport`, async () => {
      const hero = window.locator('[data-testid="home-hero"], [data-testid="home-hero-empty"]');
      await expect(hero.first()).toBeVisible();

      const box = await hero.first().boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    });

    test(`[${viewport.label}] 4. HomePage shelves scroll horizontally within their own track, never the page`, async () => {
      const shelves = window.locator('[data-testid="home-shelf"]');
      const shelfCount = await shelves.count();
      expect(shelfCount).toBeGreaterThan(0);

      // Every shelf's own bounding box must stay within the viewport — the
      // shelf's internal track (overflow-x: auto) absorbs any excess width
      // from its fixed-width cards, not the page.
      const shelfBoxes = await shelves.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
      for (const box of shelfBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
      }

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    });

    test(`[${viewport.label}] 5. HomePage shows no giant empty gap when shelves are sparse`, async () => {
      // Regression guard, not a strict design spec: measure every real
      // shelf's OWN rendered height directly, then assert the shared
      // container is no taller than the sum of those real heights plus the
      // container's own CSS gap (HomePage.module.css's `.shelves { gap:
      // 1.75rem }`) — a real "large empty gap" bug (a collapsed/empty shelf
      // still reserving full layout space) would blow this budget. Deriving
      // the bound from the actual measured per-shelf heights (rather than a
      // guessed constant) keeps this assertion honest about what "no giant
      // gap" means for whatever real fixture data is rendered.
      const shelfHeights = await window.locator('[data-testid="home-shelf"]').evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().height),
      );
      if (shelfHeights.length === 0) return;
      const shelvesContainer = window.locator('[data-testid="home-shelf"]').first().locator('..');
      const containerBox = await shelvesContainer.boundingBox();
      expect(containerBox).not.toBeNull();
      const SHELVES_GAP_PX = 28; // HomePage.module.css: `.shelves { gap: 1.75rem }`
      const ROUNDING_FUDGE_PX = 20;
      const sumOfShelfHeights = shelfHeights.reduce((total, height) => total + height, 0);
      const expectedMaxHeight = sumOfShelfHeights + SHELVES_GAP_PX * (shelfHeights.length - 1) + ROUNDING_FUDGE_PX;
      expect(containerBox!.height).toBeLessThanOrEqual(expectedMaxHeight);
    });

    test(`[${viewport.label}] 6. MyGamesPage grid/list toggle renders without card distortion`, async () => {
      await goMyGames();

      const toggle = window.locator('[role="radiogroup"][aria-label="Library view mode"]');
      await expect(toggle).toBeVisible();

      const gridRadio = toggle.getByRole('radio', { name: 'Grid' });
      const listRadio = toggle.getByRole('radio', { name: 'List' });

      // Grid mode: cards must stay within the viewport, non-degenerate size.
      await gridRadio.click();
      await expect(gridRadio).toHaveAttribute('aria-checked', 'true');
      // Scoped to this page's own cards — AppSidebar's always-mounted
      // quick-access shelf renders GameCard too (same data-testid).
      const gridCards = window.locator('[data-testid="my-games-page"] [data-testid="game-card"]');
      const gridCount = await gridCards.count();
      expect(gridCount).toBeGreaterThan(0);
      const gridBoxes = await gridCards.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width, height: r.height };
        }),
      );
      for (const box of gridBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
        expect(box.width).toBeGreaterThan(20);
        expect(box.height).toBeGreaterThan(20);
      }
      const gridOverflow = await pageScrollOverflowPx(window);
      expect(gridOverflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      // List mode: same containment checks, different layout.
      await listRadio.click();
      await expect(listRadio).toHaveAttribute('aria-checked', 'true');
      const listCards = window.locator('[data-testid="my-games-page"] [data-testid="game-card"]');
      const listCount = await listCards.count();
      expect(listCount).toBeGreaterThan(0);
      const listBoxes = await listCards.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
      for (const box of listBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
      }
      const listOverflow = await pageScrollOverflowPx(window);
      expect(listOverflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      // Reset to grid for a predictable starting state for later viewports.
      await gridRadio.click();
    });

    test(`[${viewport.label}] 7. GameDetailPage banner artwork and action buttons do not clip or overflow`, async () => {
      // Scoped to MyGamesPage's own grid/list — AppSidebar's always-mounted
      // Favorites/My-Games quick-access shelf renders GameCard too (same
      // data-testid), so an unscoped `[data-testid="game-card"]` locator is
      // ambiguous and can resolve to a sidebar card instead of the page's.
      const card = window.locator('[data-testid="my-games-page"] [data-testid="game-card"]').first();
      await expect(card).toBeVisible();
      await card.click();
      await expect(window.locator('[data-testid="game-detail-page"]')).toBeVisible();

      const banner = window.locator('[data-testid="game-detail-banner"]');
      await expect(banner).toBeVisible();
      const bannerBox = await banner.boundingBox();
      expect(bannerBox).not.toBeNull();
      expect(bannerBox!.x + bannerBox!.width).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);

      // Same class of bug already found and fixed for TrainerLibraryPage's
      // header buttons in the sibling suite's prior pass — check every
      // action button in GameDetailPage's action row individually.
      const actionButtons = window.locator(
        '[data-testid="game-detail-open-folder"], [data-testid="game-detail-open-trainer"]',
      );
      const actionCount = await actionButtons.count();
      expect(actionCount).toBeGreaterThan(0);
      const actionBoxes = await actionButtons.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width, height: r.height };
        }),
      );
      for (const box of actionBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
        // A clipped button collapses toward zero width/height — assert a
        // sane minimum so a real clip regresses this test, not just a
        // theoretical bound.
        expect(box.width).toBeGreaterThan(10);
        expect(box.height).toBeGreaterThan(10);
      }

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    });

    test(`[${viewport.label}] 8. GameDetailPage sections stack without horizontal overflow`, async () => {
      const sections = window.locator(
        '[data-testid="game-detail-trainer-section"], [data-testid="game-detail-info-section"], [data-testid="game-detail-sources-section"]',
      );
      const sectionCount = await sections.count();
      expect(sectionCount).toBeGreaterThan(0);
      const sectionBoxes = await sections.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
      for (const box of sectionBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
      }

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      // Back button returns cleanly (real navigation, not a dead end).
      await window.locator('[data-testid="game-detail-back"]').click();
      await expect(window.locator('[data-testid="my-games-page"], [data-testid="home-page"]').first()).toBeVisible();
    });
  });
}

test.describe('Keyboard navigation reaches sidebar, Home cards, and GameDetail actions', () => {
  test.beforeAll(async () => {
    await window.setViewportSize({ width: 1200, height: 800 });
    await goHome();
    await window.waitForTimeout(150);
  });

  test('Tab order reaches an AppSidebar nav item and activates it via Enter', async () => {
    // Focus a known-stable anchor (the Home nav button itself) rather than
    // relying on a brittle absolute tab count from document start — this
    // still proves the element is a real, focusable, keyboard-activatable
    // control wired into the page's tab order, matching this suite's
    // "no traps, real keyboard reachability" requirement without asserting
    // an exact, fragile tab-index number.
    const homeNav = window.locator('[data-testid="app-sidebar-nav-home"]');
    await homeNav.focus();
    await expect(homeNav).toBeFocused();

    await window.keyboard.press('Tab');
    const myGamesNav = window.locator('[data-testid="app-sidebar-nav-my-games"]');
    await expect(myGamesNav).toBeFocused();
    await window.keyboard.press('Enter');
    await expect(window.locator('[data-testid="my-games-page"]')).toBeVisible();
    await goHome();
  });

  test('Home page game cards are keyboard-focusable and activate with Enter', async () => {
    const firstCard = window.locator('[data-testid="home-shelf"]').first().locator('[data-testid="game-card"]').first();
    const cardCount = await window.locator('[data-testid="home-shelf"] [data-testid="game-card"]').count();
    test.skip(cardCount === 0, 'No shelf cards rendered for the seeded fixture data at this point.');

    await firstCard.focus();
    await expect(firstCard).toBeFocused();
    await window.keyboard.press('Enter');
    await expect(window.locator('[data-testid="game-detail-page"]')).toBeVisible();
  });

  test('GameDetailPage back button and action buttons are keyboard-reachable, no focus trap', async () => {
    const backButton = window.locator('[data-testid="game-detail-back"]');
    await expect(backButton).toBeVisible();
    await backButton.focus();
    await expect(backButton).toBeFocused();

    // Tab forward through the page — focus must keep moving to distinct
    // elements (not stuck on the same node), proving no focus trap exists
    // between the back button and the banner's action buttons.
    const focusedTestIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      await window.keyboard.press('Tab');
      const testId = await window.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
      if (testId) focusedTestIds.push(testId);
    }
    const uniqueFocusTargets = new Set(focusedTestIds);
    expect(uniqueFocusTargets.size).toBeGreaterThan(1);

    await window.locator('[data-testid="game-detail-back"]').click();
    await expect(window.locator('[data-testid="my-games-page"], [data-testid="home-page"]').first()).toBeVisible();
    await goHome();
  });
});

/**
 * Mission 8 — sidebar auto-collapse at narrow widths.
 *
 * Real-measurement verification (boundingBox()/scrollWidth, never CSS
 * inspection) that the previously-confirmed gap — AppSidebar not
 * auto-collapsing, squeezing `.main-content` to ~325px at a 640px viewport —
 * is actually fixed: `.sidebar` (App.tsx/index.css) shrinks from its full
 * 320px to the existing `.sidebar--collapsed` 72px rail at/below
 * NARROW_SIDEBAR_BREAKPOINT_PX (App.tsx: 900, matching electron/main.ts's
 * real `minWidth: 900` and the app's existing 900px "narrow window"
 * convention — see index.css's `.settings-categories`/`.notification-center`
 * `@media (max-width: 900px)` rules), and that `.main-content` measurably
 * gains that reclaimed width back. Also verifies: no horizontal overflow,
 * the collapse/expand control and AppSidebar nav stay keyboard-reachable
 * with focus, and the predictable-state requirement — a manual
 * expand/collapse made at a given width is not immediately fought by the
 * auto-collapse effect on the next render.
 */
test.describe('Sidebar auto-collapse (Mission 8) — real width measurements', () => {
  // App.tsx: NARROW_SIDEBAR_BREAKPOINT_PX. Sidebar should PREFER the
  // auto-collapsed state at/below this width.
  const NARROW_SIDEBAR_BREAKPOINT_PX = 900;
  const measuredMainContentWidthByViewport: Record<string, number> = {};

  test.beforeAll(async () => {
    await window.setViewportSize({ width: 1200, height: 800 });
    await goHome();
    await window.waitForTimeout(150);
  });

  test.afterAll(async () => {
    await window.setViewportSize({ width: 1200, height: 800 });
    await goHome();
    // Surfaced in the test run's own stdout — used to report real
    // before/after `.main-content` widths, not just "improved".
    // eslint-disable-next-line no-console
    console.log('[Mission 8] measured .main-content widths by viewport:', measuredMainContentWidthByViewport);
  });

  async function outerSidebarBox() {
    return window.locator('aside.sidebar').boundingBox();
  }

  async function mainContentBox() {
    return window.locator('.main-content').boundingBox();
  }

  test('sidebar is full-width (320px) at a wide viewport and auto-collapses (72px rail) at/below the narrow breakpoint', async () => {
    await window.setViewportSize({ width: 1200, height: 800 });
    await window.waitForTimeout(250);
    const wideSidebar = await outerSidebarBox();
    expect(wideSidebar).not.toBeNull();
    expect(wideSidebar!.width).toBeGreaterThan(250);
    const wideMain = await mainContentBox();
    expect(wideMain).not.toBeNull();
    measuredMainContentWidthByViewport['1200x800 (wide, sidebar expanded)'] = wideMain!.width;

    for (const width of [NARROW_SIDEBAR_BREAKPOINT_PX, 640]) {
      await window.setViewportSize({ width, height: 700 });
      await window.waitForTimeout(300);
      const narrowSidebar = await outerSidebarBox();
      expect(narrowSidebar).not.toBeNull();
      // The 72px compact rail (index.css: `.sidebar--collapsed { width: 72px }`)
      // — a real bug here would leave the full 320px sidebar and this
      // assertion would fail, not just read as "smaller than before".
      expect(narrowSidebar!.width).toBeLessThan(100);

      const narrowMain = await mainContentBox();
      expect(narrowMain).not.toBeNull();
      measuredMainContentWidthByViewport[`${width}x700 (narrow, sidebar auto-collapsed)`] = narrowMain!.width;

      const overflow = await pageScrollOverflowPx(window);
      expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    }

    await window.setViewportSize({ width: 1200, height: 800 });
    await window.waitForTimeout(250);
  });

  test('main content area is measurably wider at 640px now than the pre-fix ~325px squeeze', async () => {
    await window.setViewportSize({ width: 640, height: 700 });
    await window.waitForTimeout(300);
    const main = await mainContentBox();
    expect(main).not.toBeNull();
    // Prior confirmed gap: main content squeezed to ~325px at 640px viewport
    // with a non-collapsing 320px sidebar (640 - 320 + borders/padding ≈
    // 325px). Assert real headroom above that — not a guessed "improved".
    expect(main!.width).toBeGreaterThan(450);

    await window.setViewportSize({ width: 1200, height: 800 });
    await window.waitForTimeout(250);
  });

  test('a manual expand at a narrow width is not immediately auto-re-collapsed on the next render', async () => {
    await window.setViewportSize({ width: 640, height: 700 });
    await window.waitForTimeout(300);
    const collapseBtn = window.locator('.sidebar-collapse-btn');
    await expect(collapseBtn).toBeVisible();
    await expect(collapseBtn).toHaveAttribute('aria-label', 'Expand sidebar');

    await collapseBtn.click();
    await expect(collapseBtn).toHaveAttribute('aria-label', 'Collapse sidebar');
    // index.css: `.sidebar { transition: width var(--transition-slow) }`
    // (0.35s) — the state flips instantly (hence the aria-label assertion
    // above needs no wait) but the box width animates, so give the CSS
    // transition time to finish before measuring it.
    await window.waitForTimeout(450);
    let sidebar = await outerSidebarBox();
    expect(sidebar!.width).toBeGreaterThan(250);

    // Trigger a re-render at the SAME narrow width (navigation) — the
    // auto-collapse effect only fires on an actual width-category
    // transition, so the user's manual expand must survive this.
    await goMyGames();
    await window.waitForTimeout(150);
    sidebar = await outerSidebarBox();
    expect(sidebar!.width).toBeGreaterThan(250);
    await expect(collapseBtn).toHaveAttribute('aria-label', 'Collapse sidebar');

    // Return to wide without another manual click — the last manual choice
    // recorded (via toggleSidebar's localStorage write above) is "expanded",
    // so the narrow->wide transition effect restores exactly that, leaving
    // the sidebar expanded for later tests in this file that assume it.
    await window.setViewportSize({ width: 1200, height: 800 });
    await window.waitForTimeout(250);
    await expect(collapseBtn).toHaveAttribute('aria-label', 'Collapse sidebar');
    await goHome();
  });

  test('a manual collapse at a wide viewport is respected (not fought)', async () => {
    await window.setViewportSize({ width: 1200, height: 800 });
    await window.waitForTimeout(250);
    const collapseBtn = window.locator('.sidebar-collapse-btn');
    await expect(collapseBtn).toHaveAttribute('aria-label', 'Collapse sidebar');
    await collapseBtn.click();
    await expect(collapseBtn).toHaveAttribute('aria-label', 'Expand sidebar');
    // See the sibling test above — wait out the 0.35s CSS width transition
    // before measuring the box.
    await window.waitForTimeout(450);
    let sidebar = await outerSidebarBox();
    expect(sidebar!.width).toBeLessThan(100);

    await window.waitForTimeout(150);
    sidebar = await outerSidebarBox();
    expect(sidebar!.width).toBeLessThan(100);

    // Restore expanded default for the rest of the suite.
    await collapseBtn.click();
    await expect(collapseBtn).toHaveAttribute('aria-label', 'Collapse sidebar');
  });

  test('sidebar remains free of horizontal overflow and keyboard-reachable across Home / My Games / Trainer Library / Linked Libraries / Game Detail at every required viewport', async () => {
    const viewports = [
      { width: 1200, height: 800 },
      { width: 900, height: 700 },
      { width: 640, height: 700 },
      { width: 900, height: 700 }, // real BrowserWindow.minWidth (electron/main.ts)
    ];

    for (const { width, height } of viewports) {
      await window.setViewportSize({ width, height });
      await window.waitForTimeout(250);

      await goHome();
      await expect(window.locator('[data-testid="app-sidebar"]')).toBeVisible();
      expect(await pageScrollOverflowPx(window)).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      await goMyGames();
      expect(await pageScrollOverflowPx(window)).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      await window.locator('[data-testid="app-sidebar-nav-trainer-library"]').click();
      await window.waitForTimeout(300);
      expect(await pageScrollOverflowPx(window)).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      await window.locator('[data-testid="app-sidebar-nav-linked-libraries"]').click();
      await window.waitForTimeout(300);
      expect(await pageScrollOverflowPx(window)).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      await goMyGames();
      const card = window.locator('[data-testid="my-games-page"] [data-testid="game-card"]').first();
      if (await card.count() > 0) {
        await card.click();
        await expect(window.locator('[data-testid="game-detail-page"]')).toBeVisible();
        expect(await pageScrollOverflowPx(window)).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
        await window.locator('[data-testid="game-detail-back"]').click();
      }

      // Keyboard reachability: the collapse/expand control itself, and the
      // first AppSidebar nav item, must be real focusable/activatable
      // controls at this viewport (not just "present in the DOM").
      const collapseBtn = window.locator('.sidebar-collapse-btn');
      await collapseBtn.focus();
      await expect(collapseBtn).toBeFocused();
      const homeNav = window.locator('[data-testid="app-sidebar-nav-home"]');
      await homeNav.focus();
      await expect(homeNav).toBeFocused();
    }

    await window.setViewportSize({ width: 1200, height: 800 });
    await goHome();
  });
});
