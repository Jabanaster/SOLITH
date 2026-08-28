import { test, expect, type ElectronApplication, type Page, type Frame } from '@playwright/test';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);

type AppContext = {
  app: ElectronApplication;
  win: Page;
  userData: string;
  appData: string;
};

type PrivilegedResult = {
  operation: string;
  available: boolean;
  success?: boolean;
  error?: string;
};

async function launchApp(tag: string, testBuildValue?: string): Promise<AppContext> {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userData = path.join(os.tmpdir(), `solith-gate2-5-${runId}`);
  const appData = path.join(os.tmpdir(), `solith-gate2-5-appdata-${runId}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  const env = {
    ...process.env,
    ELECTRON_USER_DATA_PATH: userData,
    APPDATA: appData,
    USERPROFILE: appData,
    NODE_ENV: 'test',
    SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
  };
  if (testBuildValue === undefined) delete env.SOLITH_TEST_BUILD;
  else env.SOLITH_TEST_BUILD = testBuildValue;
  const app = await electron.launch({ executablePath: EXE_PATH, env });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userData, appData };
}

async function cleanupApp(ctx: AppContext | null): Promise<void> {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  try { ctx.app.process()?.kill('SIGKILL'); } catch { /* best-effort */ }
  fs.rmSync(ctx.userData, { recursive: true, force: true });
  fs.rmSync(ctx.appData, { recursive: true, force: true });
}

async function createFrame(win: Page, id: string, url: string, parent?: Frame): Promise<Frame> {
  const host = parent ?? win.mainFrame();
  await host.evaluate(
    async ({ frameId, frameUrl }) => {
      const iframe = document.createElement('iframe');
      iframe.id = frameId;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`iframe load timeout: ${frameId}`)), 15_000);
        const checkDone = () => {
          window.clearTimeout(timer);
          resolve();
        };
        iframe.addEventListener('load', checkDone, { once: true });
        document.body.appendChild(iframe);
        iframe.src = frameUrl;
        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
          checkDone();
        }
      });
    },
    { frameId: id, frameUrl: url },
  );
  const handle = await host.$(`#${id}`);
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`Frame ${id} was not created`);
  return frame;
}

async function invokePrivilegedMatrix(frame: Frame): Promise<PrivilegedResult[]> {
  return frame.evaluate(async () => {
    const ownApi = (window as any).electronAPI;
    let parentApi: any;
    try { parentApi = (window.parent as any).electronAPI; } catch { parentApi = undefined; }
    const api = ownApi ?? parentApi;
    const bridgeSource: 'own-frame' | 'same-origin-parent' | 'none' = ownApi
      ? 'own-frame'
      : parentApi
        ? 'same-origin-parent'
        : 'none';
    const calls: Array<[string, undefined | (() => Promise<any>)]> = [
      ['process-selection', api?.registrySelectProcess && (() => api.registrySelectProcess({ pid: 1, executableName: 'invalid.exe' }))],
      ['freeze-proposal', api?.liveMemoryFreezePropose && (() => api.liveMemoryFreezePropose({ address: '1', dataType: 'int32', value: 1, intervalMs: 250 }))],
      ['consent-request', api?.liveMemoryFreezeRequestConsent && (() => api.liveMemoryFreezeRequestConsent({ proposalId: 'gate2-5-invalid' }))],
      ['confirmed-freeze-start', api?.liveMemoryFreezeStart && (() => api.liveMemoryFreezeStart({ proposalId: 'gate2-5-invalid', consentToken: 'gate2-5-invalid' }))],
      ['freeze-stop', api?.liveMemoryFreezeStop && (() => api.liveMemoryFreezeStop())],
      ['rollback', api?.liveMemoryRollback && (() => api.liveMemoryRollback({ proposalId: 'gate2-5-invalid' }))],
      ['privileged-diagnostic-state', api?.liveMemoryFreezeStatus && (() => api.liveMemoryFreezeStatus())],
    ];
    const results: PrivilegedResult[] = [];
    for (const [operation, invoke] of calls) {
      if (!invoke) {
        results.push({ operation, available: false, bridgeSource });
        continue;
      }
      try {
        const result = await invoke();
        results.push({
          operation,
          available: true,
          success: result?.success,
          error: typeof result?.error === 'string' ? result.error : JSON.stringify(result),
          bridgeSource,
        });
      } catch (error) {
        results.push({ operation, available: true, success: false, error: String(error), bridgeSource });
      }
    }
    return results;
  });
}

