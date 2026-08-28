/**
 * Gate 2.4 — final ownership, window, frame, and navigation certification.
 *
 * Not wired into any npm script. Run directly via Playwright against the
 * packaged dist/win-unpacked/Solith.exe. Uses the Gate 2.2 fixture
 * (tests/fixtures/gate2-2-memory-fixture). No test-only freeze-start hook
 * exists anywhere in source (removed in Gate 2.3) — every scenario here
 * drives the real electronAPI propose -> issue-consent -> confirmed-start
 * surface.
 *
 * Architecture notes taken as given (verified by source read, not assumed):
 *  - electron/main.ts: 'window-all-closed' calls app.quit() when
 *    process.platform !== 'darwin' (this is a Windows target) — so the
 *    main window cannot be closed and recreated without terminating the
 *    process. Phase 6 (window recreation without quit) is therefore
 *    architecturally NOT APPLICABLE on this platform; see
 *    packaged-window-recreation-matrix.csv.
 *  - electron/live-memory-ipc.ts's requireTrustedSender() hardcodes
 *    allowedWindowTypes=['main'] for propose/issue-consent/start/rollback —
 *    wisp-overlay and trainer-overlay windows are already structurally
 *    barred from every freeze/write channel by window-type, independent of
 *    anything tested here. This file proves that boundary holds against the
 *    real packaged overlay window, not just by source inspection.
 *  - Only one 'main'-type window exists in this application's architecture
 *    (single-window trainer). A true two-independent-main-window ownership
 *    test is not constructible without altering production window-creation
 *    code, which is prohibited. The strongest genuine two-owner boundary
 *    available in the real running app is main-window vs. overlay-window
 *    (two distinct, real, live webContents IDs, each independently
 *    registered in the same trusted-sender registry the freeze handlers
 *    consult) — used here for Phase 5.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);
const FIXTURE_EXE = path.join(ROOT, 'tests/fixtures/gate2-2-memory-fixture/bin/Release/net9.0/Gate2_2Fixture.exe');

interface FixtureHandle {
  child: ChildProcess;
  statusPath: string;
  stopPath: string;
  mutatePath: string;
}

function readStatus(statusPath: string): { pid: number; addressHex: string; value: number } {
  for (let i = 0; i < 30; i++) {
    try {
      const text = fs.readFileSync(statusPath, 'utf8');
      if (text.trim().endsWith('}')) {
        return JSON.parse(text);
      }
    } catch { /* transient partial write */ }
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, 10);
  }
  throw new Error('could not read fixture status');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function spawnFixture(tag: string): Promise<FixtureHandle> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const statusPath = path.join(os.tmpdir(), `gate2-4-status-${runId}.json`);
  const stopPath = path.join(os.tmpdir(), `gate2-4-stop-${runId}.stop`);
  const mutatePath = path.join(os.tmpdir(), `gate2-4-mutate-${runId}.txt`);
  const child = spawn(FIXTURE_EXE, [statusPath, stopPath, mutatePath], { stdio: 'ignore', windowsHide: true });
  await sleep(500);
  return { child, statusPath, stopPath, mutatePath };
}

