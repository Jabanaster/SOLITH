/**
 * NEW-1 / NEW-2 — real-Electron trust-boundary wiring proof.
 *
 * Unlike tests/new1-new2-sender-validation.test.ts (which exercises the
 * production trust functions against faked Electron shapes), this file
 * launches the REAL built app (dist-electron/main.js via `npm run
 * build:vite && npm run build:electron` — no electron-builder packaging
 * involved) and drives it through Playwright's real Electron support,
 * mirroring the existing convention in tests/electron.e2e.test.ts.
 *
 * It proves three things end-to-end that the unit tests cannot:
 *  1. (positive control) The six hardened live-memory/injector IPC channels
 *     plus trainer-host-approve-and-write, and — added in the second
 *     corrective pass — in-process-confirm-hook, in-process-rollback-hook,
 *     and trainer-host-rollback (10 channels total) let a legitimate
 *     main-frame caller pass the new sender check and reach the next real
 *     validation layer (session/bundle ownership) — never a
 *     sender_rejected:* error.
 *  2. (negative control — this is the direction that actually proves the
 *     check is wired, not just present in source) The same ten channels,
 *     called from the real Wisp overlay window's own window.electronAPI
 *     (same preload, different registered window type), are genuinely
 *     rejected with sender_rejected:unauthorized_window_type. Deleting the
 *     requireTrustedSender()/validateIpcSender() call from a handler makes
 *     this specific assertion fail — the positive-control tests alone would
 *     not catch that regression.
 *  3. The main window, the Wisp overlay window, and the trainer overlay
 *     window each have a real will-navigate/setWindowOpenHandler guard wired
 *     via applyWindowNavigationPolicy — same-window navigation to anything
 *     outside the registered origin is blocked, and window.open/target=_blank
 *     popups are always denied (except a strictly https: popup, which is
 *     handed to the OS browser via shell.openExternal instead of being
 *     silently dropped — see electron/sender-validation.ts).
 *
 * Run with: npm run test:new1-new2-trust-boundary
 *
 * Documented limitation: this suite only covers the packaged-mode allowed
 * origin (file://.../dist/index.html), since standing up a concurrent Vite
 * dev server is out of scope for this pass. The dev-mode origin
 * (http://localhost:3000) uses the identical isApprovedUrl() match already
 * covered by tests/trusted-sender-registry.test.ts and
 * tests/new1-new2-sender-validation.test.ts.
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const MAIN_BUNDLE = path.join(ROOT, 'dist-electron', 'main.js');

async function launchApp(runLabel: string): Promise<{ app: ElectronApplication; win: Page; userDataDir: string }> {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Electron bundle not found: ${MAIN_BUNDLE}\nRun "npm run build:vite && npm run build:electron" first.`);
  }
  const runId = `${runLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-new1new2-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-new1new2-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      APPDATA: appDataDir,
      USERPROFILE: appDataDir,
      NODE_ENV: 'test',
      SOLITH_PRIVILEGED_CONSENT: 'auto-deny',
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 20_000 });
  return { app, win, userDataDir };
}

async function cleanup(app: ElectronApplication, userDataDir: string): Promise<void> {
  await app.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

test.describe('NEW-2 — main window navigation and popup guards', () => {
  test('legitimate initial packaged load is not blocked', async () => {
    const { app, win, userDataDir } = await launchApp('main-load');
    try {
      expect(win.url()).toMatch(/dist[\\/]index\.html$/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('blocks same-window navigation to an unexpected HTTPS origin', async () => {
    const { app, win, userDataDir } = await launchApp('main-nav-https');
    try {
      const before = win.url();
      await win.evaluate(() => { window.location.href = 'https://example.com/'; });
      await win.waitForTimeout(500);
      expect(win.url()).toBe(before);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('blocks same-window navigation to an unexpected local file', async () => {
    const { app, win, userDataDir } = await launchApp('main-nav-file');
    try {
      const before = win.url();
      await win.evaluate(() => { window.location.href = 'file:///C:/Windows/System32/drivers/etc/hosts'; });
      await win.waitForTimeout(500);
      expect(win.url()).toBe(before);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('blocks same-window navigation to a data: URL', async () => {
    const { app, win, userDataDir } = await launchApp('main-nav-data');
    try {
      const before = win.url();
      await win.evaluate(() => { window.location.href = 'data:text/html,<h1>evil</h1>'; });
      await win.waitForTimeout(500);
      expect(win.url()).toBe(before);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('blocks a trusted-looking but wrong-port localhost origin', async () => {
    const { app, win, userDataDir } = await launchApp('main-nav-localhost-wrong-port');
    try {
      const before = win.url();
      await win.evaluate(() => { window.location.href = 'http://localhost:9999/'; });
      await win.waitForTimeout(500);
      expect(win.url()).toBe(before);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('denies window.open popups', async () => {
    const { app, win, userDataDir } = await launchApp('main-popup-open');
    try {
      await win.evaluate(() => { window.open('https://example.com', '_blank'); });
      await win.waitForTimeout(500);
      expect(app.windows().length).toBe(1);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('denies target="_blank" anchor clicks', async () => {
    const { app, win, userDataDir } = await launchApp('main-popup-target-blank');
    try {
      await win.evaluate(() => {
        const a = document.createElement('a');
        a.href = 'https://example.com';
        a.target = '_blank';
        a.id = 'new1-new2-target-blank-probe';
        document.body.appendChild(a);
        a.click();
      });
      await win.waitForTimeout(500);
      expect(app.windows().length).toBe(1);
    } finally {
      await cleanup(app, userDataDir);
    }
  });
});

test.describe('NEW-2 — overlay window navigation and popup guards', () => {
  test('Wisp overlay window blocks navigation and popups identically to the main window', async () => {
    const { app, win, userDataDir } = await launchApp('wisp-overlay-nav');
    try {
      await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        await window.electronAPI.wispOverlayToggle();
      });
      await win.waitForTimeout(500);
      const overlay = app.windows().find((p) => p.url().includes('#wisp-overlay'));
      expect(overlay, 'Wisp overlay window should have opened').toBeTruthy();
      if (!overlay) return;

      const before = overlay.url();
      await overlay.evaluate(() => { window.location.href = 'https://example.com/'; });
      await overlay.waitForTimeout(500);
      expect(overlay.url()).toBe(before);

      const windowCountBeforePopup = app.windows().length;
      await overlay.evaluate(() => { window.open('https://example.com', '_blank'); });
      await overlay.waitForTimeout(500);
      expect(app.windows().length).toBe(windowCountBeforePopup);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('Trainer overlay window blocks navigation and popups identically to the main window', async () => {
    const { app, win, userDataDir } = await launchApp('trainer-overlay-nav');
    try {
      await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        await window.electronAPI.trainerOverlayToggle();
      });
      await win.waitForTimeout(500);
      const overlay = app.windows().find((p) => p.url().includes('#trainer-overlay'));
      expect(overlay, 'Trainer overlay window should have opened').toBeTruthy();
      if (!overlay) return;

      const before = overlay.url();
      await overlay.evaluate(() => { window.location.href = 'https://example.com/'; });
      await overlay.waitForTimeout(500);
      expect(overlay.url()).toBe(before);

      const windowCountBeforePopup = app.windows().length;
      await overlay.evaluate(() => { window.open('https://example.com', '_blank'); });
      await overlay.waitForTimeout(500);
      expect(app.windows().length).toBe(windowCountBeforePopup);
    } finally {
      await cleanup(app, userDataDir);
    }
  });
});

test.describe('NEW-1 — hardened IPC channels still reach existing consent/process-identity layers for a legitimate main-frame caller', () => {
  test('live-memory-issue-write-consent passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-issue-write-consent');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.liveMemoryIssueWriteConsent({ proposalId: 'nonexistent-proposal' });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('live-memory-confirm-write passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-confirm-write');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.liveMemoryConfirmWrite({ proposalId: 'nonexistent-proposal', consentToken: 'x' });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('in-process-propose-injector-launch passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-propose-injector');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.inProcessProposeInjectorLaunch({
          exePath: 'C:\\nonexistent\\helper.exe',
          userConfirmedOffline: true,
          userApprovedAction: true,
        });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('in-process-issue-injector-consent passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-issue-injector-consent');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.inProcessIssueInjectorConsent({ proposalId: 'nonexistent-proposal' });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('in-process-register-injector-helper passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-register-injector-helper');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.inProcessRegisterInjectorHelper({ exePath: 'C:\\nonexistent\\helper.exe' });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('in-process-confirm-injector-launch passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-confirm-injector');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.inProcessConfirmInjectorLaunch({
          proposalId: 'nonexistent-proposal',
          userApprovedAction: true,
          consentToken: 'x',
        });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('trainer-host-approve-and-write passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-trainer-host-approve');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.trainerHostApproveAndWrite({ proposalId: 'nonexistent-proposal' });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('in-process-confirm-hook passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-confirm-hook');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.inProcessConfirmHook({ proposalId: 'nonexistent-proposal', userApprovedAction: true });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('in-process-rollback-hook passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-rollback-hook');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.inProcessRollbackHook();
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });

  test('trainer-host-rollback passes the sender check and fails on business logic, not sender_rejected', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-trainer-host-rollback');
    try {
      const result = await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        return window.electronAPI.trainerHostRollback({
          gameId: 'nonexistent-game',
          filePath: 'C:\\nonexistent\\save.dat',
          backupPath: 'C:\\nonexistent\\save.dat.bak',
          field: 'nonexistent-field',
        });
      });
      expect(result.success).toBe(false);
      expect(String(result.error)).not.toMatch(/^sender_rejected:/);
    } finally {
      await cleanup(app, userDataDir);
    }
  });
});

test.describe('NEW-1 — negative control: the same hardened channels genuinely reject a real, differently-registered sender', () => {
  test('all 10 hardened channels reject the Wisp overlay window with sender_rejected:unauthorized_window_type', async () => {
    const { app, win, userDataDir } = await launchApp('ipc-negative-control-overlay');
    try {
      await win.evaluate(async () => {
        // @ts-expect-error electronAPI is the real preload bridge
        await window.electronAPI.wispOverlayToggle();
      });
      await win.waitForTimeout(500);
      const overlay = app.windows().find((p) => p.url().includes('#wisp-overlay'));
      expect(overlay, 'Wisp overlay window should have opened').toBeTruthy();
      if (!overlay) return;

      // The overlay shares the exact same preload/electronAPI surface as the main
      // window (electron/wisp-overlay.ts uses the same preload.cjs) — this is a
      // REAL sender (registered as windowType 'wisp-overlay'), not a fake. Every
      // one of these calls must be rejected before reaching any business logic,
      // proving the requireTrustedSender/validateIpcSender(event, ['main']) call
      // is genuinely wired into each handler.
      const calls: Array<() => Promise<unknown>> = [
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.liveMemoryIssueWriteConsent({ proposalId: 'x' })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.liveMemoryConfirmWrite({ proposalId: 'x', consentToken: 'x' })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.inProcessProposeInjectorLaunch({ exePath: 'x', userConfirmedOffline: true, userApprovedAction: true })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.inProcessIssueInjectorConsent({ proposalId: 'x' })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.inProcessRegisterInjectorHelper({ exePath: 'x' })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.inProcessConfirmInjectorLaunch({ proposalId: 'x', userApprovedAction: true, consentToken: 'x' })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.trainerHostApproveAndWrite({ proposalId: 'x' })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.inProcessConfirmHook({ proposalId: 'x', userApprovedAction: true })),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.inProcessRollbackHook()),
        () => overlay.evaluate(() =>
          // @ts-expect-error electronAPI is the real preload bridge
          window.electronAPI.trainerHostRollback({
            gameId: 'x', filePath: 'C:\\x\\save.dat', backupPath: 'C:\\x\\save.dat.bak', field: 'x',
          })),
      ];

      for (const call of calls) {
        const result: any = await call();
        expect(result.success).toBe(false);
        expect(result.error).toBe('sender_rejected:unauthorized_window_type');
      }
    } finally {
      await cleanup(app, userDataDir);
    }
  });
});
