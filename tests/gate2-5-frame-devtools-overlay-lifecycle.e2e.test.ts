/**
 * Gate 2.5 — final frame, DevTools, and overlay lifecycle closeout.
 *
 * Not wired into any npm script. Run directly via Playwright against the
 * packaged dist/win-unpacked/Solith.exe. No new production code or test-only
 * hook was added to support these tests — every scenario here drives the
 * real electronAPI surface (or its genuine absence) from a real child frame,
 * a real destroyed frame reference, a real DevTools webContents, and the
 * real Wisp overlay create/destroy/recreate flow (toggleWispOverlay via the
 * production wisp-overlay-toggle IPC channel).
 *
 * Architecture facts taken as given (verified by source read this cycle,
 * not assumed — see gate2_4-independent-review-matrix.csv):
 *  - mainWindow webPreferences: nodeIntegration:false, contextIsolation:true,
 *    sandbox:true, preload:'preload.cjs' (electron/main.ts). Electron only
 *    runs a BrowserWindow's configured preload script in that window's MAIN
 *    frame; subframes (iframes) do not receive it unless
 *    nodeIntegrationInSubFrames is set, which it is not anywhere in this
 *    app. So `window.electronAPI` is expected to be genuinely absent in any
 *    child iframe of the main window, and in the separate DevTools
 *    webContents (which is Electron/Chromium's own internal inspector UI,
 *    not a BrowserWindow this app created or registered).
 *  - requireTrustedSender(event) in electron/live-memory-ipc.ts hardcodes
 *    allowedWindowTypes=['main'] for every freeze/rollback channel, and
 *    validateIpcSender's isMainFrame check
 *    (event.senderFrame === event.sender.mainFrame) is a generic Electron
 *    identity comparison with no Solith-specific heuristic to spoof.
 *  - registerTrustedSolithWindow/unregisterTrustedWindow
 *    (electron/sender-validation.ts) registers by webContents.id and
 *    auto-unregisters on the webContents 'destroyed' event; every window
 *    type (main/wisp-overlay/trainer-overlay) uses the identical mechanism.
 *  - toggleWispOverlay() (electron/wisp-overlay.ts) creates a fresh
 *    BrowserWindow (and registers a fresh webContents id) if none exists;
 *    if one exists it only calls hideWispOverlay() -> .hide(), NOT .destroy()
 *    — verified by source read this cycle. destroyWispOverlay() (the real
 *    .destroy() path) is only ever invoked from electron/main.ts's
 *    'will-quit' handler (full app termination) — there is no
 *    renderer-reachable path to destroy the overlay mid-session, mirroring
 *    the main window's NOT-APPLICABLE recreation case (Gate 2.4 Phase 6).
 *    Per this gate's explicit authorization to destroy/recreate harness-
 *    launched SOLITH windows and overlays, Phase 7 below has the harness
 *    itself call the real Electron BrowserWindow.destroy() API directly on
 *    the harness's own overlay instance to force what this app's own UI
 *    cannot trigger mid-session; recreation afterward still goes through the
 *    real production showWispOverlay()/registerTrustedSolithWindow path via
 *    the real wispOverlayToggle IPC channel — no test-only code was added.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page, Frame } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
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
    try { return JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch { /* transient partial write */ }
  }
  throw new Error('could not read fixture status');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// Bounded state-driven poll, used in place of fixed sleeps wherever an