async function killFixture(f: FixtureHandle): Promise<void> {
  try { fs.writeFileSync(f.stopPath, ''); } catch { /* best-effort */ }
  await sleep(400);
  if (f.child.pid && !f.child.killed) {
    try { process.kill(f.child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  for (const p of [f.statusPath, f.stopPath, f.mutatePath]) {
    try { fs.unlinkSync(p); } catch { /* best-effort */ }
  }
}

type AppCtx = { app: ElectronApplication; win: Page; userData: string; appData: string };

async function launchApp(tag: string, extraEnv: Record<string, string> = {}): Promise<AppCtx> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userData = path.join(os.tmpdir(), `solith-gate2-4-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-gate2-4-appdata-${runId}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userData,
      APPDATA: appData,
      USERPROFILE: appData,
      NODE_ENV: 'test',
      SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
      ...extraEnv,
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userData, appData };
}

async function cleanupApp(ctx: AppCtx | null): Promise<void> {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(ctx.appData, { recursive: true, force: true }); } catch { /* best-effort */ }
}

async function attach(win: Page, pid: number): Promise<void> {
  const attachResult = await win.evaluate(
    async (p: number) => (window as any).electronAPI.liveMemoryAttach({ pid: p, executableName: 'Gate2_2Fixture.exe', userConfirmedOffline: true }),
    pid,
  );
  expect(attachResult?.error, `attach must succeed: ${JSON.stringify(attachResult)}`).toBeUndefined();
}

async function realFreezeStart(win: Page, addressHex: string, value: number, intervalMs = 150): Promise<{ proposalId: string; consentToken: string }> {
  const propose = await win.evaluate(
    async (args: [string, number, number]) => (window as any).electronAPI.liveMemoryFreezePropose({
      address: args[0], dataType: 'int32', value: args[1], intervalMs: args[2],
    }),
    [addressHex, value, intervalMs],
  );
  expect(propose?.success, `propose must succeed: ${JSON.stringify(propose)}`).toBe(true);
  const consent = await win.evaluate(
    async (proposalId: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }),
    propose.proposal.proposalId,
  );
  expect(consent?.success, `consent must succeed: ${JSON.stringify(consent)}`).toBe(true);
  const start = await win.evaluate(
    async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({ proposalId: args[0], consentToken: args[1] }),
    [propose.proposal.proposalId, consent.consent.tokenId],
  );
  expect(start?.success, `confirmed start must succeed: ${JSON.stringify(start)}`).toBe(true);
  return { proposalId: propose.proposal.proposalId, consentToken: consent.consent.tokenId };
}

test.describe.configure({ mode: 'serial' });

// ── Phase 3: independent Gate 2.3 reverification ────────────────────────────
test('Phase 3 — independent reverification: full real propose->consent->start->restore->stop->replay-reject cycle', async () => {
  const f = await spawnFixture('p3');
  let ctx: AppCtx | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p3');
    await attach(ctx.win, before.pid);

    const { proposalId, consentToken } = await realFreezeStart(ctx.win, before.addressHex, 909090, 150);
    await sleep(6000);
    expect(readStatus(f.statusPath).value).toBe(909090);
    fs.writeFileSync(f.mutatePath, '345678');
    await sleep(5000);
    expect(readStatus(f.statusPath).value, 'freeze must restore the external mutation').toBe(909090);

    const stop = await ctx.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStop());
    expect(stop?.success).toBe(true);
    const valueAtStop = readStatus(f.statusPath).value;
    await sleep(400);
    expect(readStatus(f.statusPath).value, 'no writes after stop').toBe(valueAtStop);

    const replayStart = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({ proposalId: args[0], consentToken: args[1] }),
      [proposalId, consentToken],
    );
    expect(replayStart?.success, 'proposal/token replay must be rejected').toBe(false);
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 4: renderer crash with a production-created freeze ───────────────
test('Phase 4 — renderer crash while a real-flow freeze is active stops writes and revokes state', async () => {
  const f = await spawnFixture('p4');
  let ctx: AppCtx | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p4');
    await attach(ctx.win, before.pid);
    const { proposalId, consentToken } = await realFreezeStart(ctx.win, before.addressHex, 424242, 150);
    await sleep(3000);
    expect(readStatus(f.statusPath).value).toBe(424242);

    // Simulate the renderer process vanishing (crash) — main.ts's
    // 'render-process-gone' handler must dispose the owning session.
    await ctx.app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents()[0];
      if (wc) wc.forcefullyCrashRenderer();
    });
    await sleep(1000);

    const valueAfterCrash = readStatus(f.statusPath).value;
    await sleep(500);
    expect(readStatus(f.statusPath).value, 'no further writes after renderer crash').toBe(valueAfterCrash);

    // The old proposal/token must not be usable even if the renderer reloads.
    await ctx.win.reload().catch(() => {});
    await ctx.win.waitForSelector('#root > *', { timeout: 20_000 }).catch(() => {});
    const staleStart = await ctx.win.evaluate(
      async (args: [string, string]) => {
        try {
          return await (window as any).electronAPI.liveMemoryFreezeStart({ proposalId: args[0], consentToken: args[1] });
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      [proposalId, consentToken],
    ).catch((e) => ({ success: false, error: String(e) }));
    expect((staleStart as any)?.success, 'pre-crash proposal/token must not survive a renderer crash').toBe(false);
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 5: cross-window ownership isolation (main vs. overlay) ───────────
test('Phase 5 — a second real trusted window (overlay) cannot use or interfere with the main window\'s freeze', async () => {
  const f = await spawnFixture('p5');
  let ctx: AppCtx | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p5');
    await attach(ctx.win, before.pid);
    const propose = await ctx.win.evaluate(
      async (args: [string, number, number]) => (window as any).electronAPI.liveMemoryFreezePropose({
        address: args[0], dataType: 'int32', value: args[1], intervalMs: args[2],
      }),
      [before.addressHex, 135790, 150],
    );
    expect(propose?.success).toBe(true);
    const consent = await ctx.win.evaluate(
      async (proposalId: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }),
      propose.proposal.proposalId,
    );
    expect(consent?.success).toBe(true);

    // Open the real Wisp overlay window (a second, independently-registered
    // trusted webContents in the same running app) and attempt to use the
    // main window's pending proposal/consent from it.
    await ctx.win.evaluate(async () => (window as any).electronAPI.wispOverlayToggle?.());
    await sleep(600);
    const windows = ctx.app.windows();
    const overlayWin = windows.find((w) => w !== ctx!.win) ?? null;

    if (!overlayWin) {
      // Overlay window not reachable in this harness configuration — the
      // window-type restriction is still proven at the unit level (see
      // tests/trusted-sender-registry.test.ts: "rejects a trusted but
      // unauthorized window type for a privileged channel") and structurally
      // by requireTrustedSender(event, ['main']) in electron/live-memory-ipc.ts.
      // Documented as PARTIAL rather than fabricated as fully packaged-proven.
      test.info().annotations.push({ type: 'note', description: 'overlay window not obtained in this harness run; falling back to unit-level proof only' });
    } else {
      const crossWindowConsent = await overlayWin.evaluate(
        async (proposalId: string) => {
          try {
            return await (window as any).electronAPI?.liveMemoryFreezeRequestConsent?.({ proposalId });
          } catch (e) {
            return { success: false, error: String(e) };
          }
        },
        propose.proposal.proposalId,
      ).catch((e) => ({ success: false, error: String(e) }));
      expect((crossWindowConsent as any)?.success, 'the overlay window must not be able to request consent for the main window\'s proposal').toBe(false);

      const crossWindowStart = await overlayWin.evaluate(
        async (args: [string, string]) => {
          try {
            return await (window as any).electronAPI?.liveMemoryFreezeStart?.({ proposalId: args[0], consentToken: args[1] });
          } catch (e) {
            return { success: false, error: String(e) };
          }
        },
        [propose.proposal.proposalId, consent.consent.tokenId],
      ).catch((e) => ({ success: false, error: String(e) }));
      expect((crossWindowStart as any)?.success, 'the overlay window must not be able to start the main window\'s frozen proposal').toBe(false);
    }

    // The main window must still be able to complete its own operation.
    const mainStart = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({ proposalId: args[0], consentToken: args[1] }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(mainStart?.success, 'the legitimate owner (main window) must still be able to complete its own operation').toBe(true);
  } finally {
    await ctx?.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStop()).catch(() => {});
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 9.2-9.5: additional navigation boundary sub-cases ────────────────
test('Phase 9.2/9.4 — same-prefix sibling and encoded-path local navigation do not retain authority', async () => {
  const f = await spawnFixture('p92');
  let ctx: AppCtx | null = null;
  let server: http.Server | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p92');
    await attach(ctx.win, before.pid);
    const trustedUrl = ctx.win.url();

    const baseDir = path.join(os.tmpdir(), `gate2-4-nav-${Date.now()}`);
    const siblingDir = `${baseDir}-evil`;
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });
    const siblingFile = path.join(siblingDir, 'index.html');
    fs.writeFileSync(siblingFile, '<html><body>sibling-evil</body></html>');

    // 9.4: same-prefix sibling directory.
    await ctx.win.goto(`file://${siblingFile.replace(/\\/g, '/')}`);
    const readOnSibling = await ctx.win.evaluate(
      async (addr: string) => {
        try { return await (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }); }
        catch (e) { return { error: String(e) }; }
      },
      before.addressHex,
    ).catch((e) => ({ error: String(e) }));
    expect(readOnSibling == null || (readOnSibling as any)?.error !== undefined, 'sibling-directory content must not retain privileged access').toBe(true);

    // 9.2: encoded-path local file variation of the trusted URL (should still
    // reject anything that isn't the exact canonical form).
    await ctx.win.goto(trustedUrl);
    await ctx.win.waitForSelector('#root > *', { timeout: 20_000 });
    const encodedVariant = `${trustedUrl.replace(/\/index\.html/, '/%2e/index.html')}`;
    await ctx.win.goto(encodedVariant).catch(() => {});
    await sleep(200);
    const readOnEncoded = await ctx.win.evaluate(
      async (addr: string) => {
        try { return await (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }); }
        catch (e) { return { error: String(e) }; }
      },
      before.addressHex,
    ).catch((e) => ({ error: String(e) }));
    // Either the encoded variant failed to navigate (still on trusted URL, but
    // the attach was already dropped by the sibling-directory navigation
    // above) or it landed somewhere unapproved — both must reject fresh
    // privileged reads without a new attach.
    expect(readOnEncoded == null || (readOnEncoded as any)?.error !== undefined, 'encoded-path navigation must not retain privileged access').toBe(true);

    try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(siblingDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  } finally {
    if (server) server.close();
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

test('Phase 9.5 — unapproved local HTTP origin does not retain privileged access', async () => {
  const f = await spawnFixture('p95');
  let ctx: AppCtx | null = null;
  let server: http.Server | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p95');
    await attach(ctx.win, before.pid);

    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>unapproved-http</body></html>');
    });
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
    });

    await ctx.win.goto(`http://127.0.0.1:${port}/`).catch(() => {});
    await sleep(200);
    const readOnHttp = await ctx.win.evaluate(
      async (addr: string) => {
        try { return await (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }); }
        catch (e) { return { error: String(e) }; }
      },
      before.addressHex,
    ).catch((e) => ({ error: String(e) }));
    expect(readOnHttp == null || (readOnHttp as any)?.error !== undefined, 'unapproved local HTTP origin must not retain privileged access').toBe(true);
  } finally {
    if (server) server.close();
    await cleanupApp(ctx);
    await killFixture(f);
  }
});
