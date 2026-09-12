#!/usr/bin/env node
/**
 * Trainer Library — performance measurement script (Personal Library
 * Completion — Final Closure Pass, Mission 4/13).
 *
 * Drives the REAL built Electron app (dist-electron/main.js), exactly like
 * tests/electron-trainer-library-ux.e2e.test.ts, against a synthetic
 * userData directory seeded with a realistic-scale catalog, and records
 * real timers/DOM queries (never estimates). Kept under scripts/ (not
 * tests/) so it is a repeatable, standalone tool rather than a pass/fail
 * assertion — Mission 13 (a later phase) re-runs it under identical
 * conditions for a real before/after comparison once Mission 3's fast-path
 * change (and Mission 5's chunked rendering) are both in place.
 *
 * Usage:
 *   npm run build:vite && npm run build:electron
 *   node scripts/measure-trainer-library-performance.mjs [--catalog-size=6800] [--out=path.json]
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const CATALOG_SIZE = Number.parseInt(argValue('catalog-size', '6800'), 10);
const OUT_PATH = argValue('out', null);

/**
 * Seeds a realistic-scale catalog directly via the real store modules (same
 * approach as tests/fixtures/personal-library-seed.ts), with a handful of
 * Running/Installed/Owned/Favorite fixtures plus CATALOG_SIZE-8 filler
 * entries so "All Other Games" is genuinely large. NO real game, NO real
 * launcher account — every id is synthetic and namespaced `perf-`.
 */
async function seedRealisticCatalog(userDataPath, catalogSize) {
  process.env.SOLITH_TEST_USER_DATA_PATH = userDataPath;
  process.env.ELECTRON_USER_DATA_PATH = userDataPath;

  const { initDatabase, flushPersistence, closeDatabaseSafely } = await import('../src/core/database/index.js');
  const { upsertCatalogEntry, setCatalogEntryOwnedConfirmed } = await import('../src/core/trainer-catalog/store.js');
  const { upsertInstalledGames } = await import('../src/core/install-discovery/store.js');
  const { addFavorite } = await import('../src/core/favorites/store.js');

  await initDatabase();

  function baseEntry(id, displayName, hasModPack, verificationStatus = 'verified') {
    return {
      catalogGameId: id,
      displayName,
      executables: [`${id}.exe`],
      categories: ['Action'],
      verificationStatus,
      sources: [{ provider: 'user', url: 'perf-fixture://seed' }],
      hasModPack,
      modPackId: undefined,
      cheatCount: hasModPack ? 5 : 0,
      searchableText: displayName.toLowerCase(),
    };
  }

  const installedId = 'perf-installed-game';
  const ownedId = 'perf-owned-game';
  const favoriteId = 'perf-favorite-game';
  const runningId = 'perf-running-game';

  upsertCatalogEntry(baseEntry(installedId, 'Perf Installed Game', true));
  upsertCatalogEntry(baseEntry(ownedId, 'Perf Owned Game', true));
  setCatalogEntryOwnedConfirmed(ownedId, true);
  upsertCatalogEntry(baseEntry(favoriteId, 'Perf Favorite Game', false));
  upsertCatalogEntry(baseEntry(runningId, 'Perf Running Game', true));

  const now = new Date().toISOString();
  upsertInstalledGames([
    {
      id: crypto.randomUUID(),
      installIdentity: 'perf-install-a',
      canonicalInstallPath: 'C:\\PerfFixture\\Installed',
      canonicalExecutablePath: 'C:\\PerfFixture\\Installed\\game.exe',
      identityVersion: 1,
      identityStatus: 'verified',
      needsReverification: false,
      catalogGameId: installedId,
      platform: 'steam',
      installPath: 'C:\\PerfFixture\\Installed',
      executablePath: 'C:\\PerfFixture\\Installed\\game.exe',
      detectedAt: now,
      lastSeenAt: now,
    },
    {
      id: crypto.randomUUID(),
      installIdentity: 'perf-install-running',
      canonicalInstallPath: 'C:\\PerfFixture\\Running',
      canonicalExecutablePath: 'C:\\PerfFixture\\Running\\game.exe',
      identityVersion: 1,
      identityStatus: 'verified',
      needsReverification: false,
      catalogGameId: runningId,
      platform: 'steam',
      installPath: 'C:\\PerfFixture\\Running',
      executablePath: 'C:\\PerfFixture\\Running\\game.exe',
      detectedAt: now,
      lastSeenAt: now,
    },
  ]);

  addFavorite(favoriteId);

  const fillerCount = Math.max(0, catalogSize - 4);
  for (let i = 0; i < fillerCount; i++) {
    upsertCatalogEntry(
      baseEntry(`perf-filler-${i}`, `Zzz Perf Filler Game ${String(i).padStart(5, '0')}`, false, 'metadata-only'),
    );
  }

  await flushPersistence();
  await closeDatabaseSafely();

  return { installedId, ownedId, favoriteId, runningId, totalSeeded: fillerCount + 4 };
}

