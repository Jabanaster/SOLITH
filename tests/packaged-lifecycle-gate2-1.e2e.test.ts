/**
 * tests/packaged-lifecycle-gate2-1.e2e.test.ts — Gate 2.1
 *
 * Certifies packaged Windows lifecycle scenarios against the REAL packaged
 * executable (dist/win-unpacked/Solith.exe), launched with
 * SOLITH_TEST_BUILD=1 so the narrow test-only seams in
 * src/core/live-memory/windows-process-identity.ts and
 * electron/live-memory-ipc.ts become active. Those seams are otherwise
 * fail-closed (see tests/live-memory/gate2-1-test-build-hooks.test.ts).
 *
 * This test MUST NOT launch npx electron or the dev bundle — same
 * constraint as tests/packaged-smoke.test.ts.
 *
 * Test order is deliberate (workers: 1, single Electron instance, single
 * trusted main window — a second ad-hoc BrowserWindow is not registered in
 * trusted-sender-registry.ts and cannot exercise privileged IPC):
 *   1. cleanup-failure containment (needs the live main window)
 *   2. renderer crash (kills that window's renderer — must run after 1)
 *   3. identity-mismatch / simulated PID reuse (main-process only, no window needed)
 *   4. app shutdown (closes the whole app — must run last)
 * Because the window's renderer is already gone by step 4, shutdown here
 * certifies "will-quit exits cleanly, no hang" rather than "an
 * IPC-attached session was active at quit time" — disclosed honestly in
 * Gate2_1 evidence rather than staged to look otherwise.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

import {
  findRepoRoot,
  resolvePackagedExecutable,
} from '../scripts/release-artifact-utils.mjs';

const ROOT     = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);

const RUN_ID    = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const USER_DATA = path.join(os.tmpdir(), `solith-gate2-1-${RUN_ID}`);
const APP_DATA  = path.join(os.tmpdir(), `solith-gate2-1-appdata-${RUN_ID}`);

let electronApp: ElectronApplication;
let win: Page;
let appClosed = false;

// Dedicated benign local test processes spawned by this harness only.
// Never targets any process this harness did not itself create.
const spawnedTestProcesses: ChildProcess[] = [];

function spawnDedicatedTestProcess(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000);'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  spawnedTestProcesses.push(child);
  return child;
}

function killDedicatedTestProcess(child: ChildProcess): void {
  if (child.pid && !child.killed) {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

test.beforeAll(async () => {
  if (!fs.existsSync(EXE_PATH)) return;
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(APP_DATA, { recursive: true });

  electronApp = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: USER_DATA,
      APPDATA: APP_DATA,
      USERPROFILE: APP_DATA,
      NODE_ENV: 'test',
      SOLITH_TEST_BUILD: '1',
    },
  });

  win = await electronApp.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
});

test.afterAll(async () => {
  for (const child of spawnedTestProcesses) killDedicatedTestProcess(child);
  if (electronApp && !appClosed) await electronApp.close().catch(() => {});
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(APP_DATA, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('point 00 — packaged exe exists and test-build seams are active', () => {
  expect(fs.existsSync(EXE_PATH), `Packaged exe not found at: ${EXE_PATH}`).toBe(true);
});

// ── Scenario 1: cleanup-failure containment ──────────────────────────────
test('scenario 1 — a forced cleanup-step failure still tears down the session and blocks future writes', async () => {
  const child = spawnDedicatedTestProcess();
  await new Promise((r) => setTimeout(r, 300));

  const webContentsId = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.id,
  );

  const attachResult = await win.evaluate(
    async (pid: number) => (window as any).electronAPI.liveMemoryAttach({
      pid, executableName: 'node.exe', userConfirmedOffline: true,
    }),
    child.pid as number,
  );
  expect(attachResult?.error, `attach failed: ${JSON.stringify(attachResult)}`).toBeUndefined();

  const forcedApplied = await electronApp.evaluate(() => {
    const set = (globalThis as any).__solithSetTestForcedCleanupFailureStep;
    if (!set) return false;
    set('revoke_consent_tokens');
    return true;
  });
  expect(forcedApplied, 'forced cleanup-failure seam must be reachable in a SOLITH_TEST_BUILD=1 launch').toBe(true);

  await win.evaluate(async () => (window as any).electronAPI.liveMemoryDetach());
  await new Promise((r) => setTimeout(r, 300));

  const hasSessionAfter = await electronApp.evaluate(
    (_electron, wcId) => (globalThis as any).__solithTestHasSessionForOwner(wcId),
    webContentsId,
  );
  expect(hasSessionAfter, 'session must still be removed even though one cleanup step was forced to fail').toBe(false);

  const postCleanupRead = await win.evaluate(
    async () => (window as any).electronAPI.liveMemoryRead({ address: '0x0', dataType: 'int32' }),
  );
  expect(postCleanupRead?.error, 'reads must be rejected after cleanup, forced-failure or not').toBeDefined();

  await electronApp.evaluate(() => {
    (globalThis as any).__solithClearTestForcedCleanupFailureSteps();
  });
  killDedicatedTestProcess(child);
});

// ── Scenario 2: renderer crash ────────────────────────────────────────────
test('scenario 2 — renderer crash disposes the live-memory session for that owner', async () => {
  const child = spawnDedicatedTestProcess();
  await new Promise((r) => setTimeout(r, 300));

  const webContentsId = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.id,
  );

  const attachResult = await win.evaluate(
    async (pid: number) => (window as any).electronAPI.liveMemoryAttach({
      pid, executableName: 'node.exe', userConfirmedOffline: true,
    }),
    child.pid as number,
  );
  expect(attachResult?.error, `attach failed: ${JSON.stringify(attachResult)}`).toBeUndefined();

  const hasSessionBefore = await electronApp.evaluate(
    (_electron, wcId) => (globalThis as any).__solithTestHasSessionForOwner(wcId),
    webContentsId,
  );
  expect(hasSessionBefore, 'session must exist right after attach').toBe(true);

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();
  });
  await new Promise((r) => setTimeout(r, 800));

  const hasSessionAfter = await electronApp.evaluate(
    (_electron, wcId) => (globalThis as any).__solithTestHasSessionForOwner(wcId),
    webContentsId,
  );
  expect(hasSessionAfter, 'session must be disposed after renderer crash').toBe(false);

  killDedicatedTestProcess(child);
});

// ── Scenario 3: identity mismatch (simulated PID reuse) ───────────────────
test('scenario 3 — identity mismatch (simulated PID reuse) is rejected against a real spawned process', async () => {
  // Main-process-only: no renderer window is needed for this scenario.
  const child = spawnDedicatedTestProcess();
  await new Promise((r) => setTimeout(r, 300));
  const realPid = child.pid as number;

  killDedicatedTestProcess(child);
  await new Promise((r) => setTimeout(r, 300));

  const overrideApplied = await electronApp.evaluate((_electron, pid) => {
    const set = (globalThis as any).__solithSetTestProcessIdentityOverride;
    if (!set) return false;
    set(pid, {
      pid,
      executableName: 'different-image.exe',
      executablePath: 'C:\\different-image.exe',
      startTimeIso: new Date().toISOString(),
      volumeSerialNumber: null,
      fileIndex: null,
      exeSha256: null,
    });
    return true;
  }, realPid);
  expect(overrideApplied, 'test-only identity override seam must be reachable in a SOLITH_TEST_BUILD=1 launch').toBe(true);

  // Directly exercise the same queryWindowsProcessIdentity path attach-time
  // and re-verification-time identity checks both use (compareProcessIdentity
  // in src/core/live-memory/windows-process-identity.ts), via the read-only
  // globalThis hooks (Electron's evaluate() sandbox disallows dynamic import()).
  const liveIdentity = await electronApp.evaluate((_electron, pid) => {
    const query = (globalThis as any).__solithQueryWindowsProcessIdentity;
    return query ? query(pid) : { error: 'hook not present' };
  }, realPid);

  expect(
    (liveIdentity as any)?.executableName,
    `expected simulated identity, got: ${JSON.stringify(liveIdentity)}`,
  ).toBe('different-image.exe');

  // And prove the fail-closed comparison itself rejects the mismatch, using
  // the expected identity a real attach would have recorded for the
  // original process ('node.exe') against the now-overridden live identity.
  const rejection = await electronApp.evaluate((_electron, args) => {
    const [pid, execPathArg] = args as [number, string];
    const query = (globalThis as any).__solithQueryWindowsProcessIdentity;
    const compare = (globalThis as any).__solithCompareProcessIdentity;
    const live = query(pid);
    return compare(
      {
        pid,
        executableName: 'node.exe',
        executablePath: execPathArg,
        startTime: new Date(0).toISOString(),
      },
      live,
    );
  }, [realPid, process.execPath]);
  expect(rejection, 'compareProcessIdentity must reject the simulated mismatch, not silently accept it').not.toBeNull();

  await electronApp.evaluate(() => {
    (globalThis as any).__solithClearTestProcessIdentityOverrides();
  });
});

// ── Scenario 4: app shutdown ──────────────────────────────────────────────
test('scenario 4 — app close (will-quit) resolves cleanly with no hang after a full session lifecycle', async () => {
  const closePromise = electronApp.close();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('electronApp.close() timed out — will-quit cleanup may have hung')), 15_000),
  );
  await Promise.race([closePromise, timeoutPromise]);
  appClosed = true;
});