// observable predicate exists (e.g. "the overlay window now exists" /
// "the destroyed webContents id is gone"). Prior fixed-duration sleeps here
// (700ms for overlay creation, 500ms for destruction settling) were a
// Gate 2.5 timing-hardening residual — a slow CI/VM tick could still lose
// the race against a fixed wait, while a healthy run wastes the fixed
// duration every time. Throws (rather than looping forever) once
// timeoutMs elapses without the predicate becoming truthy.
async function waitForCondition<T>(
  check: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  timeoutMs: number,
  intervalMs = 50,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

async function spawnFixture(tag: string): Promise<FixtureHandle> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const statusPath = path.join(os.tmpdir(), `gate2-5-status-${runId}.json`);
  const stopPath = path.join(os.tmpdir(), `gate2-5-stop-${runId}.stop`);
  const mutatePath = path.join(os.tmpdir(), `gate2-5-mutate-${runId}.txt`);
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
  const userData = path.join(os.tmpdir(), `solith-gate2-5-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-gate2-5-appdata-${runId}`);
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

test.describe.configure({ mode: 'serial' });

// ── Phase 4: live child-frame rejection ─────────────────────────────────────
test('Phase 4 — child iframes of the main window do not receive the privileged preload bridge', async () => {
  const f = await spawnFixture('p4');
  let ctx: AppCtx | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p4');
    await attach(ctx.win, before.pid);

    // Untrusted local child URL (data: URI) embedded as an iframe of the
    // real trusted main-window document.
    const untrustedDir = path.join(os.tmpdir(), `gate2-5-childframe-${Date.now()}`);
    fs.mkdirSync(untrustedDir, { recursive: true });
    const untrustedFile = path.join(untrustedDir, 'untrusted-child.html');
    fs.writeFileSync(untrustedFile, '<html><body>untrusted-child</body></html>');
    const untrustedFileUrl = `file://${untrustedFile.replace(/\\/g, '/')}`;

    const scenarios: { label: string; src: string }[] = [
      { label: 'data-url-same-origin-doc', src: 'data:text/html,<html><body>same-origin-like-child</body></html>' },
      { label: 'untrusted-local-file-child', src: untrustedFileUrl },
      { label: 'about-blank-child', src: 'about:blank' },
    ];

    const results: { label: string; hadElectronAPI: boolean; callResult: unknown }[] = [];

    for (const scenario of scenarios) {
      await ctx.win.evaluate((src: string) => {
        const iframe = document.createElement('iframe');
        iframe.id = 'gate2-5-child-frame';
        iframe.src = src;
        document.body.appendChild(iframe);
      }, scenario.src);
      await sleep(400);

      const childFrame: Frame | null = ctx.win.frames().find((fr) => fr !== ctx!.win.mainFrame()) ?? null;
      let hadElectronAPI = false;
      let callResult: unknown = 'frame-not-found';
      if (childFrame) {
        try {
          hadElectronAPI = await childFrame.evaluate(() => typeof (window as any).electronAPI !== 'undefined');
        } catch (e) {
          hadElectronAPI = false;
          callResult = `evaluate-threw: ${String(e)}`;
        }
        if (hadElectronAPI) {
          // Only attempt the privileged call if the bridge object somehow
          // exists — it should not, by design (no preload in subframes).
          callResult = await childFrame.evaluate(async (addr: string) => {
            try {
              return await (window as any).electronAPI.liveMemoryFreezePropose({ address: addr, dataType: 'int32', value: 1, intervalMs: 100 });
            } catch (e) {
              return { success: false, error: String(e) };
            }
          }, before.addressHex).catch((e) => ({ success: false, error: String(e) }));
        } else {
          callResult = 'electronAPI undefined in child frame (no preload bridge)';
        }
      }
      results.push({ label: scenario.label, hadElectronAPI, callResult });

      await ctx.win.evaluate(() => {
        const el = document.getElementById('gate2-5-child-frame');
        el?.remove();
      });
      await sleep(200);
    }

    fs.writeFileSync(
      path.join(ROOT, 'Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/child-frame-raw-results.json'),
      JSON.stringify(results, null, 2),
    );

    for (const r of results) {
      expect(r.hadElectronAPI, `child frame '${r.label}' must not have the privileged preload bridge`).toBe(false);
    }

    // The main frame must still be able to use its own privileged bridge.
    const mainStillWorks = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryRead({ address: addr, dataType: 'int32' }),
      before.addressHex,
    );
    expect(mainStillWorks?.success, 'the main frame must retain its own privileged access').toBe(true);

    try { fs.rmSync(untrustedDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 5: stale and destroyed frame rejection ───────────────────────────
test('Phase 5 — a destroyed/removed iframe reference cannot be invoked and parent reload revokes state', async () => {
  const f = await spawnFixture('p5');
  let ctx: AppCtx | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p5');
    await attach(ctx.win, before.pid);

    const propose = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryFreezePropose({ address: addr, dataType: 'int32', value: 246810, intervalMs: 150 }),
      before.addressHex,
    );
    expect(propose?.success).toBe(true);

    await ctx.win.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.id = 'gate2-5-stale-frame';
      iframe.src = 'about:blank';
      document.body.appendChild(iframe);
    });
    await sleep(300);
    const staleFrame: Frame | null = ctx.win.frames().find((fr) => fr !== ctx!.win.mainFrame()) ?? null;
    expect(staleFrame, 'a child frame handle must exist before destruction').not.toBeNull();

    // Destroy the frame (remove the iframe element) while retaining the
    // Playwright Frame reference — this models "old frame authorization is
    // not inherited" / stale-reference invocation.
    await ctx.win.evaluate(() => {
      document.getElementById('gate2-5-stale-frame')?.remove();
    });
    await sleep(300);

    let staleInvokeResult: unknown;
    let staleInvokeThrew = false;
    try {
      staleInvokeResult = await staleFrame!.evaluate(async (proposalId: string) => {
        try {
          return await (window as any).electronAPI?.liveMemoryFreezeRequestConsent?.({ proposalId });
        } catch (e) {
          return { success: false, error: String(e) };
        }
      }, propose.proposal.proposalId);
    } catch (e) {
      staleInvokeThrew = true;
      staleInvokeResult = { threw: String(e) };
    }
    // Acceptable outcomes: Playwright itself refuses to evaluate against a
    // destroyed frame (throws), OR the evaluate succeeds but electronAPI is
    // undefined/rejects. Either way, no privileged consent must be granted.
    const staleSucceeded = !staleInvokeThrew && (staleInvokeResult as any)?.success === true;
    expect(staleSucceeded, 'a destroyed/stale frame reference must never obtain privileged consent').toBe(false);

    // Parent reload must revoke the pending proposal.
    await ctx.win.reload();
    await ctx.win.waitForSelector('#root > *', { timeout: 20_000 });
    const postReloadConsent = await ctx.win.evaluate(
      async (proposalId: string) => {
        try { return await (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }); }
        catch (e) { return { success: false, error: String(e) }; }
      },
      propose.proposal.proposalId,
    ).catch((e) => ({ success: false, error: String(e) }));
    expect((postReloadConsent as any)?.success, 'a parent reload must revoke the pre-reload proposal').toBe(false);

    fs.writeFileSync(
      path.join(ROOT, 'Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/stale-frame-raw-results.json'),
      JSON.stringify({ staleInvokeThrew, staleInvokeResult, postReloadConsent }, null, 2),
    );
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 6: DevTools-frame boundary ────────────────────────────────────────
test('Phase 6 — the DevTools webContents has no privileged preload bridge', async () => {
  let ctx: AppCtx | null = null;
  try {
    ctx = await launchApp('p6');

    const openResult = await ctx.app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents()[0];
      if (!wc) return { opened: false, reason: 'no main webContents' };
      wc.openDevTools({ mode: 'detach' });
      return { opened: true };
    });
    await waitForCondition(
      () => ctx!.app.evaluate(({ webContents }) => {
        const mainWc = webContents.getAllWebContents().find((w) => !w.getURL().startsWith('devtools://'));
        return Boolean(mainWc?.devToolsWebContents);
      }),
      5_000,
      100,
    ).catch(() => {
      // Best-effort: fall through to the one-shot probe below, which itself
      // reports hasDevToolsWebContents:false and fails the assertion — a
      // real absence is a genuine finding, not something to mask here.
    });

    const devtoolsProbe = await ctx.app.evaluate(async ({ webContents }) => {
      const mainWc = webContents.getAllWebContents().find((w) => !w.getURL().startsWith('devtools://'));
      const devToolsWc = mainWc?.devToolsWebContents ?? null;
      if (!devToolsWc) {
        return { hasDevToolsWebContents: false, hadElectronAPI: null as boolean | null, note: 'devToolsWebContents not available on this webContents' };
      }
      try {
        const hadElectronAPI = await devToolsWc.executeJavaScript('typeof window.electronAPI !== "undefined"');
        return { hasDevToolsWebContents: true, hadElectronAPI };
      } catch (e) {
        return { hasDevToolsWebContents: true, hadElectronAPI: null as boolean | null, note: `executeJavaScript threw: ${String(e)}` };
      }
    });

    fs.writeFileSync(
      path.join(ROOT, 'Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/devtools-frame-raw-results.json'),
      JSON.stringify({ openResult, devtoolsProbe }, null, 2),
    );

    expect(devtoolsProbe.hasDevToolsWebContents, 'DevTools webContents must be reachable to certify this boundary').toBe(true);
    expect(
      devtoolsProbe.hadElectronAPI,
      'DevTools webContents must not have the privileged preload bridge (it is not a Solith-created/registered BrowserWindow)',
    ).not.toBe(true);
  } finally {
    await cleanupApp(ctx);
  }
});