export { seedRealisticCatalog, MAIN_BUNDLE, ROOT };

async function main() {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    console.error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:vite && npm run build:electron" first.`);
    process.exit(1);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-trainer-library-perf-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`[perf] seeding realistic catalog (target size ${CATALOG_SIZE})...`);
  const seedInfo = await seedRealisticCatalog(userDataDir, CATALOG_SIZE);
  console.log(`[perf] seeded ${seedInfo.totalSeeded} catalog entries.`);

  const results = {
    measuredAt: new Date().toISOString(),
    catalogSizeRequested: CATALOG_SIZE,
    catalogSizeSeeded: seedInfo.totalSeeded,
  };

  const launchStart = performance.now();
  const electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, NODE_ENV: 'test' },
  });
  const window = await electronApp.firstWindow();
  await window.setViewportSize({ width: 1280, height: 800 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 30_000 });
  results.timeToAppShellMs = performance.now() - launchStart;

  const navStart = performance.now();
  await window.getByRole('button', { name: 'Trainer Library' }).click();
  results.timeToTrainerLibraryClickMs = performance.now() - navStart;

  // First Trainer Library shell render: the search input (page chrome) exists,
  // independent of whether any game data has arrived yet.
  const shellStart = performance.now();
  await window.waitForSelector('[aria-label="Search trainer library"]', { timeout: 30_000 });
  results.timeToTrainerLibraryShellRenderMs = performance.now() - shellStart;

  // First personal-game content visible: any card-equivalent <article> mounted
  // (the real DOM, not an estimate).
  const firstContentStart = performance.now();
  try {
    await window.waitForSelector('article[class*="card"]', { timeout: 30_000 });
    results.timeToFirstCardVisibleMs = performance.now() - firstContentStart;
  } catch {
    results.timeToFirstCardVisibleMs = null;
    results.firstCardVisibleTimedOut = true;
  }

  // Full catalog availability: PageModuleHeader's own description text
  // (`${total.toLocaleString()} games ...`) reflects the page's OWN `total`
  // state — the real client-visible signal that the search pipeline has
  // finished growing — not a DB-availability proxy (the DB is already fully
  // seeded before Electron even launches, so a DB-side check would read
  // "available" instantly regardless of what the page has actually fetched
  // and rendered). "Full" is defined as the displayed count holding steady
  // across two checks 1s apart, since the exact final count can be a little
  // under the raw seeded count if a handful of rows are filtered by
  // trainer-catalog eligibility rules unrelated to this measurement.
  function readGamesCount() {
    const match = (document.body.textContent ?? '').match(/([\d,]+) games/);
    return match ? Number.parseInt(match[1].replace(/,/g, ''), 10) : null;
  }
  const fullCatalogStart = performance.now();
  let settledCount = null;
  const settleDeadline = Date.now() + 120_000;
  let previous = await window.evaluate(readGamesCount);
  while (Date.now() < settleDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const current = await window.evaluate(readGamesCount);
    if (current !== null && current === previous && current > 0) {
      settledCount = current;
      break;
    }
    previous = current;
  }
  results.timeToFullCatalogAvailableMs = settledCount !== null ? performance.now() - fullCatalogStart : null;
  results.fullCatalogAvailableTimedOut = settledCount === null;
  results.finalDisplayedGamesCount = settledCount;

  // Give the section-hierarchy view (default) a moment to settle, then count mounted cards.
  await window.waitForTimeout(1000);
  results.mountedCardCountInitial = await window.locator('article[class*="card"]').count();

  // Expand "All Other Games" (the section most likely to hold the bulk of the catalog) if collapsed.
  const otherHeader = window.locator('button', { hasText: 'All Other Games' }).first();
  if (await otherHeader.count()) {
    const expandedAttr = await otherHeader.getAttribute('aria-expanded').catch(() => null);
    if (expandedAttr === 'false') {
      // Playwright's actionability check can find another section's
      // absolutely-positioned SectionVirtualGrid overlapping this button's
      // click point when a preceding section has very few rows (observed
      // during a real run — see this script's usage notes) — force:true
      // bypasses that hover-intercept check only; it still dispatches a
      // real click at the button's real coordinates. Recorded, not hidden,
      // as a note in the printed results below.
      await otherHeader.click({ force: true });
      results.otherSectionExpandRequiredForceClick = true;
      await window.waitForTimeout(500);
      const stillCollapsed = (await otherHeader.getAttribute('aria-expanded').catch(() => null)) === 'false';
      if (stillCollapsed) {
        // force:true only bypasses Playwright's actionability WAIT — the
        // browser still routes the pointer event to whatever element is
        // topmost at that screen point. If an earlier section's
        // absolutely-positioned SectionVirtualGrid genuinely overlaps this
        // button in the real layout, the click lands on that grid instead,
        // and the button's onClick never fires (observed on a real run —
        // aria-expanded stayed 'false'). Falling back to the DOM's own
        // .click() targets the button element directly with no hit-testing
        // at all, isolating whether the section-toggle logic itself works
        // once actually invoked, separate from the click-interception bug.
        await otherHeader.evaluate((el) => el.click());
        results.otherSectionExpandRequiredDomClickFallback = true;
        await window.waitForTimeout(500);
      }
    }
  }
  results.mountedCardCountAfterExpand = await window.locator('article[class*="card"]').count();
  results.otherSectionAriaExpandedAfterClick = await otherHeader.getAttribute('aria-expanded').catch(() => null);
  results.otherSectionRowGroupHeightPx = await window
    .locator('[aria-label="All Other Games results"]')
    .evaluate((el) => el.getBoundingClientRect().height)
    .catch((err) => `<error: ${err.message}>`);

  // Scroll the page to the bottom and re-count (tests whether more mount on scroll, e.g. chunked "Show more").
  await window.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await window.waitForTimeout(500);
  results.mountedCardCountAfterScrollToBottom = await window.locator('article[class*="card"]').count();

  // Search/filter response timing on the full catalog.
  // TrainerLibraryPage.tsx's search-refetch effect deliberately excludes
  // `query` from its dependency array (explicit eslint-disable: "text
  // search uses submit") — free text only re-fetches on the search form's
  // onSubmit, not on every keystroke. fill() alone (the original version of
  // this check) never actually submits, so this must press Enter too, or it
  // measures nothing. Confirmed via the "All Other Games" section's own
  // live count (games.length in its header) on a real run: it never moved
  // off the unfiltered total without an explicit submit.
  const searchInput = window.getByLabel('Search trainer library');
  const otherHeaderForSearchCheck = window.locator('button', { hasText: 'All Other Games' }).first();
  async function readOtherSectionCountForSearch() {
    const text = await otherHeaderForSearchCheck.textContent().catch(() => null);
    const match = text?.match(/\(([\d,]+)\)/);
    return match ? Number.parseInt(match[1].replace(/,/g, ''), 10) : null;
  }
  if (await searchInput.count()) {
    const searchStart = performance.now();
    await searchInput.fill('Perf Filler Game 00500');
    await searchInput.press('Enter');
    let previous = await readOtherSectionCountForSearch();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = await readOtherSectionCountForSearch();
      if (current === previous) break;
      previous = current;
    }
    results.searchResponseMs = performance.now() - searchStart;
    results.searchNarrowedOtherSectionCount = previous;
    await searchInput.fill('');
    await searchInput.press('Enter');
  } else {
    results.searchResponseMs = null;
    results.searchInputNotFound = true;
  }

  // Main-process memory via Electron's app.getAppMetrics() (no renderer JS heap involved).
  try {
    const metrics = await electronApp.evaluate(({ app }) => app.getAppMetrics());
    const total = metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0);
    results.mainProcessMetrics = metrics.map((m) => ({
      type: m.type,
      pid: m.pid,
      workingSetSizeKb: m.memory?.workingSetSize ?? null,
    }));
    results.totalWorkingSetSizeKb = total;
  } catch (error) {
    results.mainProcessMetrics = null;
    results.memoryMeasurementError = String(error);
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

// Guard so a sibling script can `import { seedRealisticCatalog } from
// './measure-trainer-library-performance.mjs'` to reuse the catalog-seeding
// harness without triggering this script's own CLI run as a side effect.
const isDirectRun = (() => {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    console.error('[perf] measurement failed:', error);
    process.exit(1);
  });
}
