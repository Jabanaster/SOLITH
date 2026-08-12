import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type DiagnosticEntry = {
  sequence: number;
  timestampUtc: string;
  elapsedMs: number;
  stage: string;
  status: 'before' | 'success' | 'failure';
  details?: unknown;
};

class DiagnosticLogger {
  readonly dir: string;
  private sequence = 0;
  private startTime = Date.now();
  readonly milestones: DiagnosticEntry[] = [];
  readonly windowEvents: unknown[] = [];
  readonly pageEvents: unknown[] = [];

  constructor() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const customDir = process.env.SOLITH_F012_DIAGNOSTIC_DIR;
    this.dir = customDir || path.join(os.tmpdir(), `solith-f012-runtime-diagnostic-${stamp}-${Math.random().toString(36).substring(2, 8)}`);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  logMilestone(stage: string, status: 'before' | 'success' | 'failure', details?: unknown) {
    this.sequence++;
    const entry: DiagnosticEntry = {
      sequence: this.sequence,
      timestampUtc: new Date().toISOString(),
      elapsedMs: Date.now() - this.startTime,
      stage,
      status,
      details,
    };
    this.milestones.push(entry);
    this.flushMilestones();
  }

  logWindowEvent(event: string, details?: unknown) {
    this.windowEvents.push({
      timestampUtc: new Date().toISOString(),
      elapsedMs: Date.now() - this.startTime,
      event,
      details,
    });
    fs.writeFileSync(path.join(this.dir, 'window-events.json'), JSON.stringify(this.windowEvents, null, 2), 'utf8');
  }

  logPageEvent(pageIndex: number, event: string, details?: unknown) {
    this.pageEvents.push({
      timestampUtc: new Date().toISOString(),
      elapsedMs: Date.now() - this.startTime,
      pageIndex,
      event,
      details,
    });
    fs.writeFileSync(path.join(this.dir, 'page-events.json'), JSON.stringify(this.pageEvents, null, 2), 'utf8');
  }

  appendStdout(chunk: string) {
    fs.appendFileSync(path.join(this.dir, 'electron-stdout.log'), chunk, 'utf8');
  }

  appendStderr(chunk: string) {
    fs.appendFileSync(path.join(this.dir, 'electron-stderr.log'), chunk, 'utf8');
  }

  flushMilestones() {
    fs.writeFileSync(path.join(this.dir, 'milestones.json'), JSON.stringify(this.milestones, null, 2), 'utf8');
  }
}

type AppContext = {
  app: ElectronApplication;
  win: Page;
  userData: string;
  appData: string;
  logger: DiagnosticLogger;
};

