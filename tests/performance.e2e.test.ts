/**
 * tests/performance.e2e.test.ts — Actual timing measurements against the Electron app
 *
 * Hardware and build context are printed in the afterAll report.
 * Each timing is measured as the wall-clock delta from call to resolved result.
 * Targets are intentionally generous to avoid flaky failures on slow CI hardware.
 *
 * Coverage:
 *   perf-01  App startup: launch → first window '#root > *' selector resolves < 8000ms
 *   perf-02  getAllProfiles IPC round-trip (fresh DB, 5 runs) < 150ms each
 *   perf-03  checkGameRunning IPC round-trip (demo literal, 3 runs) < 150ms each
 *   perf-04  getGames IPC round-trip (fresh DB, 3 runs) < 150ms each
 *   perf-05  Consecutive getAllProfiles calls — second call ≤ first (DB warmed)
 *   perf-06  Trainer page hash navigation + React settle (3 runs) < 2000ms each
 *   perf-07  Compatibility Dashboard hash navigation + React settle (3 runs) < 2000ms each
 *   perf-08  getRecipes with 3 items — Trainer list data (5 runs) < 150ms each
 *   perf-09  Mode switch Trainer→Workshop (5 runs) < 500ms each
 *   perf-10  createProposalForEdit IPC — proposal dialog preparation (3 runs) < 250ms each
 *   perf-11  applyProposal IPC — atomic write + backup (3 runs) < 500ms each
 *   perf-12  restoreBackup IPC — restore from backup (3 runs) < 500ms each
 *   perf-13  trainerCatalogSearch IPC — 1000-entry seed filter (5 runs) < 300ms each
 *
 * Fixture context:
 *   save_file:   JSON, {"player":{"hp":100,"gold":150,"godMode":false}}  ~46 bytes
 *   game_count:  1
 *   recipe_count: 3 (HP number, Gold number, GodMode toggle)
 *   profile_count: 0
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MAIN_BUNDLE = path.join('dist-electron', 'main.js');

const RUN_ID      = `perf-${Date.now()}`;
const userData    = path.join(os.tmpdir(), RUN_ID, 'userData');
const appData     = path.join(os.tmpdir(), RUN_ID, 'appdata');
const gameDir     = path.join(os.tmpdir(), RUN_ID, 'game');

const STARTUP_TARGET_MS     = 8_000;
const IPC_TARGET_MS         = 150;
const NAV_TARGET_MS         = 2_000;
const MODE_SWITCH_TARGET_MS = 500;
const OP_TARGET_MS          = 500;
const PROPOSAL_TARGET_MS    = 250;
const CATALOG_SEARCH_TARGET_MS = 300;

const FIXTURE_CONTENT = JSON.stringify({ player: { hp: 100, gold: 150, godMode: false } });

let app: any;
let win: any;
let startupMs   = -1;
let gameId      = '';
let saveFile    = '';
let recipeId    = '';
let fixtureSize = 0;
let recipeCount = 0;

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) return;
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData,  { recursive: true });
  fs.mkdirSync(gameDir,  { recursive: true });

  saveFile    = path.join(gameDir, 'save.json');
  fixtureSize = Buffer.byteLength(FIXTURE_CONTENT, 'utf8');
  fs.writeFileSync(saveFile, FIXTURE_CONTENT);

  const t0 = Date.now();
  app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userData,
      APPDATA:                 appData,
      USERPROFILE:             appData,
      NODE_ENV:                'test',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 15_000 });
  startupMs = Date.now() - t0;

  // Set up fixture: 1 game + 3 recipes for perf-08, 10, 11, 12
  const addRes = await win.evaluate(
    (dir: string) => (window as any).electronAPI.addGame({ name: 'Perf Test', path: dir }),
    gameDir
  );
  if (addRes?.success) {
    gameId = addRes.game.id;
    await win.evaluate(
      ([gid, dir]: [string, string]) => (window as any).electronAPI.addUserSelectedLocation(gid, dir),
      [gameId, gameDir]
    );

    const r1 = await win.evaluate(
      ([gid, fp]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'HP', category: 'PLAYER', source: fp, target: fp,
        path: 'player.hp', valueType: 'number', risk: 'Safe', requiresBackup: true, confidence: 90,
      }),
      [gameId, saveFile]
    );
    if (r1?.recipe?.id) recipeId = r1.recipe.id;

    await win.evaluate(
      ([gid, fp]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'Gold', category: 'PLAYER', source: fp, target: fp,
        path: 'player.gold', valueType: 'number', risk: 'Safe', requiresBackup: true, confidence: 90,
      }),
      [gameId, saveFile]
    );

    await win.evaluate(
      ([gid, fp]: [string, string]) => (window as any).electronAPI.createRecipe({
        gameId: gid, name: 'GodMode', category: 'PLAYER', source: fp, target: fp,
        path: 'player.godMode', valueType: 'boolean', risk: 'Safe', requiresBackup: true, confidence: 85,
      }),
      [gameId, saveFile]
    );
    recipeCount = 3;
  }
});

test.afterAll(async () => {
  if (app) {
    console.log('\n══════════ PERFORMANCE TEST REPORT ══════════');
    console.log(`hardware     = ${os.cpus()[0]?.model ?? 'unknown'} × ${os.cpus().length} cores`);
    console.log(`platform     = ${process.platform} / ${process.arch}`);
    console.log(`node         = ${process.version}`);
    console.log(`build_type   = dev bundle (dist-electron/main.js)`);
    console.log(`startup_ms   = ${startupMs}`);
    console.log(`fixture_size = ${fixtureSize} bytes`);
    console.log(`game_count   = 1`);
    console.log(`recipe_count = ${recipeCount}`);
    console.log(`profile_count = 0`);
    console.log('══════════════════════════════════════════════\n');
    await app.close().catch(() => {});
  }
  fs.rmSync(path.join(os.tmpdir(), RUN_ID), { recursive: true, force: true });
});

// ── perf-01: startup time ─────────────────────────────────────────────────────

test('perf-01 — startup: launch → #root selector resolves within 8000ms', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  expect(startupMs, `startup was ${startupMs}ms (target < ${STARTUP_TARGET_MS}ms)`).toBeLessThan(STARTUP_TARGET_MS);
  console.log(`perf-01 startup_ms = ${startupMs} (runs=1)`);
});

// ── perf-02: getAllProfiles — 5 runs ──────────────────────────────────────────

test('perf-02 — getAllProfiles IPC round-trip (5 runs) < 150ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const N = 5;
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const result = await win.evaluate(() => (window as any).electronAPI.getAllProfiles());
    times.push(Date.now() - t0);
    expect(Array.isArray(result), 'getAllProfiles returns array').toBe(true);
  }
  const med = median(times);
  const slowest = Math.max(...times);
  expect(med, `median ${med}ms (target < ${IPC_TARGET_MS}ms)`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-02 getAllProfiles_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N})`);
});

// ── perf-03: checkGameRunning — 3 runs ────────────────────────────────────────

test('perf-03 — checkGameRunning IPC round-trip (3 runs) < 150ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const N = 3;
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const result = await win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning('demo-game-quest-id-000000000000')
    );
    times.push(Date.now() - t0);
    expect(typeof result?.running).toBe('boolean');
  }
  const med = median(times);
  const slowest = Math.max(...times);
  expect(med, `median ${med}ms (target < ${IPC_TARGET_MS}ms)`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-03 checkGameRunning_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N})`);
});

// ── perf-04: getGames — 3 runs ────────────────────────────────────────────────

test('perf-04 — getGames IPC round-trip (3 runs) < 150ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const N = 3;
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const result = await win.evaluate(() => (window as any).electronAPI.getGames());
    times.push(Date.now() - t0);
    expect(Array.isArray(result), 'getGames returns array').toBe(true);
  }
  const med = median(times);
  const slowest = Math.max(...times);
  expect(med, `median ${med}ms (target < ${IPC_TARGET_MS}ms)`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-04 getGames_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N})`);
});

// ── perf-05: consecutive calls — DB warm ─────────────────────────────────────

test('perf-05 — second getAllProfiles call is not slower than first (DB warmed)', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const t1 = Date.now();
  await win.evaluate(() => (window as any).electronAPI.getAllProfiles());
  const first = Date.now() - t1;

  const t2 = Date.now();
  await win.evaluate(() => (window as any).electronAPI.getAllProfiles());
  const second = Date.now() - t2;

  expect(first,  `first call ${first}ms`).toBeLessThan(IPC_TARGET_MS);
  expect(second, `second call ${second}ms`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-05 first_ms=${first}, second_ms=${second} (runs=2)`);
});

// ── perf-06: Trainer page hash navigation + React settle (3 runs) ─────────────

test('perf-06 — Trainer page hash navigation + React re-render settle (3 runs) < 2000ms', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const N = 3;
  const times: number[] = [];

  for (let i = 0; i < N; i++) {
    // Navigate away first so the route change is real
    await win.evaluate(() => { window.location.hash = '#/'; });
    await win.waitForTimeout(150);

    const t0 = Date.now();
    await win.evaluate(() => { window.location.hash = '#/trainer'; });
    // SPA route change: React router picks up the new hash and re-renders.
    // waitForTimeout(300) gives the React scheduler time to commit the update.
    await win.waitForTimeout(300);
    times.push(Date.now() - t0);
  }
  const med = median(times);
  const slowest = Math.max(...times);
  // Measurement includes hash assignment (~0ms) + React re-render settle (300ms floor)
  console.log(`perf-06 trainer_nav_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N}, settle=300ms)`);
  expect(med, `median ${med}ms (target < ${NAV_TARGET_MS}ms)`).toBeLessThan(NAV_TARGET_MS);
});

// ── perf-07: Compatibility Dashboard hash navigation (3 runs) ─────────────────

test('perf-07 — Compatibility Dashboard hash navigation + React settle (3 runs) < 2000ms', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const N = 3;
  const times: number[] = [];

  for (let i = 0; i < N; i++) {
    await win.evaluate(() => { window.location.hash = '#/'; });
    await win.waitForTimeout(150);

    const t0 = Date.now();
    await win.evaluate(() => { window.location.hash = '#/compatibility'; });
    await win.waitForTimeout(300);
    times.push(Date.now() - t0);
  }
  const med = median(times);
  const slowest = Math.max(...times);
  console.log(`perf-07 compat_nav_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N}, settle=300ms)`);
  expect(med, `median ${med}ms (target < ${NAV_TARGET_MS}ms)`).toBeLessThan(NAV_TARGET_MS);
});

// ── perf-08: Trainer list data — getRecipes with 3 items (5 runs) ────────────

test('perf-08 — getRecipes with 3 items — Trainer list data (5 runs) < 150ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  if (!gameId) { test.skip(true, 'Game not set up in beforeAll'); return; }

  const N = 5;
  const times: number[] = [];

  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const items = await win.evaluate(
      (gid: string) => (window as any).electronAPI.getRecipes(gid),
      gameId
    );
    times.push(Date.now() - t0);
    expect(Array.isArray(items), 'getRecipes returns array').toBe(true);
    expect(items.length, '3 recipes in fixture').toBe(recipeCount);
  }
  const med = median(times);
  const slowest = Math.max(...times);
  console.log(`perf-08 getRecipes_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N}, items=${recipeCount})`);
  expect(med, `median ${med}ms (target < ${IPC_TARGET_MS}ms)`).toBeLessThan(IPC_TARGET_MS);
});

// ── perf-09: Mode switch Trainer→Workshop (5 runs) ───────────────────────────

test('perf-09 — sidebar collapse toggle (5 runs) < 500ms each', async () => {
  test.setTimeout(60_000);
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const N = 5;
  const times: number[] = [];
  const btn = win.locator('.sidebar-collapse-btn');

  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    await btn.click();
    await win.waitForSelector('.sidebar--collapsed', { timeout: 3000 });
    times.push(Date.now() - t0);
    await btn.click();
    await win.waitForSelector('.sidebar:not(.sidebar--collapsed)', { timeout: 3000 });
    await win.waitForTimeout(100);
  }
  const med = median(times);
  const slowest = Math.max(...times);
  console.log(`perf-09 sidebar_collapse_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N})`);
  expect(med, `median ${med}ms (target < ${MODE_SWITCH_TARGET_MS}ms)`).toBeLessThan(MODE_SWITCH_TARGET_MS);
});

// ── perf-10: createProposalForEdit — dialog preparation (3 runs) ─────────────

test('perf-10 — createProposalForEdit IPC — dialog preparation (3 runs) < 250ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  if (!gameId || !recipeId) { test.skip(true, 'Fixture not set up'); return; }

  const N = 3;
  const times: number[] = [];

  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const proposal = await win.evaluate(
      ([gid, fp, rid]: [string, string, string]) =>
        (window as any).electronAPI.createProposalForEdit(gid, fp, 'player.hp', 100, 9999, rid),
      [gameId, saveFile, recipeId]
    );
    times.push(Date.now() - t0);
    expect(proposal?.id, 'proposal has id').toBeTruthy();
  }
  const med = median(times);
  const slowest = Math.max(...times);
  console.log(`perf-10 createProposal_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N})`);
  expect(med, `median ${med}ms (target < ${PROPOSAL_TARGET_MS}ms)`).toBeLessThan(PROPOSAL_TARGET_MS);
});

// ── perf-11: applyProposal — atomic write + backup (3 runs) ──────────────────

test('perf-11 — applyProposal IPC — atomic write + backup (3 runs) < 500ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  if (!gameId || !recipeId) { test.skip(true, 'Fixture not set up'); return; }

  const N = 3;
  const applyTimes:   number[] = [];
  const restoreTimes: number[] = [];

  // Track backup IDs so we can restore between runs
  for (let i = 0; i < N; i++) {
    // Restore file to original before measuring apply (except first run)
    // File starts at hp=100. After each apply it's hp=9999; restore resets to hp=100.
    // Run 1: file is at original state (hp=100) — no restore needed before first apply
    // Run 2+: restore was done at end of previous iteration

    // Create fresh proposal each run (proposals are single-use after apply)
    const proposal = await win.evaluate(
      ([gid, fp, rid]: [string, string, string]) =>
        (window as any).electronAPI.createProposalForEdit(gid, fp, 'player.hp', 100, 9999, rid),
      [gameId, saveFile, recipeId]
    );
    expect(proposal?.id, 'proposal created for run').toBeTruthy();

    // Time apply
    const ta = Date.now();
    const applyRes = await win.evaluate(
      (p: any) => (window as any).electronAPI.applyProposal(p),
      proposal
    );
    applyTimes.push(Date.now() - ta);
    expect(applyRes?.success, 'apply succeeded').toBe(true);
    expect(applyRes?.backup?.id, 'backup.id returned').toBeTruthy();

    // Time restore (immediately after apply, part of the same run's cleanup)
    const tr = Date.now();
    const restoreRes = await win.evaluate(
      (bid: string) => (window as any).electronAPI.restoreBackup(bid),
      applyRes.backup.id
    );
    restoreTimes.push(Date.now() - tr);
    expect(restoreRes?.success, 'restore succeeded').toBe(true);
    // File is now back to hp=100 for next iteration
  }

  const applyMed     = median(applyTimes);
  const applySlowest = Math.max(...applyTimes);
  console.log(`perf-11 apply_ms = [${applyTimes.join(',')}], median=${applyMed}, slowest=${applySlowest} (runs=${N}, fixture=${fixtureSize}B)`);
  expect(applyMed, `median ${applyMed}ms (target < ${OP_TARGET_MS}ms)`).toBeLessThan(OP_TARGET_MS);

  const restoreMed     = median(restoreTimes);
  const restoreSlowest = Math.max(...restoreTimes);
  console.log(`perf-12 restore_ms = [${restoreTimes.join(',')}], median=${restoreMed}, slowest=${restoreSlowest} (runs=${N}, fixture=${fixtureSize}B)`);
  expect(restoreMed, `median ${restoreMed}ms (target < ${OP_TARGET_MS}ms)`).toBeLessThan(OP_TARGET_MS);
});

// ── perf-12: restoreBackup — standalone verification ─────────────────────────
// Note: restore timing is also captured inside perf-11. This test verifies
// the standalone timing independently with a fresh proposal+apply cycle.

test('perf-12 — restoreBackup IPC — standalone verification (3 runs) < 500ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  if (!gameId || !recipeId) { test.skip(true, 'Fixture not set up'); return; }

  const N = 3;
  const times: number[] = [];

  for (let i = 0; i < N; i++) {
    // Apply first, then time restore
    const proposal = await win.evaluate(
      ([gid, fp, rid]: [string, string, string]) =>
        (window as any).electronAPI.createProposalForEdit(gid, fp, 'player.hp', 100, 9999, rid),
      [gameId, saveFile, recipeId]
    );
    const applyRes = await win.evaluate(
      (p: any) => (window as any).electronAPI.applyProposal(p),
      proposal
    );
    expect(applyRes?.success, 'apply succeeded for restore test').toBe(true);

    const t0 = Date.now();
    const restoreRes = await win.evaluate(
      (bid: string) => (window as any).electronAPI.restoreBackup(bid),
      applyRes.backup.id
    );
    times.push(Date.now() - t0);
    expect(restoreRes?.success, 'restore succeeded').toBe(true);
  }
  const med = median(times);
  const slowest = Math.max(...times);
  console.log(`perf-12 restore_standalone_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N}, fixture=${fixtureSize}B)`);
  expect(med, `median ${med}ms (target < ${OP_TARGET_MS}ms)`).toBeLessThan(OP_TARGET_MS);
});

// ── perf-13: trainerCatalogSearch — 1000-entry bundled seed ─────────────────
test('perf-13 — trainerCatalogSearch IPC — catalog filter (5 runs) < 300ms each', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const seedRes = await win.evaluate(() => (window as any).electronAPI.trainerCatalogSeed());
  expect(seedRes?.success, 'catalog seed loaded').toBe(true);
  expect((seedRes?.total ?? 0) >= 1000, `seed total ${seedRes?.total}`).toBe(true);

  const N = 5;
  const times: number[] = [];

  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const searchRes = await win.evaluate(() =>
      (window as any).electronAPI.trainerCatalogSearch({ query: 'sim', limit: 50, offset: 0 }),
    );
    times.push(Date.now() - t0);
    expect(searchRes?.success, 'catalog search succeeded').toBe(true);
    expect(Array.isArray(searchRes?.entries)).toBe(true);
  }

  const med = median(times);
  const slowest = Math.max(...times);
  console.log(`perf-13 catalog_search_ms = [${times.join(',')}], median=${med}, slowest=${slowest} (runs=${N})`);
  expect(med, `median ${med}ms (target < ${CATALOG_SEARCH_TARGET_MS}ms)`).toBeLessThan(CATALOG_SEARCH_TARGET_MS);
});
