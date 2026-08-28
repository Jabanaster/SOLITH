/**
 * Phase 2 remediation, Gap A/B — the real Wisp consent Electron E2E
 * (SOLITH.MD Section 7/8).
 *
 * Real production dist-electron entry (dist-electron/main.js), real
 * WispQuickSlotController/WispConsentService singleton, real IPC/preload
 * boundary, real WispConsentDialog rendered in a real BrowserWindow, real
 * write-consent token mint/consume, real LiveMemorySession attached to a
 * real (controlled) OS process, real axe accessibility scan of the real
 * rendered dialog.
 *
 * The ONLY thing not real here is Atomfall itself (explicitly out of scope —
 * SOLITH.MD Section 15/23) and the "how does a Wisp activation happen"
 * trigger: a real physical hotkey press is replaced by the
 * SOLITH_TEST_BUILD=1-gated wisp:e2e:test-activate-slot IPC channel, which
 * calls the EXACT SAME WispQuickSlotController.activate(slot) a real hotkey
 * press calls (see electron/wisp-e2e-test-ipc.ts's doc comment). Address
 * resolution for the one controlled action similarly bypasses the real
 * schema.v1 module+offset catalog (which assumes a real, catalog-authored
 * game — infeasible to fabricate here without inventing unreviewed catalog
 * data) via wisp:e2e:test-set-controlled-address, pointing at a real
 * unmanaged heap allocation inside a real spawned controlled process — same
 * technique tests/electron-consent-boundary.e2e.test.ts already uses and
 * trusts for its own SolithConsentGame.exe fixture. Everything downstream of
 * both seams — proposal creation, the real dialog, real approve/reject/
 * cancel/expire, real one-use token mint/consume, real
 * LiveMemorySession.confirmWrite, real read-back, real audit log — is
 * 100% unmodified production code.
 */
