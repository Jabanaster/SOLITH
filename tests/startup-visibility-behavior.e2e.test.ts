/**
 * tests/startup-visibility-behavior.e2e.test.ts
 *
 * Behavioral coverage for the startup visibility gate and deferred trainer
 * catalog bootstrap in electron/main.ts (createWindow / showOnce /
 * runDeferredTrainerCatalogBootstrap). Complements
 * tests/startup-performance-static.test.ts, which only checks source
 * structure — these tests launch the real, built Electron main process and
 * observe actual BrowserWindow state and stdout timing marks.
 *
 * Test-only env seam (read once at createWindow() time in electron/main.ts,
 * never set in dev or packaged operation):
 *   SOLITH_READY_TO_SHOW_TIMEOUT_MS=<ms> — override the 10s fallback bound.
 *     Set to a very small value (e.g. "1") to deterministically force the
 *     fallback path to win the race against the real renderer's
 *     'ready-to-show' signal, without needing to fake a stuck renderer.
 * SOLITH_STARTUP_TRACE=1 enables the [startup-timing] marks this suite
 * parses from stdout.
 *
 * An earlier version of this suite tried a second seam
 * (SOLITH_TEST_SUPPRESS_LOAD, skipping loadFile/loadURL entirely) to test
 * the fallback and destroyed-window paths without any real navigation. That
 * broke Playwright's Electron window-attach detection (firstWindow() never
 * resolves without a real navigation committing), so it was removed in
 * favor of forcing the race with a near-zero fallback timeout against real
 * content instead.
 *
 * Run with: npm run test:startup-visibility
 */
import { test, expect, ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');

function tempUserData(label: string): string {
  const dir = path.join(os.tmpdir(), `solith-startup-behavior-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

type Capture = { marks: string[]; stderr: string[] };

function captureOutput(app: ElectronApplication): Capture {
  const capture: Capture = { marks: [], stderr: [] };
  const proc = app.process();
  proc.stdout?.on('data', (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      const match = line.match(/\[startup-timing\] event=(\S+)/);
      if (match) capture.marks.push(match[1]!);
    }
  });
  proc.stderr?.on('data', (buf: Buffer) => {
    capture.stderr.push(buf.toString('utf8'));
  });
  return capture;
}

// electronApp.evaluate() occasionally races a transient internal navigation
// right around the moment a window becomes visible ("Execution context was
// destroyed, most likely because of a navigation"). It self-heals — the
// same call reliably succeeds moments later — so a single short retry is
// enough rather than an app-level fix.
async function evaluateWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && /Execution context was destroyed/.test(error.message)) {
      await new Promise((r) => setTimeout(r, 250));
      return fn();
    }
    throw error;
  }
}

async function isMainWindowVisible(app: ElectronApplication): Promise<boolean> {
  return evaluateWithRetry(() => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win ? win.isVisible() : false;
  }));
}

async function mainWindowExists(app: ElectronApplication): Promise<boolean> {
  return evaluateWithRetry(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length > 0));
}

function waitForMark(capture: Capture, event: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (capture.marks.includes(event)) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for mark "${event}"; seen so far: [${capture.marks.join(',')}]`));
      setTimeout(check, 50);
    };
    check();
  });
}

test.beforeAll(() => {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:electron" first.`);
  }
});

// ── Ready path: real launch, real load, real ready-to-show ─────────────────

test.describe('ready path (real renderer load, normal fallback bound)', () => {
  let app: ElectronApplication;
  let capture: Capture;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_BUNDLE],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_PATH: tempUserData('ready'),
        NODE_ENV: 'test',
        SOLITH_STARTUP_TRACE: '1',
      },
    });
    capture = captureOutput(app);
    await app.firstWindow();
    // Window existing (CDP-attachable) does not imply it is visible yet —
    // that is the entire point of show:false + ready-to-show gating.
    await waitForMark(capture, 'ready-to-show', 30_000);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test('window becomes visible via ready-to-show, not the fallback', async () => {
    expect(await isMainWindowVisible(app)).toBe(true);
    expect(capture.marks).not.toContain('ready-to-show-fallback-timeout');
  });

  test('deferred catalog bootstrap starts exactly once, after window creation', async () => {
    await waitForMark(capture, 'trainer-catalog-bootstrap-start', 5_000);
    const startCount = capture.marks.filter((m) => m === 'trainer-catalog-bootstrap-start').length;
    expect(startCount).toBe(1);
    const createWindowIdx = capture.marks.indexOf('create-window-start');
    const bootstrapIdx = capture.marks.indexOf('trainer-catalog-bootstrap-start');
    expect(createWindowIdx).toBeGreaterThanOrEqual(0);
    expect(bootstrapIdx).toBeGreaterThan(createWindowIdx);
  });

  test('required pre-window steps remain ordered before window creation', () => {
    const idx = (event: string) => capture.marks.indexOf(event);
    expect(idx('db-init-done')).toBeGreaterThanOrEqual(0);
    expect(idx('crash-recovery-done')).toBeGreaterThanOrEqual(0);
    expect(idx('create-window-start')).toBeGreaterThan(idx('db-init-done'));
    expect(idx('create-window-start')).toBeGreaterThan(idx('crash-recovery-done'));
    // Game Bar transport setup was already mandatory-before-window in the
    // pre-existing code and was not reordered by this fix.
    const gamebarSettled = Math.max(idx('gamebar-transport-done'), idx('gamebar-transport-failed'));
    expect(gamebarSettled).toBeGreaterThanOrEqual(0);
    expect(idx('create-window-start')).toBeGreaterThan(gamebarSettled);
  });

  test('window shown exactly once (no duplicate show/fallback marks)', () => {
    const showMarks = capture.marks.filter((m) => m === 'ready-to-show' || m === 'ready-to-show-fallback-timeout');
    expect(showMarks.length).toBe(1);
  });

  test('no unhandled rejection reached the process (real run includes a caught Game Bar failure)', () => {
    expect(capture.marks).toContain('gamebar-transport-failed');
    const unhandled = capture.stderr.join('').match(/unhandledrejection|UnhandledPromiseRejection/i);
    expect(unhandled).toBeNull();
  });

  test('idempotent: show and bootstrap counts stay at 1 well after startup settles', async () => {
    await waitForMark(capture, 'trainer-catalog-bootstrap-done', 15_000).catch(() => {
      // Bootstrap completion is network-bound and may not finish within the
      // wait window on a slow/offline connection; the count check below is
      // what matters here, not completion.
    });
    await new Promise((r) => setTimeout(r, 1_000));
    const showMarks = capture.marks.filter((m) => m === 'ready-to-show' || m === 'ready-to-show-fallback-timeout');
    const bootstrapStarts = capture.marks.filter((m) => m === 'trainer-catalog-bootstrap-start');
    expect(showMarks.length).toBe(1);
    expect(bootstrapStarts.length).toBe(1);
  });
});