async function withTimeout<T>(ms: number, stage: string, fn: () => Promise<T>, logger: DiagnosticLogger): Promise<T> {
  logger.logMilestone(stage, 'before');
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Stage '${stage}' timed out after ${ms}ms`);
      err.name = 'StageTimeoutError';
      reject(err);
    }, ms);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    clearTimeout(timer!);
    logger.logMilestone(stage, 'success');
    return result;
  } catch (error) {
    clearTimeout(timer!);
    const errDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
    logger.logMilestone(stage, 'failure', errDetails);
    throw error;
  }
}

async function launchTestApp(logger: DiagnosticLogger): Promise<AppContext> {
  const root = process.cwd();
  const mainPath = path.join(root, 'dist-electron-test', 'main.js');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exp-overlay-ud-'));
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-exp-overlay-ad-'));

  const app = await withTimeout(30_000, 'electron-launch', async () => {
    const spawnedApp = await electron.launch({
      args: [mainPath, '--enable-logging'],
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

    const processObj = spawnedApp.process();
    logger.logWindowEvent('electron-process-spawned', { pid: processObj.pid });

    if (processObj.stdout) {
      processObj.stdout.on('data', (chunk) => logger.appendStdout(chunk.toString()));
    }
    if (processObj.stderr) {
      processObj.stderr.on('data', (chunk) => logger.appendStderr(chunk.toString()));
    }
    processObj.on('exit', (code, signal) => logger.logWindowEvent('electron-process-exit', { code, signal }));

    spawnedApp.on('window', (page) => {
      logger.logWindowEvent('window-created', { url: page.url() });
      attachPageListeners(page, logger, spawnedApp.windows().indexOf(page));
    });

    return spawnedApp;
  }, logger);

  const win = await withTimeout(30_000, 'first-window', async () => {
    const firstPage = await app.firstWindow();
    logger.logWindowEvent('first-window-acquired', { url: firstPage.url() });
    return firstPage;
  }, logger);

  await withTimeout(20_000, 'main-load-state', async () => {
    await win.waitForLoadState('domcontentloaded');
  }, logger);

  logger.logMilestone('main-url', 'success', { url: win.url(), title: await win.title() });

  return { app, win, userData, appData, logger };
}

function attachPageListeners(page: Page, logger: DiagnosticLogger, index: number) {
  page.on('console', (msg) => logger.logPageEvent(index, 'console', { type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => logger.logPageEvent(index, 'pageerror', { message: err.message, stack: err.stack }));
  page.on('requestfailed', (req) => logger.logPageEvent(index, 'requestfailed', { url: req.url(), failure: req.failure() }));
  page.on('framenavigated', (frame) => logger.logPageEvent(index, 'framenavigated', { url: frame.url(), name: frame.name() }));
  page.on('close', () => logger.logPageEvent(index, 'close'));
  page.on('crash', () => logger.logPageEvent(index, 'crash'));
}

async function cleanupApp(ctx: AppContext | null) {
  if (!ctx) return;
  const logger = ctx.logger;
  try {
    await withTimeout(15_000, 'application-close', async () => {
      await ctx.app.close();
    }, logger);
  } catch (error) {
    logger.logMilestone('application-close-cleanup-catch', 'failure', String(error));
  }

  await withTimeout(10_000, 'temporary-directory-cleanup', async () => {
    for (const dir of [ctx.userData, ctx.appData]) {
      try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        logger.logMilestone('dir-cleanup-error', 'failure', { dir, error: String(error) });
      }
    }
  }, logger);
}

test.describe('Experimental Wisp Overlay Functionality', () => {
  test('overlay toggle, bounds, and interactivity work in experimental test build mode', async ({ context }) => {
    const logger = new DiagnosticLogger();
    let ctx: AppContext | null = null;
    console.log(`[SOLITH_F012_DIAGNOSTIC] Directory: ${logger.dir}`);

    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });

    try {
      // 1. Manifest read & artifact validation
      const root = process.cwd();
      const manifestPath = path.join(root, 'dist-electron-test', 'solith-build-manifest.json');
      logger.logMilestone('manifest-read', 'before', { manifestPath });
      assertManifestEnabled(manifestPath);
      logger.logMilestone('manifest-read', 'success');

      logger.logMilestone('artifact-validation', 'before');
      expect(fs.existsSync(path.join(root, 'dist-electron-test', 'main.js'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'dist-electron-test', 'preload.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'dist-electron-test', 'dist', 'index.html'))).toBe(true);
      logger.logMilestone('artifact-validation', 'success');

      // 2. Launch test application
      ctx = await launchTestApp(logger);

      // 3. Preload API evaluation
      const methodCheck = await withTimeout(10_000, 'preload-api-evaluation', async () => {
        return ctx!.win.evaluate(() => {
          const api = (window as any).electronAPI ?? {};
          return {
            toggle: typeof api.wispOverlayToggle,
            hide: typeof api.wispOverlayHide,
            setExpanded: typeof api.wispOverlaySetExpanded,
            moveBy: typeof api.wispOverlayMoveBy,
            setInteractive: typeof api.wispOverlaySetInteractive,
          };
        });
      }, logger);

      logger.logMilestone('preload-api-evaluation-result', 'success', methodCheck);
      expect(methodCheck.toggle).toBe('function');
      expect(methodCheck.hide).toBe('function');
      expect(methodCheck.setExpanded).toBe('function');
      expect(methodCheck.moveBy).toBe('function');
      expect(methodCheck.setInteractive).toBe('function');

      // 4. Toggle invoke & result
      const toggleResult = await withTimeout(15_000, 'toggle-invoke', async () => {
        return ctx!.win.evaluate(async () => {
          return (window as any).electronAPI.wispOverlayToggle();
        });
      }, logger);

      logger.logMilestone('toggle-result', 'success', toggleResult);
      expect(toggleResult.success).toBe(true);

      // 5. Window count poll & inventory
      await withTimeout(15_000, 'window-count-poll', async () => {
        await expect.poll(() => ctx!.app.windows().length, { timeout: 14_000 }).toBe(2);
      }, logger);

      const windowsInventory = ctx.app.windows().map((w, idx) => ({ index: idx, url: w.url(), closed: w.isClosed() }));
      logger.logMilestone('window-inventory', 'success', windowsInventory);

      const overlayWin = ctx.app.windows().find((w) => w.url().includes('#wisp-overlay'));
      expect(overlayWin).toBeTruthy();
      logger.logMilestone('overlay-url', 'success', { url: overlayWin!.url() });

      // 6. Hide invoke
      const hideResult = await withTimeout(10_000, 'hide-invoke', async () => {
        return ctx!.win.evaluate(async () => {
          return (window as any).electronAPI.wispOverlayHide();
        });
      }, logger);

      logger.logMilestone('hide-result', 'success', hideResult);
      expect(hideResult.success).toBe(true);
    } catch (error) {
      logger.logMilestone('test-failure-catch', 'failure', String(error));
      throw error;
    } finally {
      const tracePath = path.join(logger.dir, 'trace.zip');
      await context.tracing.stop({ path: tracePath });
      logger.logMilestone('tracing-stop', 'success', { tracePath });

      await cleanupApp(ctx);
      console.log(`[SOLITH_F012_DIAGNOSTIC] Final Directory: ${logger.dir}`);
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
