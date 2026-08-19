/**
 * NEW-1 / NEW-2 — trusted-sender + navigation-policy unit coverage.
 *
 * Exercises the REAL production functions (`validateIpcSender`,
 * `applyWindowNavigationPolicy` from electron/sender-validation.ts) against
 * faked Electron shapes. This is legitimate coverage of the actual trust
 * logic (not a reimplementation of it): both functions only take
 * `import type` electron dependencies, so they have zero Electron runtime
 * requirement and can be exercised directly under plain Node. The
 * corresponding real-Electron wiring proof (do the hardened IPC channels and
 * BrowserWindows actually call these functions end-to-end) lives in
 * tests/new1-new2-trust-boundary.e2e.test.ts.
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerTrustedWindow,
  _clearTrustedWindowsForTests,
} from '../src/core/security/trusted-sender-registry.ts';
import { validateIpcSender, applyWindowNavigationPolicy } from '../electron/sender-validation.ts';

// ── Fakes ────────────────────────────────────────────────────────────────────

function fakeFrame(url: string) {
  return { url };
}

function fakeEvent(opts: {
  webContentsId: number;
  destroyed?: boolean;
  senderFrame?: { url: string } | null;
  mainFrame?: { url: string };
}) {
  const mainFrame = opts.mainFrame ?? fakeFrame('http://localhost:3000/');
  return {
    sender: {
      id: opts.webContentsId,
      isDestroyed: () => opts.destroyed ?? false,
      mainFrame,
    },
    senderFrame: opts.senderFrame === undefined ? mainFrame : opts.senderFrame,
  } as any;
}

describe('validateIpcSender (NEW-1 — real function, faked Electron event shape)', () => {
  beforeEach(() => {
    _clearTrustedWindowsForTests();
  });

  test('trusted main-frame sender on an allowed window type passes', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['http://localhost:3000'] });
    const event = fakeEvent({ webContentsId: 1 });
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, true);
    assert.equal(result.windowType, 'main');
  });

  test('child frame (senderFrame !== sender.mainFrame) is rejected', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['http://localhost:3000'] });
    const mainFrame = fakeFrame('http://localhost:3000/');
    const childFrame = fakeFrame('http://localhost:3000/child-iframe');
    const event = fakeEvent({ webContentsId: 1, mainFrame, senderFrame: childFrame });
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_main_frame');
  });

  test('a destroyed sender is rejected before any registry lookup', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['http://localhost:3000'] });
    const event = fakeEvent({ webContentsId: 1, destroyed: true });
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'sender_destroyed');
  });

  test('a stale sender whose frame has already vanished (senderFrame === null) fails closed', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['http://localhost:3000'] });
    const event = fakeEvent({ webContentsId: 1, senderFrame: null });
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'sender_destroyed');
  });

  test('an unregistered window (e.g. a DevTools webContents, never registered) is rejected as unknown', () => {
    // webContentsId 99 was never passed to registerTrustedWindow — simulates DevTools'
    // own distinct WebContents, which this app never registers.
    const event = fakeEvent({ webContentsId: 99 });
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_sender');
  });

  test('a registered-but-wrong window type (Wisp overlay calling a main-only channel) is rejected', () => {
    registerTrustedWindow({ webContentsId: 2, windowType: 'wisp-overlay', allowedUrlPrefixes: ['http://localhost:3000'] });
    const event = fakeEvent({ webContentsId: 2, mainFrame: fakeFrame('http://localhost:3000/') });
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unauthorized_window_type');
  });

  test('a navigated-away main window (frame URL no longer on the allowed origin) is rejected', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['http://localhost:3000'] });
    const navigatedFrame = fakeFrame('https://evil.example.com/');
    const event = fakeEvent({ webContentsId: 1, mainFrame: navigatedFrame, senderFrame: navigatedFrame });
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unauthorized_url');
  });

  test('missing frame identity (both mainFrame and senderFrame absent) fails closed rather than throwing', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['http://localhost:3000'] });
    const event = { sender: { id: 1, isDestroyed: () => false, mainFrame: undefined }, senderFrame: null } as any;
    const result = validateIpcSender(event, ['main']);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'sender_destroyed');
  });
});

// ── applyWindowNavigationPolicy (NEW-2 — real function, faked WebContents) ──

function fakeWebContents() {
  const listeners: Record<string, (...args: any[]) => void> = {};
  let openHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | null = null;
  return {
    on(event: string, cb: (...args: any[]) => void) {
      listeners[event] = cb;
    },
    setWindowOpenHandler(cb: (details: { url: string }) => { action: 'allow' | 'deny' }) {
      openHandler = cb;
    },
    fireWillNavigate(targetUrl: string) {
      let prevented = false;
      listeners['will-navigate']({ preventDefault: () => { prevented = true; } }, targetUrl);
      return prevented;
    },
    fireWindowOpen(url: string) {
      return openHandler!({ url });
    },
  };
}

describe('applyWindowNavigationPolicy (NEW-2 — real function, faked WebContents)', () => {
  const allowedUrlPrefixes = ['http://localhost:3000', 'file:///app/dist/index.html'];

  test('does not block navigation within the allowed dev-server origin', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.equal(wc.fireWillNavigate('http://localhost:3000/#/trainer'), false);
  });

  test('does not block navigation within the allowed packaged file route', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.equal(wc.fireWillNavigate('file:///app/dist/index.html#/trainer'), false);
  });

  test('blocks navigation to an unexpected HTTPS origin', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.equal(wc.fireWillNavigate('https://evil.example.com/'), true);
  });

  test('blocks navigation to an unexpected local file', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.equal(wc.fireWillNavigate('file:///C:/Windows/System32/drivers/etc/hosts'), true);
  });

  test('blocks navigation to a data: URL', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.equal(wc.fireWillNavigate('data:text/html,<h1>evil</h1>'), true);
  });

  test('blocks navigation to a custom-scheme URL', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.equal(wc.fireWillNavigate('solith-evil://payload'), true);
  });

  test('blocks a trusted-looking but wrong-port localhost origin', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.equal(wc.fireWillNavigate('http://localhost:9999/'), true);
  });

  test('denies every window.open / popup request by default', () => {
    const wc = fakeWebContents();
    applyWindowNavigationPolicy(wc as any, allowedUrlPrefixes);
    assert.deepEqual(wc.fireWindowOpen('https://example.com'), { action: 'deny' });
    assert.deepEqual(wc.fireWindowOpen('http://localhost:3000/'), { action: 'deny' });
  });
});