// ── Fallback path: real load, but fallback bound forced to win the race ────

test.describe('fallback path (fallback bound forced below real ready-to-show time)', () => {
  let app: ElectronApplication;
  let capture: Capture;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_BUNDLE],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_PATH: tempUserData('fallback'),
        NODE_ENV: 'test',
        SOLITH_STARTUP_TRACE: '1',
        // A real renderer cannot signal ready-to-show in 1ms — this forces
        // the fallback branch of showOnce() to win deterministically while
        // still exercising a real BrowserWindow + real navigation, so
        // Playwright's window-attach detection keeps working.
        SOLITH_READY_TO_SHOW_TIMEOUT_MS: '1',
      },
    });
    capture = captureOutput(app);
    await app.firstWindow();
    await waitForMark(capture, 'ready-to-show-fallback-timeout', 30_000);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test('window becomes visible via the fallback timeout, not a real ready-to-show', async () => {
    expect(await isMainWindowVisible(app)).toBe(true);
    expect(capture.marks).not.toContain('ready-to-show');
  });

  test('deferred catalog bootstrap starts exactly once, via the fallback path', async () => {
    await waitForMark(capture, 'trainer-catalog-bootstrap-start', 5_000);
    const startCount = capture.marks.filter((m) => m === 'trainer-catalog-bootstrap-start').length;
    expect(startCount).toBe(1);
    const fallbackIdx = capture.marks.indexOf('ready-to-show-fallback-timeout');
    const bootstrapIdx = capture.marks.indexOf('trainer-catalog-bootstrap-start');
    expect(bootstrapIdx).toBeGreaterThan(fallbackIdx);
  });

  test('no duplicate show or bootstrap once the real renderer catches up', async () => {
    // The real 'ready-to-show' event will still fire internally at some
    // point after the fallback already won — showOnce()'s `shown` guard
    // must swallow it as a no-op.
    await new Promise((r) => setTimeout(r, 2_000));
    const showMarks = capture.marks.filter((m) => m === 'ready-to-show' || m === 'ready-to-show-fallback-timeout');
    const bootstrapMarks = capture.marks.filter((m) => m === 'trainer-catalog-bootstrap-start');
    expect(showMarks.length).toBe(1);
    expect(bootstrapMarks.length).toBe(1);
  });
});

// ── Destroyed-window path: destroy before the fallback fires ───────────────

test.describe('destroyed-window path (destroyed before the fallback bound elapses)', () => {
  test('destroying the window before the fallback fires does not throw, and the fallback becomes a no-op', async () => {
    const app = await electron.launch({
      args: [MAIN_BUNDLE],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_PATH: tempUserData('destroyed'),
        NODE_ENV: 'test',
        SOLITH_STARTUP_TRACE: '1',
        // Generous window between window construction and fallback so the
        // synchronous destroy() below reliably happens first.
        SOLITH_READY_TO_SHOW_TIMEOUT_MS: '4000',
      },
    });
    const capture = captureOutput(app);
    let uncaught = '';
    app.process().stderr?.on('data', (buf: Buffer) => { uncaught += buf.toString('utf8'); });

    await app.firstWindow();
    await waitForMark(capture, 'browserwindow-constructed', 10_000);
    expect(await mainWindowExists(app)).toBe(true);

    // destroy() is synchronous and immediate (unlike close(), which is async
    // and can be intercepted) — this maximizes the chance of winning the
    // race against both the real ready-to-show and the 4s fallback.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.destroy();
    });

    // Wait past the fallback bound to prove the (now-cleared) timer does not
    // throw when it would otherwise have fired against a destroyed window.
    await new Promise((r) => setTimeout(r, 4_500));

    expect(uncaught).not.toMatch(/Uncaught|Object has been destroyed/i);
    expect(capture.marks).not.toContain('ready-to-show-fallback-timeout');

    await app.close().catch(() => {});
  });
});
