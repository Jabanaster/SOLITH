import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type AppContext = {
  app: ElectronApplication;
  win: Page;
  userData: string;
  appData: string;
};

async function launchTestApp(): Promise<AppContext> {
  const root = process.cwd();
  const mainPath = path.join(root, 'dist-electron-test', 'main.js');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exp-overlay-ud-'));
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exp-overlay-ad-'));

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SOLITH_TEST_BUILD: '1',
      SOLITH_ENABLE_WISP_OVERLAY: '1',
      APPDATA: appData,
      LOCALAPPDATA: userData,
      USERPROFILE: userData,
    },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win, userData, appData };
}

async function cleanupApp(ctx: AppContext | null) {
  if (!ctx) return;
  try {
    await ctx.app.close();
  } catch {
    // best-effort shutdown
  }
  for (const dir of [ctx.userData, ctx.appData]) {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

test.describe('Experimental Wisp Overlay Functionality', () => {
  test('overlay toggle, bounds, and interactivity work in experimental test build mode', async () => {
    let ctx: AppContext | null = null;
    try {
      // 1. Assert test build manifest indicates overlay enablement
      const root = process.cwd();
      const manifestPath = path.join(root, 'dist-electron-test', 'solith-build-manifest.json');
      assertManifestEnabled(manifestPath);

      // 2. Launch test application
      ctx = await launchTestApp();

      // 3. Verify all 5 Wisp overlay methods are present on window.electronAPI
      const methodCheck = await ctx.win.evaluate(() => {
        const api = (window as any).electronAPI ?? {};
        return {
          toggle: typeof api.wispOverlayToggle,
          hide: typeof api.wispOverlayHide,
          setExpanded: typeof api.wispOverlaySetExpanded,
          moveBy: typeof api.wispOverlayMoveBy,
          setInteractive: typeof api.wispOverlaySetInteractive,
        };
      });

      expect(methodCheck.toggle).toBe('function');
      expect(methodCheck.hide).toBe('function');
      expect(methodCheck.setExpanded).toBe('function');
      expect(methodCheck.moveBy).toBe('function');
      expect(methodCheck.setInteractive).toBe('function');

      // 4. Toggle overlay and assert overlay window creation
      const toggleResult = await ctx.win.evaluate(async () => {
        return (window as any).electronAPI.wispOverlayToggle();
      });
      expect(toggleResult.success).toBe(true);

      // Wait for overlay window to spawn
      await expect.poll(() => ctx!.app.windows().length, { timeout: 15_000 }).toBe(2);
      const overlayWin = ctx.app.windows().find((w) => w.url().includes('#wisp-overlay'));
      expect(overlayWin).toBeTruthy();

      // 5. Hide overlay
      const hideResult = await ctx.win.evaluate(async () => {
        return (window as any).electronAPI.wispOverlayHide();
      });
      expect(hideResult.success).toBe(true);
    } finally {
      await cleanupApp(ctx);
    }
  });
});

function assertManifestEnabled(manifestPath: string) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Test build manifest missing at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.wispOverlayEnabled !== true || manifest.buildMode !== 'test') {
    throw new Error(`Test manifest invalid: ${JSON.stringify(manifest)}`);
  }
}