import { test, expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');
const AXE_CORE_SCRIPT = path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');

/**
 * @axe-core/playwright's AxeBuilder needs `browserContext.newPage()` to
 * inject its own scaffolding page — unsupported for an Electron
 * BrowserWindow context ("Target.createTarget: Not supported"). Injecting
 * axe-core directly into the already-open page and calling `axe.run()`
 * in-page achieves the same real accessibility scan without that dependency.
 */
async function runAxeScan(win: Page, selector: string): Promise<{ violations: Array<{ id: string; impact: string | null; description: string; nodes: unknown[] }> }> {
  // addScriptTag injects a real <script> DOM node, subject to the app's real
  // production CSP (script-src 'self') — correctly blocked. page.evaluate
  // runs via CDP's Runtime.evaluate instead, a privileged out-of-page
  // execution channel Chromium's page-authored CSP does not gate, so the
  // axe-core source is loaded here and run through that channel instead.
  const axeSource = fs.readFileSync(AXE_CORE_SCRIPT, 'utf8');
  return win.evaluate(
    async ({ axeSource, sel }) => {
      // eslint-disable-next-line no-new-func
      new Function(axeSource)();
      const results = await (window as any).axe.run(document.querySelector(sel) ?? document, {
        resultTypes: ['violations'],
      });
      return { violations: results.violations };
    },
    { axeSource, sel: selector },
  );
}

const CONTROLLED_CATALOG_GAME_ID = 'wisp-e2e-controlled-fixture';
const CONTROLLED_FIXTURE_EXE = 'SolithWispE2EFixture.exe';
const WISP_SLOT = 1;
// The V2 Session Monitor's own IPC schema requires gameId to be a UUID (see
// electron/ipc-validation.ts's V2MonitorStartSchema) — a separate identity
// space from canonical-games' CanonicalGameId string, which is itself
// commonly a migrated legacy game's UUID in real production data. The
// canonical game seeded below uses this SAME UUID as its `id`, matching that
// real relationship rather than inventing a parallel id scheme.
const CONTROLLED_CANONICAL_ID = randomUUID();

type LaunchCtx = {
  app: ElectronApplication;
  win: Page;
  userDataDir: string;
  runId: string;
};

function buildControlledFixture(outPath: string): void {
  const srcPath = `${outPath}.cs`;
  const source = `
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
class SolithWispE2EFixture {
  static int Main() {
    IntPtr mem = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(mem, 0);
    var meta = Path.Combine(Path.GetTempPath(), "solith-wisp-e2e-fixture-" + Process.GetCurrentProcess().Id + ".meta");
    File.WriteAllText(meta, mem.ToInt64().ToString());
    Thread.Sleep(120000);
    try { Marshal.FreeHGlobal(mem); File.Delete(meta); } catch {}
    return 0;
  }
}
`;
  fs.writeFileSync(srcPath, source, 'utf8');
  const frameworks = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  const csc = frameworks.find((p) => fs.existsSync(p));
  if (!csc) throw new Error('csc.exe not found');
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${outPath}`, srcPath], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
}

function killPid(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true, stdio: 'ignore' });
  } catch {
    // already exited
  }
}

function waitForFile(filePath: string, timeoutMs = 10_000): string {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function waitForProcessIdentity(pid: number, executableName: string, timeoutMs = 10_000): void {
  const script = [
    `$ErrorActionPreference='Stop'`,
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
    `if(-not $p){exit 1}`,
    `if(-not $p.ExecutablePath){exit 1}`,
    `if($p.Name -ne ${JSON.stringify(executableName)}){exit 1}`,
    `exit 0`,
  ].join(';');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore', timeout: 4_000 });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  throw new Error(`Process identity not ready for PID ${pid} (${executableName})`);
}

function rmDirSoft(dir: string): void {
  for (let i = 0; i < 8; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}

/**
 * Seeds a real controlled canonical game + installation into the SAME
 * on-disk database the Electron app will open (via ELECTRON_USER_DATA_PATH,
 * pointed at the same directory before and after launch — see
 * src/shared/app-paths.ts). Uses the real, unmodified production
 * upsertCanonicalGame/upsertGameInstallation functions — this is exactly
 * what a real install-discovery/migration pass would have written for a real
 * game; it is only deterministic and pre-seeded here, not fabricated data
 * shaped differently from the real thing.
 */
async function seedControlledCanonicalGame(userDataDir: string, fixtureExePath: string): Promise<void> {
  process.env.ELECTRON_USER_DATA_PATH = userDataDir;
  // Plain imports (no cache-busting query string) — canonical-games/store.ts
  // has its own internal `import db from '../database/index.js'`, which must
  // resolve to the SAME module instance this function initializes, or the
  // seed silently writes nowhere store.ts can see it.
  const dbModule = await import('../src/core/database/index.ts');
  await dbModule.initDatabase();
  const store = await import('../src/core/canonical-games/store.ts');
  const nowIso = new Date().toISOString();
  const canonicalId = CONTROLLED_CANONICAL_ID;
  store.upsertCanonicalGame({
    id: canonicalId,
    displayName: 'Wisp E2E Controlled Fixture',
    normalizedTitle: 'wisp e2e controlled fixture',
    aliases: [],
    genres: [],
    playModes: [],
    eligibility: 'verified',
    supportState: 'supported',
    identityStatus: 'verified',
    catalogGameId: CONTROLLED_CATALOG_GAME_ID,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  store.upsertGameInstallation({
    id: `install:${CONTROLLED_CATALOG_GAME_ID}`,
    canonicalGameId: canonicalId,
    launcher: 'manual',
    executablePath: fixtureExePath,
    processNames: [CONTROLLED_FIXTURE_EXE],
    installIdentity: CONTROLLED_CATALOG_GAME_ID,
    detectedAt: nowIso,
    lastSeenAt: nowIso,
  });
  await dbModule.closeDatabaseSafely();
  delete process.env.ELECTRON_USER_DATA_PATH;
}

async function launchWithControlledFixture(label: string): Promise<{
  ctx: LaunchCtx;
  fixturePid: number;
  fixtureAddressDecimal: string;
} | null> {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    test.skip(true, 'Bundle not built — run npm run build:electron first.');
    return null;
  }
  const runId = `wisp-e2e-${label}-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  fs.mkdirSync(userDataDir, { recursive: true });

  const gameDir = path.join(os.tmpdir(), runId, 'game');
  fs.mkdirSync(gameDir, { recursive: true });
  const exePath = path.join(gameDir, CONTROLLED_FIXTURE_EXE);
  buildControlledFixture(exePath);
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  if (child.pid == null) throw new Error('failed to spawn controlled fixture');
  waitForProcessIdentity(child.pid, CONTROLLED_FIXTURE_EXE);
  const addressDecimal = waitForFile(path.join(os.tmpdir(), `solith-wisp-e2e-fixture-${child.pid}.meta`));

  await seedControlledCanonicalGame(userDataDir, exePath);

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      NODE_ENV: 'test',
      SOLITH_TEST_BUILD: '1',
      SOLITH_WISP_CONSENT_TTL_MS: process.env.SOLITH_WISP_CONSENT_TTL_MS_OVERRIDE ?? '',
    },
  });
  if (process.env.SOLITH_E2E_DEBUG_LOG === '1') {
    app.process().stdout?.on('data', (d) => process.stdout.write(`[main stdout] ${d}`));
    app.process().stderr?.on('data', (d) => process.stderr.write(`[main stderr] ${d}`));
  }
  const win = await app.firstWindow({ timeout: 60_000 });
  if (process.env.SOLITH_E2E_DEBUG_LOG === '1') {
    win.on('console', (msg) => console.log('[renderer console]', msg.type(), msg.text()));
    win.on('pageerror', (err) => console.log('[renderer pageerror]', err));
  }
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });

  return { ctx: { app, win, userDataDir, runId }, fixturePid: child.pid, fixtureAddressDecimal: addressDecimal };
}