function expectChildFrameBoundary(results: PrivilegedResult[], scenario: string): void {
  expect(results).toHaveLength(7);
  for (const result of results) {
    if (!result.available) {
      expect(result.bridgeSource, `${scenario}/${result.operation}: no child-accessible bridge`).toBe('none');
      continue;
    }
    expect(result.success, `${scenario}/${result.operation}: available child bridge must reject`).toBe(false);
    expect(result.error, `${scenario}/${result.operation}: rejection must come from sender-frame validation`)
      .toContain('sender_rejected:not_main_frame');
  }
}

function expectOverlayRejection(results: PrivilegedResult[], scenario: string): void {
  expect(results).toHaveLength(7);
  for (const result of results) {
    expect(result.available, `${scenario}/${result.operation}: overlay preload bridge expected`).toBe(true);
    expect(result.success, `${scenario}/${result.operation}: overlay must reject`).toBe(false);
    expect(result.error, `${scenario}/${result.operation}: rejection must come from window-type validation`)
      .toContain('sender_rejected:unauthorized_window_type');
  }
}
test('live packaged same-origin, trusted-looking, and nested child frames reject privileged calls', async () => {
  let ctx: AppContext | null = null;
  try {
    ctx = await launchApp('child');
    const trustedUrl = ctx.win.url();
    const sameOrigin = await createFrame(ctx.win, 'gate25-same-origin', trustedUrl);
    expectChildFrameBoundary(await invokePrivilegedMatrix(sameOrigin), 'same-origin child');

    const trustedLooking = await createFrame(ctx.win, 'gate25-trusted-looking', `${trustedUrl}?gate2_5=child`);
    expectChildFrameBoundary(await invokePrivilegedMatrix(trustedLooking), 'trusted-looking child URL');

    const nested = await createFrame(ctx.win, 'gate25-nested', 'about:blank', sameOrigin);
    expectChildFrameBoundary(await invokePrivilegedMatrix(nested), 'nested child');
  } finally {
    await cleanupApp(ctx);
  }
});

test('live packaged untrusted local child frame rejects privileged calls', async () => {
  let ctx: AppContext | null = null;
  const localPage = path.join(os.tmpdir(), `solith-gate2-5-untrusted-${Date.now()}.html`);
  fs.writeFileSync(localPage, '<!doctype html><html><body>Gate 2.5 local child</body></html>');
  try {
    ctx = await launchApp('local-child');
    const localUrl = new URL(`file:///${localPage.replace(/\\/g, '/')}`).href;
    const child = await createFrame(ctx.win, 'gate25-local', localUrl);
    expectChildFrameBoundary(await invokePrivilegedMatrix(child), 'untrusted local child');
  } finally {
    await cleanupApp(ctx);
    fs.rmSync(localPage, { force: true });
  }
});