// ── Phase 7: overlay destruction and recreation ────────────────────────────
test('Phase 7 — the real Wisp overlay can be destroyed and recreated with no inherited trust or state', async () => {
  const f = await spawnFixture('p7');
  let ctx: AppCtx | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p7');
    await attach(ctx.win, before.pid);

    // Create the overlay via the real production toggle.
    await ctx.win.evaluate(async () => (window as any).electronAPI.wispOverlayToggle?.());
    let overlayWin = await waitForCondition(
      () => ctx!.app.windows().find((w) => w !== ctx!.win) ?? null,
      10_000,
    ).catch(() => null);
    expect(overlayWin, 'the real Wisp overlay window must be obtainable via the production toggle').not.toBeNull();

    const firstOverlayId = await ctx.app.evaluate(({ webContents }) => {
      const all = webContents.getAllWebContents();
      const wc = all.find((w) => w.getURL().includes('#wisp-overlay'));
      return wc?.id ?? null;
    });

    // Establish a pending proposal on the main window, then confirm the
    // overlay (a distinct, already window-type-restricted sender) cannot
    // touch it — re-run of the Gate 2.4 boundary against this session's
    // freshly created overlay instance.
    const propose = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryFreezePropose({ address: addr, dataType: 'int32', value: 111222, intervalMs: 150 }),
      before.addressHex,
    );
    expect(propose?.success).toBe(true);
    const preDestroyOverlayConsent = await overlayWin!.evaluate(
      async (proposalId: string) => {
        try { return await (window as any).electronAPI?.liveMemoryFreezeRequestConsent?.({ proposalId }); }
        catch (e) { return { success: false, error: String(e) }; }
      },
      propose.proposal.proposalId,
    ).catch((e) => ({ success: false, error: String(e) }));
    expect((preDestroyOverlayConsent as any)?.success, 'overlay must not obtain consent for the main proposal before destruction').toBe(false);

    // NOTE (verified this cycle, not assumed): toggleWispOverlay() only
    // hides/shows the SAME BrowserWindow (hideWispOverlay() calls .hide(),
    // not .destroy()) — the renderer has no reachable path to a real
    // destroy+recreate cycle while the app is running. destroyWispOverlay()
    // is only ever called from electron/main.ts's 'will-quit' handler (full
    // app termination). A live in-session overlay destroy is therefore not
    // renderer-reachable, exactly parallel to the main window's
    // NOT-APPLICABLE classification in Gate 2.4 Phase 6. Per this gate's
    // explicit authorization to "destroy... only SOLITH windows and
    // overlays launched by the harness", the harness itself invokes the
    // real Electron BrowserWindow.destroy() API (not a Solith-authored
    // bypass) on the harness's own overlay window to force the destroy this
    // app's own code does not otherwise expose mid-session — recreation
    // afterward still goes through the real production showWispOverlay()
    // path (via the real wispOverlayToggle IPC channel), so registration of
    // the new instance is entirely production code, not test-only code.
    await ctx.app.evaluate(async ({ BrowserWindow, webContents }) => {
      const overlayWc = webContents.getAllWebContents().find((w) => w.getURL().includes('#wisp-overlay')) ?? null;
      const bw = overlayWc ? BrowserWindow.fromWebContents(overlayWc) : null;
      bw?.destroy();
    });
    await waitForCondition(
      () => ctx!.app.evaluate(({ webContents }) => !webContents.getAllWebContents().some((w) => w.getURL().includes('#wisp-overlay'))),
      5_000,
      100,
    ).catch(() => {
      // Best-effort: if the destroyed-webContents signal never clears within
      // the bound, the recreation toggle below still proves the real
      // question (can the overlay be recreated) — surfaced via its own
      // assertion rather than failing this wait silently.
    });

    // Recreate the overlay through the real application flow (toggle again).
    await ctx.win.evaluate(async () => (window as any).electronAPI.wispOverlayToggle?.());
    overlayWin = await waitForCondition(
      () => ctx!.app.windows().find((w) => w !== ctx!.win && w !== overlayWin) ?? null,
      10_000,
    ).catch(() => null);
    expect(overlayWin, 'the overlay must be recreatable through the real production toggle').not.toBeNull();

    const secondOverlayId = await ctx.app.evaluate(({ webContents }) => {
      const all = webContents.getAllWebContents();
      const wc = all.find((w) => w.getURL().includes('#wisp-overlay'));
      return wc?.id ?? null;
    });

    fs.writeFileSync(
      path.join(ROOT, 'Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/overlay-recreation-raw-results.json'),
      JSON.stringify({ firstOverlayId, secondOverlayId, preDestroyOverlayConsent }, null, 2),
    );

    expect(firstOverlayId, 'a webContents id must have been captured for the first overlay instance').not.toBeNull();
    expect(secondOverlayId, 'a webContents id must have been captured for the recreated overlay instance').not.toBeNull();
    expect(secondOverlayId, 'the recreated overlay must have a NEW webContents identity, not the old one').not.toBe(firstOverlayId);

    // Re-run the window-type permission test against the RECREATED overlay.
    const propose2 = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryFreezePropose({ address: addr, dataType: 'int32', value: 333444, intervalMs: 150 }),
      before.addressHex,
    );
    expect(propose2?.success).toBe(true);
    const postRecreateOverlayConsent = await overlayWin!.evaluate(
      async (proposalId: string) => {
        try { return await (window as any).electronAPI?.liveMemoryFreezeRequestConsent?.({ proposalId }); }
        catch (e) { return { success: false, error: String(e) }; }
      },
      propose2.proposal.proposalId,
    ).catch((e) => ({ success: false, error: String(e) }));
    expect((postRecreateOverlayConsent as any)?.success, 'the recreated overlay must still be rejected by window-type policy').toBe(false);

    // The main window must retain full function throughout.
    const mainStart = await ctx.win.evaluate(
      async (proposalId: string) => {
        const consent = await (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId });
        if (!consent?.success) return { success: false, stage: 'consent', consent };
        return await (window as any).electronAPI.liveMemoryFreezeStart({ proposalId, consentToken: consent.consent.tokenId });
      },
      propose2.proposal.proposalId,
    );
    expect(mainStart?.success, 'the main window must retain full freeze capability across the overlay lifecycle').toBe(true);
    await ctx.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStop()).catch(() => {});
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 8: SOLITH_TEST_BUILD environment-variant matrix ─────────────────
test('Phase 8 — only the exact SOLITH_TEST_BUILD=1 value enables test-only globals; all other values fail closed', async () => {
  const variants: { label: string; env: Record<string, string> }[] = [
    { label: 'absent', env: {} },
    { label: '0', env: { SOLITH_TEST_BUILD: '0' } },
    { label: 'false', env: { SOLITH_TEST_BUILD: 'false' } },
    { label: 'true', env: { SOLITH_TEST_BUILD: 'true' } },
    { label: '01', env: { SOLITH_TEST_BUILD: '01' } },
    { label: 'whitespace-padded', env: { SOLITH_TEST_BUILD: ' 1 ' } },
    { label: 'trailing-newline', env: { SOLITH_TEST_BUILD: '1\n' } },
    { label: 'exact-1-control', env: { SOLITH_TEST_BUILD: '1' } },
  ];

  const results: { label: string; hooksPresent: boolean }[] = [];

  for (const variant of variants) {
    let ctx: AppCtx | null = null;
    try {
      ctx = await launchApp(`p8-${variant.label}`, variant.env);
      const hooksPresent = await ctx.app.evaluate(() => {
        const g = globalThis as Record<string, unknown>;
        return (
          typeof g.__solithTestHasSessionForOwner !== 'undefined' ||
          typeof g.__solithSetTestForcedCleanupFailureStep !== 'undefined' ||
          typeof g.__solithSetTestProcessIdentityOverride !== 'undefined'
        );
      });
      results.push({ label: variant.label, hooksPresent });
    } finally {
      await cleanupApp(ctx);
    }
  }

  fs.writeFileSync(
    path.join(ROOT, 'Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/test-hook-env-variant-raw-results.json'),
    JSON.stringify(results, null, 2),
  );

  for (const r of results) {
    if (r.label === 'exact-1-control') {
      expect(r.hooksPresent, 'control case: SOLITH_TEST_BUILD=1 must enable the hooks').toBe(true);
    } else {
      expect(r.hooksPresent, `SOLITH_TEST_BUILD=${r.label} must NOT enable any test-only global`).toBe(false);
    }
  }
});

