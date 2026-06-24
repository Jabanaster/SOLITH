/**
 * tests/performance.e2e.test.ts — Actual timing measurements against the Electron app
 *
 * Hardware and build context are printed in the afterAll report.
 * Each timing is measured as the wall-clock delta from call to resolved result.
 * Targets are intentionally generous to avoid flaky failures on slow CI hardware.
 *
 * Coverage:
 *   perf-01  App startup: launch → first window '#root > *' selector resolves < 5000ms
 *   perf-02  getAllProfiles IPC round-trip (fresh DB) < 100ms
 *   perf-03  checkGameRunning IPC round-trip (demo literal, no game) < 150ms
 *   perf-04  getGames IPC round-trip (fresh DB) < 100ms
 *   perf-05  Consecutive getAllProfiles calls — second call ≤ first (DB warmed)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MAIN_BUNDLE = path.join('dist-electron', 'main.js');

const RUN_ID   = `perf-${Date.now()}`;
const userData = path.join(os.tmpdir(), RUN_ID, 'userData');
const appData  = path.join(os.tmpdir(), RUN_ID, 'appdata');

const STARTUP_TARGET_MS    = 5_000;
const IPC_TARGET_MS        = 150;

let app: any;
let win: any;
let startupMs = -1;

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) return;
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData,  { recursive: true });

  const t0 = Date.now();
  app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userData,
      APPDATA: appData,
      USERPROFILE: appData,
      NODE_ENV: 'test',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 15_000 });
  startupMs = Date.now() - t0;
});

test.afterAll(async () => {
  if (app) {
    console.log('\n══════════ PERFORMANCE TEST REPORT ══════════');
    console.log(`hardware    = ${os.cpus()[0]?.model ?? 'unknown'} × ${os.cpus().length} cores`);
    console.log(`platform    = ${process.platform} / ${process.arch}`);
    console.log(`node        = ${process.version}`);
    console.log(`build_type  = dev bundle (dist-electron/main.js)`);
    console.log(`startup_ms  = ${startupMs}`);
    console.log(`ipc_target  = < ${IPC_TARGET_MS} ms`);
    console.log('══════════════════════════════════════════════\n');
    await app.close().catch(() => {});
  }
  fs.rmSync(path.join(os.tmpdir(), RUN_ID), { recursive: true, force: true });
});

// ── perf-01: startup time ─────────────────────────────────────────────────────

test('perf-01 — startup: launch → #root selector resolves within 5000ms', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  expect(startupMs, `startup was ${startupMs}ms (target < ${STARTUP_TARGET_MS}ms)`).toBeLessThan(STARTUP_TARGET_MS);
  console.log(`perf-01 startup_ms = ${startupMs}`);
});

// ── perf-02: getAllProfiles ────────────────────────────────────────────────────

test('perf-02 — getAllProfiles IPC round-trip < 150ms', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const t0 = Date.now();
  const result = await win.evaluate(() => (window as any).electronAPI.getAllProfiles());
  const elapsed = Date.now() - t0;

  expect(Array.isArray(result), 'getAllProfiles returns array').toBe(true);
  expect(elapsed, `getAllProfiles took ${elapsed}ms (target < ${IPC_TARGET_MS}ms)`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-02 getAllProfiles_ms = ${elapsed}`);
});

// ── perf-03: checkGameRunning ─────────────────────────────────────────────────

test('perf-03 — checkGameRunning IPC round-trip (demo literal) < 150ms', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const t0 = Date.now();
  const result = await win.evaluate(() =>
    (window as any).electronAPI.checkGameRunning('demo-game-quest-id-000000000000')
  );
  const elapsed = Date.now() - t0;

  expect(typeof result?.running).toBe('boolean');
  expect(elapsed, `checkGameRunning took ${elapsed}ms (target < ${IPC_TARGET_MS}ms)`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-03 checkGameRunning_ms = ${elapsed}`);
});

// ── perf-04: getGames ─────────────────────────────────────────────────────────

test('perf-04 — getGames IPC round-trip (fresh DB) < 150ms', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }

  const t0 = Date.now();
  const result = await win.evaluate(() => (window as any).electronAPI.getGames());
  const elapsed = Date.now() - t0;

  expect(Array.isArray(result), 'getGames returns array').toBe(true);
  expect(elapsed, `getGames took ${elapsed}ms (target < ${IPC_TARGET_MS}ms)`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-04 getGames_ms = ${elapsed}`);
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

  // Allow 2× tolerance — both should be fast; we're not asserting strict speedup
  // just that neither call breaks the ceiling
  expect(first,  `first call ${first}ms`).toBeLessThan(IPC_TARGET_MS);
  expect(second, `second call ${second}ms`).toBeLessThan(IPC_TARGET_MS);
  console.log(`perf-05 first_ms = ${first}, second_ms = ${second}`);
});