test('live packaged cross-origin local HTTP child frame has no privileged bridge', async () => {
  let ctx: AppContext | null = null;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><body>Gate 2.5 cross-origin child</body></html>');
  });
  try {
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
    ctx = await launchApp('http-child');
    const child = await createFrame(ctx.win, 'gate25-http', `http://127.0.0.1:${port}/`);
    expectChildFrameBoundary(await invokePrivilegedMatrix(child), 'cross-origin local HTTP child');
  } finally {
    await cleanupApp(ctx);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('destroyed and navigated child frames cannot invoke through retained frame references', async () => {
  let ctx: AppContext | null = null;
  try {
    ctx = await launchApp('stale');
    const trustedUrl = ctx.win.url();
    const removed = await createFrame(ctx.win, 'gate25-removed', trustedUrl);
    await ctx.win.evaluate(() => document.querySelector('#gate25-removed')?.remove());
    await expect(removed.evaluate(() => (window as any).electronAPI?.liveMemoryFreezeStatus?.()))
      .rejects.toThrow();

    const navigated = await createFrame(ctx.win, 'gate25-navigated', trustedUrl);
    await navigated.goto('about:blank');
    const navigatedResult = await invokePrivilegedMatrix(navigated);
    expectChildFrameBoundary(navigatedResult, 'navigated child');

    const parentReloadChild = await createFrame(ctx.win, 'gate25-parent-reload', trustedUrl);
    await ctx.win.reload();
    await ctx.win.waitForSelector('#root > *', { timeout: 20_000 });
    await expect(parentReloadChild.evaluate(() => (window as any).electronAPI?.liveMemoryFreezeStatus?.()))
      .rejects.toThrow();
  } finally {
    await cleanupApp(ctx);
  }
});

test('packaged DevTools context has no preload bridge, renderer Node access, or trusted-window registration', async () => {
  let ctx: AppContext | null = null;
  try {
    ctx = await launchApp('devtools', '1');
    const mainId = await ctx.app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Solith');
      if (!main) throw new Error('main window not found');
      main.webContents.openDevTools({ mode: 'detach', activate: false });
      return main.webContents.id;
    });
    await expect.poll(() => ctx!.app.windows().length, { timeout: 15_000 }).toBeGreaterThan(1);
    const devtoolsPage = ctx.app.windows().find((page) => page !== ctx!.win);
    expect(devtoolsPage).toBeTruthy();
    const boundary = await devtoolsPage!.evaluate(() => ({
      url: location.href,
      hasElectronApi: typeof (window as any).electronAPI !== 'undefined',
      hasRequire: typeof (window as any).require !== 'undefined',
      hasProcess: typeof (window as any).process !== 'undefined',
    }));
    expect(boundary.hasElectronApi).toBe(false);
    expect(boundary.hasRequire).toBe(false);
    expect(boundary.hasProcess).toBe(false);
    const ids = await ctx.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        id: window.webContents.id,
        title: window.getTitle(),
      })),
    );
    expect(ids.some((entry) => entry.id === mainId)).toBe(true);
    expect(ids.filter((entry) => entry.id !== mainId).every((entry) => entry.title !== 'Solith')).toBe(true);
  } finally {
    await cleanupApp(ctx);
  }
});

test('real Wisp overlay is excluded from production release build', async () => {
  let ctx: AppContext | null = null;
  try {
    ctx = await launchApp('overlay');
    const toggleType = await ctx.win.evaluate(() => typeof (window as any).electronAPI?.wispOverlayToggle);
    expect(toggleType).toBe('undefined');
    const windows = ctx.app.windows();
    const overlayWins = windows.filter((page) => page.url().includes('#wisp-overlay'));
    expect(overlayWins.length).toBe(0);
  } finally {
    if (ctx) await cleanupApp(ctx);
  }
});

test('SOLITH_TEST_BUILD enables main-process hooks only for the exact value 1', async () => {
  const variants: Array<string | undefined> = [undefined, '0', 'false', 'true', '01', '', ' ', ' 1', '1 '];
  for (const value of variants) {
    let ctx: AppContext | null = null;
    try {
      ctx = await launchApp(`guard-${String(value)}`, value);
      const hooks = await ctx.app.evaluate(() => [
        '__solithTestHasSessionForOwner',
        '__solithSetTestForcedCleanupFailureStep',
        '__solithClearTestForcedCleanupFailureSteps',
        '__solithSetTestProcessIdentityOverride',
        '__solithClearTestProcessIdentityOverrides',
        '__solithQueryWindowsProcessIdentity',
        '__solithCompareProcessIdentity',
      ].filter((name) => typeof (globalThis as any)[name] !== 'undefined'));
      expect(hooks, `SOLITH_TEST_BUILD=${String(value)} must fail closed`).toEqual([]);
      const rendererMutation = await ctx.win.evaluate(() => {
        (window as any).SOLITH_TEST_BUILD = '1';
        return typeof (window as any).__solithSetTestProcessIdentityOverride;
      });
      expect(rendererMutation).toBe('undefined');
    } finally {
      await cleanupApp(ctx);
    }
  }

  let enabled: AppContext | null = null;
  try {
    enabled = await launchApp('guard-exact', '1');
    const hooks = await enabled.app.evaluate(() => [
      '__solithTestHasSessionForOwner',
      '__solithSetTestForcedCleanupFailureStep',
      '__solithClearTestForcedCleanupFailureSteps',
      '__solithSetTestProcessIdentityOverride',
      '__solithClearTestProcessIdentityOverrides',
      '__solithQueryWindowsProcessIdentity',
      '__solithCompareProcessIdentity',
    ].filter((name) => typeof (globalThis as any)[name] === 'function'));
    expect(hooks).toHaveLength(7);
  } finally {
    await cleanupApp(enabled);
  }
});