// ── Phase 3 (independent review addendum): freeze-stop/freeze-status ──────
// DISCOVERY NOTE: this repository's git history (commit 317baf0, present on
// this branch before this session began) shows a PRIOR, DIFFERENT agent
// session ("Model: Codex" per its own verification-final.txt) already found
// and fixed a real defect during an earlier Gate 2.5 attempt: the
// 'live-memory-freeze-stop' and 'live-memory-freeze-status' IPC handlers did
// not call requireTrustedSender(event), so a trusted-but-wrong-window-type
// sender (the overlay) could reach them. That fix is already present in the
// current source (electron/live-memory-ipc.ts:797-818) and was NOT
// (re)discovered or (re)written by this session — this test independently
// REPRODUCES the fixed behavior against the real packaged overlay rather
// than accepting the prior agent's own report on faith.
test('Phase 3 addendum — overlay cannot reach freeze-stop or freeze-status (independent reproduction of a pre-existing fix)', async () => {
  const f = await spawnFixture('p3addendum');
  let ctx: AppCtx | null = null;
  try {
    const before = readStatus(f.statusPath);
    ctx = await launchApp('p3addendum');
    await attach(ctx.win, before.pid);

    const propose = await ctx.win.evaluate(
      async (addr: string) => (window as any).electronAPI.liveMemoryFreezePropose({ address: addr, dataType: 'int32', value: 555666, intervalMs: 150 }),
      before.addressHex,
    );
    expect(propose?.success).toBe(true);
    const consent = await ctx.win.evaluate(
      async (proposalId: string) => (window as any).electronAPI.liveMemoryFreezeRequestConsent({ proposalId }),
      propose.proposal.proposalId,
    );
    expect(consent?.success).toBe(true);
    const start = await ctx.win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.liveMemoryFreezeStart({ proposalId: args[0], consentToken: args[1] }),
      [propose.proposal.proposalId, consent.consent.tokenId],
    );
    expect(start?.success).toBe(true);

    await ctx.win.evaluate(async () => (window as any).electronAPI.wispOverlayToggle?.());
    const overlayWin = await waitForCondition(
      () => ctx!.app.windows().find((w) => w !== ctx!.win) ?? null,
      10_000,
    ).catch(() => null);
    expect(overlayWin, 'the real Wisp overlay window must be obtainable').not.toBeNull();

    const overlayStatus = await overlayWin!.evaluate(async () => {
      try { return await (window as any).electronAPI?.liveMemoryFreezeStatus?.(); }
      catch (e) { return { success: false, error: String(e) }; }
    }).catch((e) => ({ success: false, error: String(e) }));
    const overlayStop = await overlayWin!.evaluate(async () => {
      try { return await (window as any).electronAPI?.liveMemoryFreezeStop?.(); }
      catch (e) { return { success: false, error: String(e) }; }
    }).catch((e) => ({ success: false, error: String(e) }));

    fs.writeFileSync(
      path.join(ROOT, 'Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/freeze-stop-status-overlay-raw-results.json'),
      JSON.stringify({ overlayStatus, overlayStop }, null, 2),
    );

    expect((overlayStatus as any)?.success, 'the overlay must not be able to read freeze status for the main window\'s session').toBe(false);
    expect((overlayStop as any)?.success, 'the overlay must not be able to stop the main window\'s freeze').toBe(false);

    // The main window must still be able to stop its own freeze.
    const mainStop = await ctx.win.evaluate(async () => (window as any).electronAPI.liveMemoryFreezeStop());
    expect(mainStop?.success, 'the main window must retain the ability to stop its own freeze').toBe(true);
  } finally {
    await cleanupApp(ctx);
    await killFixture(f);
  }
});

