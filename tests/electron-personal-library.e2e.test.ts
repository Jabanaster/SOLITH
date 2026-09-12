/**
 * tests/electron-personal-library.e2e.test.ts
 *
 * Personal Library Final Certification pass — Mission 1-8.
 *
 * Drives the REAL Electron renderer (built dist-electron/main.js) against a
 * fully synthetic, isolated userData directory seeded via
 * tests/fixtures/personal-library-seed.ts. NO real game, NO real launcher
 * account, NO real process attach — every fixture id/path is synthetic.
 *
 * Run with: npx playwright test tests/electron-personal-library.e2e.test.ts --config playwright.e2e.config.ts
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  seedPersonalLibraryFixtures,
  simulateSupportBecomingAvailable,
  FIXTURE_IDS,
  UNMATCHED_LOCAL_INSTALL_DISPLAY_NAME,
} from './fixtures/personal-library-seed.ts';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

const DISPLAY_NAMES = {
  installedSupported: 'Fixture Installed Supported',
  installedUnsupported: 'Fixture Installed Unsupported',
  ownedSupported: 'Fixture Owned Supported',
  ownedUnsupported: 'Fixture Owned Unsupported',
  unownedSupported: 'Fixture Unowned Supported',
  favoriteGame: 'Fixture Favorite Game',
  supportRequestedGame: 'Fixture Support Requested Game',
  multiLauncherGame: 'Fixture Multi Launcher Game',
};

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:electron" before running this test.`);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  userDataDir = path.join(os.tmpdir(), `solith-personal-library-e2e-${runId}`);
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
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 15_000 });

  // Navigate to Trainer Library.
  await window.getByRole('button', { name: 'Trainer Library' }).click();
  // Wait for the catalog fetch (fetchPage on mount) to settle.
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

// ── Mission 2 — frozen section order, real DOM ──────────────────────────────

test('Mission 2: sections render in the frozen order — Installed, Owned/Trainers, Owned/Support Needed, All Other Games, Missing/Not Yet Supported', async () => {
  const sectionLabels = await window.locator('section[aria-label]').evaluateAll((sections) =>
    sections.map((s) => s.getAttribute('aria-label')),
  );
  assert_in_order(sectionLabels, [
    'Installed',
    'Owned — Trainers Available',
    'Owned — Support Needed',
    'All Other Games',
    'Missing / Not Yet Supported',
  ]);
});

function assert_in_order(actual: (string | null)[], expectedInOrder: string[]) {
  const indices = expectedInOrder.map((label) => actual.indexOf(label));
  for (const idx of indices) expect(idx).toBeGreaterThanOrEqual(0);
  for (let i = 1; i < indices.length; i++) {
    expect(indices[i]).toBeGreaterThan(indices[i - 1]);
  }
}

test('Mission 1/2: Installed section contains both installed fixtures (supported + unsupported), A-Z ordered', async () => {
  const installedSection = window.locator('section[aria-label="Installed"]');
  await expect(installedSection).toContainText(DISPLAY_NAMES.installedSupported);
  await expect(installedSection).toContainText(DISPLAY_NAMES.installedUnsupported);
  const titles = await installedSection.locator('h2').allTextContents();
  const relevant = titles.filter((t) => t.startsWith('Fixture Installed'));
  expect(relevant).toEqual([...relevant].sort((a, b) => a.localeCompare(b)));
});

test('Mission 1/2: Owned — Trainers Available contains the owned+supported fixture', async () => {
  const section = window.locator('section[aria-label="Owned — Trainers Available"]');
  await expect(section).toContainText(DISPLAY_NAMES.ownedSupported);
  // The owned+unsupported fixture must NOT be here — it belongs in the other owned bucket.
  await expect(section).not.toContainText(DISPLAY_NAMES.ownedUnsupported);
});

test('Mission 1/2: Owned — Support Needed contains the owned+unsupported and support-requested fixtures', async () => {
  const section = window.locator('section[aria-label="Owned — Support Needed"]');
  await expect(section).toContainText(DISPLAY_NAMES.ownedUnsupported);
  await expect(section).toContainText(DISPLAY_NAMES.supportRequestedGame);
});

// ── Mission 3 — All Other Games collapse ────────────────────────────────────

test('Mission 3: All Other Games is collapsed by default, shows a count, expands and collapses again', async () => {
  const section = window.locator('section[aria-label="All Other Games"]');
  // Scoped to the section HEADER specifically — once expanded, `section
  // .locator('button')` also matches every card's own buttons (favorite,
  // launch, mark-as-owned, ...) inside that section, which is a strict-mode
  // violation the collapsed-state assertion above never exercised.
  const header = section.getByRole('button', { name: /All Other Games/ });
  // ~1000 filler entries + Fixture Unowned Supported + Fixture Favorite Game
  // (both unowned/not-installed/catalog-known -> "All Other Games"). Asserts
  // the COMPLETE personal library was fetched (see load()'s certification-
  // pass fix) rather than a single 120-row page — a 4-digit count proves
  // this; the exact figure isn't pinned since unrelated background catalog
  // bookkeeping (see Mission 12/13 report) can add a small number of rows
  // without affecting what this test actually verifies (collapse mechanics).
  await expect(header).toContainText(/All Other Games \(1,\d{3}\)/);
  // Collapsed: the grid of cards must not be present.
  await expect(section.locator('.card, article')).toHaveCount(0);

  await header.click();
  await expect(header).toContainText('Collapse');
  // SectionVirtualGrid only mounts cards inside the visible+overscan window
  // (see SectionVirtualGrid.tsx / use-window-scroll-virtualization.ts).
  // "Fixture Unowned Supported" sorts A-Z well past the top of this
  // ~1,000+ entry section (real catalog game names precede it), so it is
  // legitimately not mounted the instant the section expands — a real user
  // would need to scroll (or search, per Mission 4) to reach it too.
  //
  // The actual scrollable region is `<main class="content-area">` (see
  // src/app/styles/index.css's `.content-area { overflow-y: auto }`), NOT
  // `window` — the app shell's main content pane owns its own scrollbox, the
  // document/window never scrolls. Scroll that real container incrementally
  // until the target mounts, matching how a real user would reach it.
  await window.waitForFunction(
    (targetText) => {
      const scrollRegion = document.querySelector('main.content-area');
      if (!scrollRegion) return false;
      if (document.body.innerText.includes(targetText)) return true;
      scrollRegion.scrollTop += scrollRegion.clientHeight;
      return false;
    },
    DISPLAY_NAMES.unownedSupported,
    { timeout: 15_000, polling: 100 },
  );
  await expect(section).toContainText(DISPLAY_NAMES.unownedSupported);

  // Scroll back to the top before collapsing again — the collapse/expand
  // toggle itself is scroll-position-independent, but resetting here keeps
  // this test from leaving the content pane scrolled for whatever runs next.
  await window.evaluate(() => document.querySelector('main.content-area')?.scrollTo(0, 0));
  await header.click();
  await expect(header).toContainText('Expand');
  await expect(section.locator('.card, article')).toHaveCount(0);
});

// ── Mission 4 — search overrides collapse, across all sections ─────────────

test('Mission 4: searching a match inside the collapsed All Other Games section surfaces it without manual expand', async () => {
  const searchInput = window.getByLabel('Search trainer library');
  await searchInput.fill('Fixture Unowned Supported');
  await window.getByRole('button', { name: 'Search', exact: true }).click();
  await window.waitForTimeout(500);

  const section = window.locator('section[aria-label="All Other Games"]');
  await expect(section).toContainText(DISPLAY_NAMES.unownedSupported, { timeout: 15_000 });
  // aria-expanded must be true while search is active, even though the
  // section's own collapsed-by-default preference was never toggled.
  await expect(section.locator('button').first()).toHaveAttribute('aria-expanded', 'true');

  await searchInput.fill('');
  await window.getByRole('button', { name: 'Search', exact: true }).click();
  await window.waitForTimeout(500);
  // Normal collapsed state restored (no user override was ever set this run).
  await expect(section.locator('button').first()).toHaveAttribute('aria-expanded', 'false');
});

test('Mission 4: search finds matches across installed, owned-supported, owned-unsupported, and missing/unsupported sections', async () => {
  const searchInput = window.getByLabel('Search trainer library');
  const searchBtn = window.getByRole('button', { name: 'Search', exact: true });

  for (const [label, section] of [
    [DISPLAY_NAMES.installedSupported, 'Installed'],
    [DISPLAY_NAMES.ownedSupported, 'Owned — Trainers Available'],
    [DISPLAY_NAMES.ownedUnsupported, 'Owned — Support Needed'],
  ] as const) {
    await searchInput.fill(label);
    await searchBtn.click();
    await window.waitForTimeout(400);
    await expect(window.locator(`section[aria-label="${section}"]`)).toContainText(label, { timeout: 15_000 });
  }

  // Missing/Not Yet Supported is populated from install-discovery, not the
  // catalog search backend — its client-side query filter (see
  // TrainerLibraryPage.tsx's queryFilteredUnmatchedEvidence) must also honor
  // the active search text.
  await searchInput.fill(UNMATCHED_LOCAL_INSTALL_DISPLAY_NAME);
  await searchBtn.click();
  await window.waitForTimeout(400);
  await expect(window.locator('section[aria-label="Missing / Not Yet Supported"]')).toContainText(
    UNMATCHED_LOCAL_INSTALL_DISPLAY_NAME,
    { timeout: 15_000 },
  );

  await searchInput.fill('');
  await searchBtn.click();
  await window.waitForTimeout(400);
});

// ── Mission 8 — multi-launcher canonical display ────────────────────────────

test('Mission 8: a game installed via two launchers renders as exactly ONE card, not two', async () => {
  const cards = window.locator('h2', { hasText: DISPLAY_NAMES.multiLauncherGame });
  await expect(cards).toHaveCount(1);
});

// ── Mission 5 — Favorites real UX ───────────────────────────────────────────

test('Mission 5: the pre-seeded favorite renders as starred, and Favorites view shows only favorites', async () => {
  // fx-favorite-game classifies into "All Other Games", which is collapsed
  // by default — switching to the Favorites-only view must both filter to
  // favorites AND force every matching section open (certification-pass
  // fix: forceSectionsExpanded), the same way an active search already did.
  await window.getByRole('button', { name: '★ Favorites' }).click();
  await window.waitForTimeout(300);
  // Scoped to <main> — the new persistent sidebar (SidebarQuickAccess) added
  // this session renders its own "Favorites" and "My Games" quick-access
  // widgets using the same GameCard component, which is also an <article>
  // (see src/app/components/GameCard.tsx). An unscoped page-wide 'article'
  // locator picks those up too (the sidebar's Favorites widget plus its My
  // Games widget's installed/owned fixtures), even though the Trainer
  // Library page's own Favorites-only filter is working correctly — the
  // sidebar simply isn't part of what this assertion is about. Scoping to
  // <main> (see App.tsx's `<main id="main-content">`) excludes the sidebar
  // <aside> entirely.
  await expect(window.locator('main article')).toHaveCount(1, { timeout: 15_000 });
  await expect(window.locator('main article h2')).toHaveText(DISPLAY_NAMES.favoriteGame);

  const favoriteCard = window.locator('article', { has: window.locator('h2', { hasText: DISPLAY_NAMES.favoriteGame }) });
  // The favorite button's accessible name is "Remove <title> from favorites"
  // (see TrainerLibraryPage.tsx's aria-label) — locate by its visible glyph
  // text instead, since role/name matching against the literal "★" would
  // never match that aria-label.
  await expect(favoriteCard.locator('button', { hasText: '★' })).toBeVisible();

  await window.getByRole('button', { name: '★ Favorites' }).click();
  await window.waitForTimeout(300);
});

test('Mission 5: clicking an unfavorited card\'s star favorites it, and clicking again unfavorites it (persisted via IPC)', async () => {
  // fx-unowned-supported also lives in the collapsed "All Other Games"
  // section — search overrides collapse (Mission 4) so the card is
  // reachable without ever needing to click Expand manually.
  const searchInput = window.getByLabel('Search trainer library');
  await searchInput.fill(DISPLAY_NAMES.unownedSupported);
  await window.getByRole('button', { name: 'Search', exact: true }).click();
  await window.waitForTimeout(400);

  const targetTitle = window.locator('h2', { hasText: DISPLAY_NAMES.unownedSupported });
  const targetCard = targetTitle.locator('xpath=ancestor::article[1]');
  // hasText matches the button's visible glyph, not its accessible
  // aria-label ("Add/Remove <title> to/from favorites") — see the note above.
  const starBtn = targetCard.locator('button', { hasText: '☆' });
  await expect(starBtn).toBeVisible({ timeout: 15_000 });
  await starBtn.click();
  await expect(targetCard.locator('button', { hasText: '★' })).toBeVisible({ timeout: 5_000 });

  const listResult = await window.evaluate(() => window.electronAPI!.listFavorites!());
  expect(listResult.success).toBe(true);
  expect(listResult.favoriteIds).toContain(FIXTURE_IDS.unownedSupported);

  await targetCard.locator('button', { hasText: '★' }).click();
  await expect(targetCard.locator('button', { hasText: '☆' })).toBeVisible({ timeout: 5_000 });
  const listAfterUnfav = await window.evaluate(() => window.electronAPI!.listFavorites!());
  expect(listAfterUnfav.favoriteIds).not.toContain(FIXTURE_IDS.unownedSupported);

  await searchInput.fill('');
  await window.getByRole('button', { name: 'Search', exact: true }).click();
  await window.waitForTimeout(400);
});

test('Mission 5: favorite persistence survives an app restart (same userData directory, fresh Electron process)', async () => {
  await electronApp.close();
  electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, NODE_ENV: 'test' },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 15_000 });

  const listResult = await window.evaluate(() => window.electronAPI!.listFavorites!());
  expect(listResult.success).toBe(true);
  // fx-favorite-game was never unfavorited in this run — must still be there after restart.
  expect(listResult.favoriteIds).toContain(FIXTURE_IDS.favoriteGame);

  await window.getByRole('button', { name: 'Trainer Library' }).click();
  await window.waitForSelector('text=Loading catalog…', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await expect(window.locator('section[aria-label]').first()).toBeVisible({ timeout: 30_000 });
});

// ── Mission 6 — Request Support real UX ─────────────────────────────────────

test('Mission 6: an unsupported fixture shows "Not Yet Supported" and a working Request Support button; duplicate clicks do not create duplicate rows', async () => {
  const targetTitle = window.locator('h2', { hasText: DISPLAY_NAMES.ownedUnsupported });
  const targetCard = targetTitle.locator('xpath=ancestor::article[1]');
  await expect(targetCard).toContainText('Not Yet Supported', { timeout: 15_000 });

  const requestBtn = targetCard.getByRole('button', { name: 'Request Support' });
  await requestBtn.click();
  await expect(targetCard).toContainText('Support Requested ✓', { timeout: 5_000 });

  // "Click again" — the button is gone once requested (see CatalogCard's
  // supportRequestStatus branch), so attempt the underlying IPC call
  // directly to prove the backend itself is duplicate-safe regardless of UI state.
  const firstCall = await window.evaluate(
    (id) => window.electronAPI!.requestGameSupport!({ canonicalGameId: id, gameTitle: 'Fixture Owned Unsupported', platforms: ['Steam'] }),
    FIXTURE_IDS.ownedUnsupported,
  );
  const secondCall = await window.evaluate(
    (id) => window.electronAPI!.requestGameSupport!({ canonicalGameId: id, gameTitle: 'Fixture Owned Unsupported', platforms: ['Steam'] }),
    FIXTURE_IDS.ownedUnsupported,
  );
  expect(firstCall.success).toBe(true);
  expect(secondCall.success).toBe(true);
  expect(firstCall.request?.requestId).toBe(secondCall.request?.requestId);

  const allRequests = await window.evaluate(() => window.electronAPI!.listSupportRequests!());
  const matching = allRequests.requests!.filter((r) => r.canonicalGameId === FIXTURE_IDS.ownedUnsupported);
  expect(matching).toHaveLength(1);
});

test('Mission 6: support-request persistence survives an app restart', async () => {
  await electronApp.close();
  electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, NODE_ENV: 'test' },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 15_000 });

  const status = await window.evaluate(
    (id) => window.electronAPI!.getSupportRequestStatus!({ canonicalGameId: id }),
    FIXTURE_IDS.supportRequestedGame,
  );
  expect(status.success).toBe(true);
  expect(status.request?.status).toBe('REQUESTED');
});

test('Mission 6: support state resolves once support becomes available, and the game moves out of "needs support" entirely', async () => {
  // resolveSupportRequestIfExists is a core store function with no IPC
  // channel (by design — Mission 10 forbids exposing generic mutation, and
  // there is no legitimate renderer-triggered use case for a user to flip
  // their own game's support status). Simulating this requires the same
  // "close Electron, mutate the on-disk DB directly, relaunch" pattern
  // already used for the two persistence-across-restart tests above.
  await electronApp.close();
  await simulateSupportBecomingAvailable(userDataDir, FIXTURE_IDS.supportRequestedGame);

  electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, NODE_ENV: 'test' },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#root > *', { timeout: 15_000 });

  const status = await window.evaluate(
    (id) => window.electronAPI!.getSupportRequestStatus!({ canonicalGameId: id }),
    FIXTURE_IDS.supportRequestedGame,
  );
  expect(status.success).toBe(true);
  expect(status.request?.status).toBe('SUPPORTED');

  await window.getByRole('button', { name: 'Trainer Library' }).click();
  await window.waitForSelector('text=Loading catalog…', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await expect(window.locator('section[aria-label]').first()).toBeVisible({ timeout: 30_000 });

  // The fixture is now hasModPack:true AND ownedConfirmed:true -> it must
  // have moved from "Owned — Support Needed" to "Owned — Trainers Available",
  // and no longer show any Request Support UI at all (superseded, not just
  // relabeled — see CatalogCard: the whole row disappears once hasModPack is true).
  const trainersAvailable = window.locator('section[aria-label="Owned — Trainers Available"]');
  await expect(trainersAvailable).toContainText(DISPLAY_NAMES.supportRequestedGame, { timeout: 15_000 });
  const supportNeeded = window.locator('section[aria-label="Owned — Support Needed"]');
  await expect(supportNeeded).not.toContainText(DISPLAY_NAMES.supportRequestedGame);

  const movedCardTitle = window.locator('h2', { hasText: DISPLAY_NAMES.supportRequestedGame });
  const movedCard = movedCardTitle.locator('xpath=ancestor::article[1]');
  await expect(movedCard).not.toContainText('Not Yet Supported');
  await expect(movedCard.getByRole('button', { name: 'Request Support' })).toHaveCount(0);
});

// ── Mission 7 — Linked Libraries real UX ────────────────────────────────────

test('Mission 7: Linked Libraries page shows honest per-provider capability and real fixture install counts', async () => {
  // REVERSAL NOTICE (Personal Library Completion pass, Phase 2, Mission 19,
  // 2026-09-10): the old binary "Local install detection available" /
  // "Integration not yet available" copy is replaced by a real 3-level
  // Supported/Partial/Unsupported scale (provider-capabilities.ts's
  // CapabilityLevel), and Ubisoft moved from Phase 1's real capability
  // upgrade (localDiscoverySupported: true) into the SUPPORTED group where
  // it always honestly belonged — the old grouping below (Ubisoft grouped
  // with EA/Xbox/Battle.net as "not yet available") predated that Phase 1
  // change and was already stale before this pass touched it. The "Games
  // found"/"Last scan"/"Ownership source" fields are also new (Mission 19).
  await window.getByRole('button', { name: 'Linked Libraries' }).click();
  await window.waitForSelector('text=Loading providers…', { state: 'detached', timeout: 15_000 }).catch(() => {});

  // Scoped to <main> — the new persistent sidebar (SidebarQuickAccess) added
  // this session shows a "My Games" widget with cards like "Fixture Installed
  // Supported" whose status line reads "Installed · Steam", so an unscoped
  // page-wide `text=Steam` locator can resolve to that sidebar card instead
  // of the Linked Libraries page's own Steam capability card (see
  // src/app/components/sidebar/SidebarQuickAccess.tsx). The sidebar renders
  // outside <main id="main-content"> (see App.tsx), so scoping here excludes
  // it entirely and always resolves to the actual provider-capability list.
  const mainContent = window.locator('main');

  for (const provider of ['Steam', 'GOG', 'Epic', 'Ubisoft Connect']) {
    const card = mainContent.locator('text=' + provider).locator('xpath=ancestor::*[self::div][1]');
    await expect(card.first()).toContainText('Installed detection: Supported', { timeout: 15_000 });
  }
  for (const provider of ['EA app', 'Xbox / Microsoft Store', 'Battle.net']) {
    const card = mainContent.locator('text=' + provider).locator('xpath=ancestor::*[self::div][1]');
    await expect(card.first()).toContainText('Installed detection: Partial', { timeout: 15_000 });
    await expect(card.first()).not.toContainText('Connected');
  }

  // No provider anywhere claims ownership detection beyond "Unsupported" —
  // no account API is implemented for any provider today.
  for (const provider of ['Steam', 'GOG', 'Epic', 'Ubisoft Connect', 'EA app', 'Xbox / Microsoft Store', 'Battle.net']) {
    const card = mainContent.locator('text=' + provider).locator('xpath=ancestor::*[self::div][1]');
    await expect(card.first()).toContainText('Ownership detection: Unsupported');
    await expect(card.first()).toContainText('unavailable');
  }

  // Real fixture-derived counts: Steam has 3 installed records
  // (fx-install-a, fx-install-b, fx-install-multi-steam); GOG has 1
  // (fx-install-multi-gog); Epic has 0.
  const steamCard = mainContent.locator('text=Steam').locator('xpath=ancestor::*[self::div][1]').first();
  await expect(steamCard).toContainText('Games found');
  await expect(steamCard).toContainText('3');
  const gogCard = mainContent.locator('text=GOG').locator('xpath=ancestor::*[self::div][1]').first();
  await expect(gogCard).toContainText('Games found');
  await expect(gogCard).toContainText('1');

  // No provider anywhere claims full ownership sync, since none is implemented.
  await expect(window.locator('body')).not.toContainText('Owned count:');
});
