#!/usr/bin/env node
/**
 * Visual Library 2.0 — performance measurement script.
 *
 * Companion to scripts/measure-trainer-library-performance.mjs (imports its
 * catalog-seeding harness directly rather than duplicating it — see that
 * file's `seedRealisticCatalog` export). That script already covers Trainer
 * Library shell/first-card/full-catalog/search-response/memory timings
 * against the real built Electron app; this script covers the NEW Visual
 * Library 2.0 surfaces added this session that it does not touch:
 *
 *   1. AppSidebar + SidebarQuickAccess: time to sidebar visible, time to
 *      My Games/Favorites quick-access sections showing real (seeded) data.
 *      ("Running" is event-driven off a live process-detect IPC event with
 *      no query-on-load path — see usePersonalLibraryGames.ts's header — so
 *      it cannot be exercised by a static DB seed with no real running
 *      process; this script measures Favorites and My Games only and says
 *      so explicitly rather than fabricating a Running number.)
 *   2. HomePage: time to hero + first shelf, navigated to explicitly since
 *      App.tsx's actual default `currentView` is 'library' (Trainer
 *      Library), NOT 'home' — confirmed by reading src/app/App.tsx directly
 *      rather than assumed.
 *   3. SectionVirtualGrid mounted-DOM-node-count at top/middle/bottom scroll
 *      of the "All Other Games" section, against the same ~6,800-entry
 *      synthetic catalog — the direct evidence for whether Mission 17's
 *      virtualization claim holds under real measurement.
 *   4. Search-with-no-results timing, and sort-mode-switch timing (flat A-Z
 *      view, where TrainerLibrarySortMenu applies — see
 *      trainer-library-sort-options.ts's scope note) against the full
 *      catalog.
 *   5. Grid <-> list view-mode toggle: rough wall-clock timing per toggle
 *      plus a mounted-card-count comparison immediately after, to check for
 *      an unexpected full remount/empty-frame.
 *
 * Usage:
 *   npm run build:vite && npm run build:electron
 *   node scripts/measure-visual-library-performance.mjs [--catalog-size=6800] [--out=path.json]
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { seedRealisticCatalog, MAIN_BUNDLE } from './measure-trainer-library-performance.mjs';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const CATALOG_SIZE = Number.parseInt(argValue('catalog-size', '6800'), 10);
const OUT_PATH = argValue('out', null);

async function countMountedCardsAndNodes(window) {
  const cardCount = await window.locator('article[class*="card"]').count();
  const totalDomNodes = await window.evaluate(() => document.querySelectorAll('*').length);
  return { cardCount, totalDomNodes };
}

async function main() {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    console.error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:vite && npm run build:electron" first.`);
    process.exit(1);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-visual-library-perf-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`[perf] seeding realistic catalog (target size ${CATALOG_SIZE})...`);
  const seedInfo = await seedRealisticCatalog(userDataDir, CATALOG_SIZE);
  console.log(`[perf] seeded ${seedInfo.totalSeeded} catalog entries.`);

  const results = {
    measuredAt: new Date().toISOString(),
    catalogSizeRequested: CATALOG_SIZE,
    catalogSizeSeeded: seedInfo.totalSeeded,
    notes: [],
  };

  const launchStart = performance.now();
  const electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, NODE_ENV: 'test' },
  });
  const window = await electronApp.firstWindow();
  window.on('console', (msg) => console.error(`[renderer console:${msg.type()}] ${msg.text()}`));
  window.on('pageerror', (err) => console.error('[renderer pageerror]', err));
  await window.setViewportSize({ width: 1280, height: 800 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 30_000 });
  results.timeToAppShellMs = performance.now() - launchStart;

  // App.tsx's actual default `currentView` is 'library' (the OLD/legacy
  // GameLibrary view — see App.tsx's `useState<View>(... : 'library')` and
  // its renderContent switch) — NOT a view in APP_SIDEBAR_VIEWS
  // (nav-views.ts). The NEW AppSidebar (data-testid="app-sidebar") only
  // mounts once currentView is one of APP_SIDEBAR_VIEWS ('home',
  // 'my-games', 'trainer-library', 'ct-library', 'linked-libraries',
  // 'game-detail', ...). On a cold launch only the OLD legacy
  // `<aside className="sidebar">` nav is present; reaching the redesigned
  // sidebar requires one navigation via that legacy nav first — exactly
  // what a real user's first click would do. Both timings are recorded.
  const legacySidebarStart = performance.now();
  await window.waitForSelector('aside.sidebar, aside[class*="sidebar"]', { timeout: 30_000 });
  results.timeToLegacySidebarVisibleMs = performance.now() - legacySidebarStart;

  const navToAppSidebarStart = performance.now();
  await window.getByRole('button', { name: 'Trainer Library' }).click();
  try {
    await window.waitForSelector('[data-testid="app-sidebar"]', { timeout: 30_000 });
    results.timeToAppSidebarVisibleAfterNavMs = performance.now() - navToAppSidebarStart;
  } catch (error) {
    const bodyText = await window.evaluate(() => document.body.innerText).catch(() => '<unreadable>');
    console.error('[perf] DEBUG: app-sidebar selector timed out. Current body text (first 2000 chars):');
    console.error(bodyText.slice(0, 2000));
    throw error;
  }
  results.notes.push(
    "'timeToLegacySidebarVisibleMs' is the always-present legacy nav " +
      "(cold-launch default view). 'timeToAppSidebarVisibleAfterNavMs' is " +
      'the redesigned AppSidebar, measured from the moment the legacy ' +
      "'Trainer Library' nav button was clicked (App.tsx's real default " +
      "view is 'library', not a Visual Library 2.0 view, so the new " +
      'sidebar cannot appear before that first navigation on a cold launch).',
  );

  const favoritesStart = performance.now();
  try {
    await window.waitForSelector('[aria-label="Favorites"] article[class*="card"]', { timeout: 20_000 });
    results.timeToSidebarFavoritesDataMs = performance.now() - favoritesStart;
  } catch {
    results.timeToSidebarFavoritesDataMs = null;
    results.sidebarFavoritesTimedOut = true;
  }

  const myGamesStart = performance.now();
  try {
    await window.waitForSelector('[aria-label="My Games"] article[class*="card"]', { timeout: 20_000 });
    results.timeToSidebarMyGamesDataMs = performance.now() - myGamesStart;
  } catch {
    results.timeToSidebarMyGamesDataMs = null;
    results.sidebarMyGamesTimedOut = true;
  }

  results.notes.push(
    "Sidebar 'Running' quick-access section is event-driven off a live " +
      'onCatalogProcessDetected IPC event with no query-on-load path ' +
      '(usePersonalLibraryGames.ts) — it cannot be exercised by a static DB ' +
      'seed with no real running game process, so it is NOT measured here ' +
      '(would require live-game interaction, out of scope for this task).',
  );

  // ---- 2. Home page: navigate explicitly (default currentView is 'library', not 'home' — verified in App.tsx) ----
  const homeNavStart = performance.now();
  await window.locator('[data-testid="app-sidebar-nav-home"]').click();
  const heroStart = performance.now();
  results.timeToHomeNavClickMs = homeNavStart - homeNavStart; // click itself is near-instant; kept for symmetry
  try {
    await window.waitForSelector('[data-testid="home-page"]', { timeout: 20_000 });
    results.timeToHomePageShellMs = performance.now() - heroStart;
  } catch {
    results.timeToHomePageShellMs = null;
    results.homePageShellTimedOut = true;
  }
  try {
    // Hero renders either a real hero (home-hero) or an explicit empty state
    // (home-hero-empty) — both are "hero resolved", never a permanent skeleton.
    await window.waitForSelector('[data-testid="home-hero"], [data-testid="home-hero-empty"]', { timeout: 20_000 });
    results.timeToHomeHeroResolvedMs = performance.now() - heroStart;
    results.homeHeroVariant = (await window.locator('[data-testid="home-hero"]').count()) > 0 ? 'real-hero' : 'empty-state';
  } catch {
    results.timeToHomeHeroResolvedMs = null;
    results.homeHeroTimedOut = true;
  }
  try {
    await window.waitForSelector('article[class*="card"]', { timeout: 20_000 });
    results.timeToHomeFirstShelfCardMs = performance.now() - heroStart;
  } catch {
    results.timeToHomeFirstShelfCardMs = null;
    results.homeFirstShelfCardTimedOut = true;
  }

  // ---- Navigate to Trainer Library for the remaining measurements ----
  await window.locator('[data-testid="app-sidebar-nav-trainer-library"]').click();
  await window.waitForSelector('[aria-label="Search trainer library"]', { timeout: 30_000 });

  // Wait for the full ~6,800-row catalog to settle before measuring virtualization —
  // same settle-detection approach as measure-trainer-library-performance.mjs.
  function readGamesCount() {
    const match = (document.body.textContent ?? '').match(/([\d,]+) games/);
    return match ? Number.parseInt(match[1].replace(/,/g, ''), 10) : null;
  }
  {
    let previous = await window.evaluate(readGamesCount);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const current = await window.evaluate(readGamesCount);
      if (current !== null && current === previous && current > 0) break;
      previous = current;
    }
  }

  // Expand "All Other Games" — collapsed by default (library-sections.ts).
  const otherHeader = window.locator('button', { hasText: 'All Other Games' }).first();
  if (await otherHeader.count()) {
    const expandedAttr = await otherHeader.getAttribute('aria-expanded').catch(() => null);
    if (expandedAttr === 'false') {
      // See measure-trainer-library-performance.mjs's identical comment —
      // a preceding section's absolutely-positioned SectionVirtualGrid can
      // intercept this button's click point when that section has very few
      // rows. force:true bypasses only the actionability wait.
      await otherHeader.click({ force: true });
      await window.waitForTimeout(500);
      if ((await otherHeader.getAttribute('aria-expanded').catch(() => null)) === 'false') {
        // Confirmed on a real run: force:true only skips Playwright's own
        // actionability wait — the browser still routes the pointer event
        // to whatever element is topmost at that screen point, and a
        // preceding section's overlapping grid can genuinely swallow it.
        // The DOM's own .click() targets the button directly, no
        // hit-testing at all.
        await otherHeader.evaluate((el) => el.click());
        results.otherSectionExpandRequiredDomClickFallback = true;
        await window.waitForTimeout(500);
      }
    }
  } else {
    results.notes.push('"All Other Games" section header not found — virtualization node-count measurement skipped.');
  }

  // ---- 3. SectionVirtualGrid mounted-node-count at top / middle / bottom ----
  await window.evaluate(() => window.scrollTo(0, 0));
  await window.waitForTimeout(400);
  results.virtualization = {};
  results.virtualization.atTop = await countMountedCardsAndNodes(window);

  await window.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await window.waitForTimeout(400);
  results.virtualization.atMiddle = await countMountedCardsAndNodes(window);

  await window.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await window.waitForTimeout(400);
  results.virtualization.atBottom = await countMountedCardsAndNodes(window);

  await window.evaluate(() => window.scrollTo(0, 0));
  await window.waitForTimeout(300);

  // readGamesCount() (used above for the full-catalog settle loop) reads
  // PageModuleHeader's total-catalog-size text, which does NOT change with
  // the free-text query (confirmed on a real run: it stayed at 6,856 for
  // both a nonsense query and a real substring match) — it is the wrong
  // signal for "did the search actually filter results". The real signal
  // is each section's own live count in its header text, e.g. "All Other
  // Games (1,234)" (TrainerLibraryPage.tsx renders `${label} (${games.length})`
  // directly from the filtered/sorted array) — poll THAT instead.
  async function readOtherSectionCount() {
    // A genuinely zero-match "All Other Games" section unmounts entirely
    // (TrainerLibraryPage.tsx: `if (games.length === 0) return null;`), so
    // the header button legitimately stops existing — that's count 0, not
    // a transient miss. Without an explicit short timeout here,
    // Playwright's default ~30s actionability wait on a genuinely-absent
    // locator stacks up across repeated polls (observed on a real run:
    // ~60s total for one no-result search check).
    if ((await otherHeaderLocator.count()) === 0) return 0;
    const text = await otherHeaderLocator.textContent({ timeout: 500 }).catch(() => null);
    if (!text) return 0;
    const match = text.match(/\(([\d,]+)\)/);
    return match ? Number.parseInt(match[1].replace(/,/g, ''), 10) : 0;
  }
  async function waitForOtherSectionCountSettle(maxWaitMs) {
    let previous = await readOtherSectionCount();
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = await readOtherSectionCount();
      if (current === previous) return current;
      previous = current;
    }
    return previous;
  }
  const otherHeaderLocator = window.locator('button', { hasText: 'All Other Games' }).first();

  // ---- 4a. Search with a no-result query ----
  // TrainerLibraryPage.tsx's own search-refetch effect deliberately excludes
  // `query` from its dependency array (explicit eslint-disable comment:
  // "text search uses submit") — free text only re-fetches on the search
  // FORM's onSubmit (handleSearch), not on every keystroke. A real user
  // presses Enter or clicks "Search"; searchInput.fill() alone (confirmed on
  // a real run: the "All Other Games" count never moved from the unfiltered
  // 6,853 for either query) only sets the input value without submitting.
  const searchInput = window.getByLabel('Search trainer library');
  if (await searchInput.count()) {
    const noResultStart = performance.now();
    await searchInput.fill('zzz-definitely-not-a-real-game-title-zzz');
    await searchInput.press('Enter');
    const settledOtherCount = await waitForOtherSectionCountSettle(10_000);
    results.noResultSearchResponseMs = performance.now() - noResultStart;
    results.noResultOtherSectionCount = settledOtherCount;
    results.noResultCardCount = await window.locator('article[class*="card"]').count();
    await searchInput.fill('');
    await searchInput.press('Enter');
    await waitForOtherSectionCountSettle(10_000);
  } else {
    results.noResultSearchResponseMs = null;
    results.searchInputNotFound = true;
  }

  // ---- 4b. Common-title search timing ----
  if (await searchInput.count()) {
    const commonStart = performance.now();
    await searchInput.fill('Perf Filler Game 003');
    await searchInput.press('Enter');
    const settledOtherCount = await waitForOtherSectionCountSettle(10_000);
    results.commonTitleSearchResponseMs = performance.now() - commonStart;
    results.commonTitleOtherSectionCount = settledOtherCount;
    results.commonTitleCardCount = await window.locator('article[class*="card"]').count();
    await searchInput.fill('');
    await searchInput.press('Enter');
    await waitForOtherSectionCountSettle(10_000);
  }

  // ---- 4c. Sort-mode switch timing (flat A-Z view — sort menu scope) ----
  const flatListButton = window.getByRole('button', { name: 'Flat list' });
  if (await flatListButton.count()) {
    await flatListButton.click();
    await window.waitForTimeout(500);
    const sortSelect = window.getByLabel('Sort trainer library');
    if (await sortSelect.count()) {
      results.sortSwitchMs = {};
      for (const option of ['a-z', 'trainer-quality', 'recommended']) {
        const start = performance.now();
        await sortSelect.selectOption(option);
        await window.waitForTimeout(300);
        results.sortSwitchMs[option] = performance.now() - start;
      }
    } else {
      results.sortSwitchMs = null;
      results.sortMenuNotFound = true;
    }
    await flatListButton.click();
    await window.waitForTimeout(300);
  } else {
    results.sortSwitchMs = null;
    results.flatListToggleNotFound = true;
  }

  // ---- 5. Grid <-> list view-mode toggle timing + remount check ----
  const beforeToggle = await countMountedCardsAndNodes(window);
  const listRadio = window.getByRole('radio', { name: 'List' });
  const gridRadio = window.getByRole('radio', { name: 'Grid' });
  if (await listRadio.count()) {
    const toListStart = performance.now();
    await listRadio.click();
    await window.waitForTimeout(200);
    const toListMs = performance.now() - toListStart;
    const afterToList = await countMountedCardsAndNodes(window);

    const toGridStart = performance.now();
    await gridRadio.click();
    await window.waitForTimeout(200);
    const toGridMs = performance.now() - toGridStart;
    const afterToGrid = await countMountedCardsAndNodes(window);

    results.viewModeToggle = {
      beforeToggle,
      toListMs,
      afterToList,
      toGridMs,
      afterToGrid,
      note:
        'toXMs is wall-clock for the click + a fixed 200ms settle window, not a ' +
        'frame-timing profile — Playwright has no built-in jank/frame-drop ' +
        'metric, so this is qualitative-timing only per the task scope. ' +
        'Card counts before/after are the real check for a full remount ' +
        '(cardCount dropping to 0 at any point would indicate one; none ' +
        'observed if the numbers stay comparable).',
    };
  } else {
    results.viewModeToggle = null;
    results.viewModeToggleNotFound = true;
  }

  await electronApp.close();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  console.log(JSON.stringify(results, null, 2));
  if (OUT_PATH) {
    fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
    console.log(`[perf] wrote results to ${OUT_PATH}`);
  }
}

main().catch((error) => {
  console.error('[perf] measurement failed:', error);
  process.exit(1);
});