// ── Phase 9: overlay-hidden window must not block full app quit ────────────
test('Phase 9 — closing the main window after the trainer overlay was shown and hidden reaches full app quit (no zombie process)', async () => {
  let ctx: AppCtx | null = null;
  let proc: ReturnType<ElectronApplication['process']> | null = null;
  try {
    ctx = await launchApp('p9');

    // Show, then hide, the real trainer overlay via the production toggle —
    // toggleTrainerOverlay()'s hide path calls hideTrainerOverlay(), which
    // calls BrowserWindow.hide() (not .destroy()). Reproduces the exact
    // reported sequence: overlay opened once, then hidden, then main window
    // closed.
    await ctx.win.evaluate(async () => (window as any).electronAPI.trainerOverlayToggle?.());
    await sleep(500);
    const overlayShown = ctx.app.windows().find((w) => w !== ctx!.win) ?? null;
    expect(overlayShown, 'the real trainer overlay window must be obtainable via the production toggle').not.toBeNull();

    await ctx.win.evaluate(async () => (window as any).electronAPI.trainerOverlayHide?.());
    await sleep(500);

    proc = ctx.app.process();
    const exited = new Promise<number | null>((resolve) => {
      proc.once('exit', (code) => resolve(code));
    });

    // Close the main window the way a user would (the window's own close
    // control), not ElectronApplication.close() — that would force-terminate
    // the app regardless of whether the app's own quit logic ever runs, which
    // would hide the exact bug this test exists to catch. Closing the
    // Playwright Page bound to the main BrowserWindow closes that window
    // specifically (unambiguous — no title/URL matching needed, and it can't
    // accidentally target the overlay). Fired without awaiting: once the main
    // process starts tearing down mid-call, the CDP response may never
    // arrive, and only the process actually exiting matters here.
    void ctx.win.close().catch(() => { /* expected once the main process is gone */ });

    const result = await Promise.race([
      exited,
      sleep(15_000).then(() => 'timeout' as const),
    ]);

    expect(
      result,
      'the app process must exit on its own once the main window closes, even though the trainer overlay was shown and hidden earlier in the session',
    ).not.toBe('timeout');
  } finally {
    if (ctx) {
      // The process is almost certainly already gone at this point (that's
      // what the test just proved) — only ask ElectronApplication to close
      // it if it somehow isn't. Reuse the ChildProcess handle captured
      // earlier rather than calling ctx.app.process() again here — once the
      // main process is gone, re-querying the (now-disconnected)
      // ElectronApplication for it throws instead of returning cleanly.
      if (proc && proc.exitCode === null) {
        await ctx.app.close().catch(() => {});
      }
      try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
      try { fs.rmSync(ctx.appData, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
});