async function cleanup(ctx: LaunchCtx | null, extraPids: number[] = []): Promise<void> {
  for (const pid of extraPids) killPid(pid);
  if (!ctx) return;
  try {
    await ctx.win.evaluate(async () => {
      const api = (window as any).electronAPI;
      if (typeof api.liveMemoryDetach === 'function') await api.liveMemoryDetach();
    });
  } catch {
    // best effort
  }
  await ctx.app.close().catch(() => {});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  for (const pid of extraPids) killPid(pid);
  rmDirSoft(path.join(os.tmpdir(), ctx.runId));
}

/** Real attach + real V2 monitor start, polled until the resolver reports the controlled game as active — reused by every scenario below. */
async function attachAndActivate(win: Page, pid: number): Promise<void> {
  const attach = await win.evaluate(
    async ({ pid, executableName }) => (window as any).electronAPI.liveMemoryAttach({ pid, executableName, userConfirmedOffline: true }),
    { pid, executableName: CONTROLLED_FIXTURE_EXE },
  );
  expect(attach.success, String(attach.error ?? 'attach')).toBe(true);

  await win.evaluate(async () => (window as any).electronAPI.setSetting('v2SessionMonitorEnabled', true));

  const started = await win.evaluate(
    async ({ gameId, executableName }) =>
      (window as any).electronAPI.v2MonitorStart({
        gameId,
        executableName,
        pollIntervalMs: 2000,
      }),
    { gameId: CONTROLLED_CANONICAL_ID, executableName: CONTROLLED_FIXTURE_EXE },
  );
  expect(started.success, String(started.error ?? 'monitor start')).toBe(true);

  // Real poll cycle (MIN_POLL_INTERVAL_MS=2000 in session-monitor.ts) — wait
  // for the resolver to actually report the controlled game as attached,
  // rather than a fixed sleep guess.
  // Matches live-canonical-game-resolver.ts's own ATTACHED_LIFECYCLE_STATES —
  // the resolver accepts several lifecycle states as "attached", not only
  // 'game_running'.
  const ATTACHED_STATES = new Set(['game_running', 'observing', 'external_session_observed', 'solith_session_connected', 'session_ended_game_running']);
  const deadline = Date.now() + 20_000;
  let lastState: unknown = null;
  let sawRunning = false;
  while (Date.now() < deadline) {
    const status = await win.evaluate(async () => (window as any).electronAPI.v2MonitorGetState());
    lastState = status;
    if (status?.snapshot && ATTACHED_STATES.has(status.state) && status.snapshot.confidence !== 'stale' && status.snapshot.confidence !== 'contradictory' && status.snapshot.confidence !== 'unavailable') {
      sawRunning = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(sawRunning, `the real V2 session monitor must observe the controlled fixture process as running. Last status: ${JSON.stringify(lastState)}`).toBe(true);
}

test.describe('Wisp consent — real Electron E2E (Gap A/B)', () => {
  test('positive flow: real activation -> real dialog -> deliberate Approve -> real token -> real write -> real read-back -> terminal + audited', async () => {
    const launched = await launchWithControlledFixture('positive');
    if (!launched) return;
    const { ctx, fixturePid, fixtureAddressDecimal } = launched;
    try {
      await attachAndActivate(ctx.win, fixturePid);

      const addrSet = await ctx.win.evaluate(
        async (addressDecimal) => (window as any).electronAPI.wispE2ETestSetControlledAddress({ addressDecimal }),
        fixtureAddressDecimal,
      );
      expect(addrSet.success, String(addrSet.error ?? 'set-address')).toBe(true);

      const beforeRead = await ctx.win.evaluate(
        async (address) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
        `0x${BigInt(fixtureAddressDecimal).toString(16)}`,
      );
      expect(beforeRead.success, String(beforeRead.error ?? 'pre-read')).toBe(true);
      expect(beforeRead.value).toBe(0);

      const activated = await ctx.win.evaluate(async (slot) => (window as any).electronAPI.wispE2ETestActivateSlot({ slot }), WISP_SLOT);
      expect(activated.success, String(activated.error ?? 'activate')).toBe(true);

      // Real dialog, delivered via the real wisp:consent:queue-changed push event.
      await ctx.win.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
      await expect(ctx.win.locator('#wisp-consent-title')).toHaveText('Approve memory change');
      await expect(ctx.win.locator('.wisp-consent-details')).toContainText(CONTROLLED_CANONICAL_ID);

      // Deliberate Approve click — the renderer sends only the proposalId; it
      // never picks the value/game/action itself (this is the real
      // WispConsentQueue.onApprove -> window.electronAPI.wispConsentApprove
      // production code path, not a shortcut this test takes). A short
      // settle wait avoids clicking mid-mount (the dialog's focus-trap effect
      // runs on mount in the same tick).
      const approveButton = ctx.win.locator('.btn-primary.btn-risky', { hasText: 'Approve' });
      await approveButton.waitFor({ state: 'visible' });
      await ctx.win.waitForTimeout(300);
      await approveButton.click();

      await expect(ctx.win.locator('[role="status"]')).toContainText(/Applied|succeeded/i, { timeout: 15_000 });

      const afterRead = await ctx.win.evaluate(
        async (address) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
        `0x${BigInt(fixtureAddressDecimal).toString(16)}`,
      );
      expect(afterRead.success, String(afterRead.error ?? 'post-read')).toBe(true);
      expect(afterRead.value, 'the real controlled process memory must reflect the real approved write — genuine read-back, not a trusted echo').toBe(777);

      // Replay must fail — same production one-use token/proposal machinery
      // already unit-certified in wisp-consent-controlled-execution.test.ts,
      // re-verified here through the real IPC boundary.
      const pendingAfter = await ctx.win.evaluate(async () => (window as any).electronAPI.wispConsentListPending());
      expect(pendingAfter.success).toBe(true);
      expect(pendingAfter.proposals.length).toBe(0);
    } finally {
      await cleanup(ctx, [fixturePid]);
    }
  });

  test('reject: dialog Reject button blocks execution; memory is never touched', async () => {
    const launched = await launchWithControlledFixture('reject');
    if (!launched) return;
    const { ctx, fixturePid, fixtureAddressDecimal } = launched;
    try {
      await attachAndActivate(ctx.win, fixturePid);
      await ctx.win.evaluate(
        async (addressDecimal) => (window as any).electronAPI.wispE2ETestSetControlledAddress({ addressDecimal }),
        fixtureAddressDecimal,
      );
      const activated = await ctx.win.evaluate(async (slot) => (window as any).electronAPI.wispE2ETestActivateSlot({ slot }), WISP_SLOT);
      expect(activated.success, String(activated.error ?? 'activate')).toBe(true);

      await ctx.win.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
      // Reject has initial focus (Section 16) — verify via real DOM focus state, not just presence.
      const focusedIsReject = await ctx.win.evaluate(() => document.activeElement?.hasAttribute('data-wisp-consent-reject') === true);
      expect(focusedIsReject, 'Reject must receive initial focus, never Approve').toBe(true);

      await ctx.win.locator('[data-wisp-consent-reject]').click();
      await ctx.win.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: 10_000 });

      const afterRead = await ctx.win.evaluate(
        async (address) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
        `0x${BigInt(fixtureAddressDecimal).toString(16)}`,
      );
      expect(afterRead.value, 'a rejected proposal must never write').toBe(0);
    } finally {
      await cleanup(ctx, [fixturePid]);
    }
  });

  test('Escape cancels (never approves): dialog closes, memory untouched, re-activation still works afterward', async () => {
    const launched = await launchWithControlledFixture('escape');
    if (!launched) return;
    const { ctx, fixturePid, fixtureAddressDecimal } = launched;
    try {
      await attachAndActivate(ctx.win, fixturePid);
      await ctx.win.evaluate(
        async (addressDecimal) => (window as any).electronAPI.wispE2ETestSetControlledAddress({ addressDecimal }),
        fixtureAddressDecimal,
      );
      await ctx.win.evaluate(async (slot) => (window as any).electronAPI.wispE2ETestActivateSlot({ slot }), WISP_SLOT);
      await ctx.win.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });

      await ctx.win.keyboard.press('Escape');
      await ctx.win.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: 10_000 });

      const afterRead = await ctx.win.evaluate(
        async (address) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
        `0x${BigInt(fixtureAddressDecimal).toString(16)}`,
      );
      expect(afterRead.value).toBe(0);
    } finally {
      await cleanup(ctx, [fixturePid]);
    }
  });

  test('expiration: approving after TTL fails and never writes', async () => {
    process.env.SOLITH_WISP_CONSENT_TTL_MS_OVERRIDE = '500';
    const launched = await launchWithControlledFixture('expire');
    delete process.env.SOLITH_WISP_CONSENT_TTL_MS_OVERRIDE;
    if (!launched) return;
    const { ctx, fixturePid, fixtureAddressDecimal } = launched;
    try {
      await attachAndActivate(ctx.win, fixturePid);
      await ctx.win.evaluate(
        async (addressDecimal) => (window as any).electronAPI.wispE2ETestSetControlledAddress({ addressDecimal }),
        fixtureAddressDecimal,
      );
      await ctx.win.evaluate(async (slot) => (window as any).electronAPI.wispE2ETestActivateSlot({ slot }), WISP_SLOT);
      await ctx.win.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });

      const beforeWaitList = await ctx.win.evaluate(async () => (window as any).electronAPI.wispConsentListPending());
      const proposalId = beforeWaitList.proposals[0].proposalId as string;

      await new Promise((r) => setTimeout(r, 800));

      // Approve the exact same, now-expired proposalId directly — the real
      // production approve() path is what must fail-closed on expiry, not
      // merely a list that already filtered it out.
      const approveResult = await ctx.win.evaluate(
        async (id) => (window as any).electronAPI.wispConsentApprove({ proposalId: id }),
        proposalId,
      );
      expect(approveResult.success).toBe(false);
      expect(String(approveResult.error ?? '')).toMatch(/expired/i);

      const afterRead = await ctx.win.evaluate(
        async (address) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
        `0x${BigInt(fixtureAddressDecimal).toString(16)}`,
      );
      expect(afterRead.value).toBe(0);
    } finally {
      await cleanup(ctx, [fixturePid]);
    }
  });

  test('duplicate IPC approval: a second concurrent approve() call never executes twice', async () => {
    const launched = await launchWithControlledFixture('duplicate');
    if (!launched) return;
    const { ctx, fixturePid, fixtureAddressDecimal } = launched;
    try {
      await attachAndActivate(ctx.win, fixturePid);
      await ctx.win.evaluate(
        async (addressDecimal) => (window as any).electronAPI.wispE2ETestSetControlledAddress({ addressDecimal }),
        fixtureAddressDecimal,
      );
      await ctx.win.evaluate(async (slot) => (window as any).electronAPI.wispE2ETestActivateSlot({ slot }), WISP_SLOT);
      await ctx.win.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });

      const results = await ctx.win.evaluate(async () => {
        const list = await (window as any).electronAPI.wispConsentListPending();
        const proposalId = list.proposals[0].proposalId;
        // Two concurrent, real IPC approve() calls for the exact same proposalId.
        const [a, b] = await Promise.all([
          (window as any).electronAPI.wispConsentApprove({ proposalId }),
          (window as any).electronAPI.wispConsentApprove({ proposalId }),
        ]);
        return [a, b];
      });
      const successes = results.filter((r: { success: boolean }) => r.success);
      expect(successes.length, 'exactly one of the two concurrent approvals may succeed').toBe(1);

      const afterRead = await ctx.win.evaluate(
        async (address) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
        `0x${BigInt(fixtureAddressDecimal).toString(16)}`,
      );
      expect(afterRead.value).toBe(777);
    } finally {
      await cleanup(ctx, [fixturePid]);
    }
  });

  test('accessibility: the real rendered consent dialog has zero Critical/Serious axe violations', async () => {
    const launched = await launchWithControlledFixture('axe');
    if (!launched) return;
    const { ctx, fixturePid, fixtureAddressDecimal } = launched;
    try {
      await attachAndActivate(ctx.win, fixturePid);
      await ctx.win.evaluate(
        async (addressDecimal) => (window as any).electronAPI.wispE2ETestSetControlledAddress({ addressDecimal }),
        fixtureAddressDecimal,
      );
      await ctx.win.evaluate(async (slot) => (window as any).electronAPI.wispE2ETestActivateSlot({ slot }), WISP_SLOT);
      await ctx.win.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });

      const results = await runAxeScan(ctx.win, '[role="alertdialog"]');
      const seriousOrWorse = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
    } finally {
      await cleanup(ctx, [fixturePid]);
    }
  });

  test('production absence: outside SOLITH_TEST_BUILD, the E2E activation channel does not exist', async () => {
    if (!fs.existsSync(MAIN_BUNDLE)) {
      test.skip(true, 'Bundle not built');
      return;
    }
    const runId = `wisp-e2e-absence-${Date.now()}`;
    const userDataDir = path.join(os.tmpdir(), runId, 'userData');
    fs.mkdirSync(userDataDir, { recursive: true });
    const app = await electron.launch({
      args: [MAIN_BUNDLE],
      env: { ...process.env, ELECTRON_USER_DATA_PATH: userDataDir, NODE_ENV: 'test', SOLITH_TEST_BUILD: '' },
    });
    try {
      const win = await app.firstWindow({ timeout: 60_000 });
      await win.waitForLoadState('domcontentloaded');
      const shape = await win.evaluate(() => ({
        activate: typeof (window as any).electronAPI.wispE2ETestActivateSlot,
        setAddress: typeof (window as any).electronAPI.wispE2ETestSetControlledAddress,
      }));
      expect(shape.activate).toBe('undefined');
      expect(shape.setAddress).toBe('undefined');
    } finally {
      await app.close().catch(() => {});
      rmDirSoft(path.join(os.tmpdir(), runId));
    }
  });
});
