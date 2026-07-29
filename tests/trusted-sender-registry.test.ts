import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerTrustedWindow,
  unregisterTrustedWindow,
  validateTrustedSender,
  _clearTrustedWindowsForTests,
  _snapshotTrustedWindowsForTests,
} from '../src/core/security/trusted-sender-registry.ts';

describe('trusted-sender-registry', () => {
  beforeEach(() => {
    _clearTrustedWindowsForTests();
  });

  test('accepts a registered window, main frame, allowed URL', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    const result = validateTrustedSender({
      webContentsId: 1,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'file:///app/dist/index.html#/trainer',
    });
    assert.equal(result.ok, true);
    assert.equal(result.windowType, 'main');
  });

  test('rejects a destroyed sender', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    const result = validateTrustedSender({
      webContentsId: 1,
      isDestroyed: true,
      isMainFrame: true,
      frameUrl: 'file:///app/dist/index.html',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'sender_destroyed');
  });

  test('rejects an unknown webContentsId (never registered)', () => {
    const result = validateTrustedSender({
      webContentsId: 999,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'file:///app/dist/index.html',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_sender');
  });

  test('rejects a child/devtools frame (not the main frame)', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    const result = validateTrustedSender({
      webContentsId: 1,
      isDestroyed: false,
      isMainFrame: false,
      frameUrl: 'file:///app/dist/index.html',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_main_frame');
  });

  test('rejects a registered window that has navigated to an unauthorized URL', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    const result = validateTrustedSender({
      webContentsId: 1,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'https://evil.example.com/',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unauthorized_url');
  });

  test('a wrong-window-type sender ID is still rejected as unknown if not registered under that ID', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    // webContentsId 2 was never registered — simulates a completely different, unknown renderer.
    const result = validateTrustedSender({
      webContentsId: 2,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'file:///app/dist/index.html',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_sender');
  });

  test('unregistering a window makes subsequent validation fail as unknown', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    unregisterTrustedWindow(1);
    const result = validateTrustedSender({
      webContentsId: 1,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'file:///app/dist/index.html',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_sender');
  });

  test('a window recreated with a new webContentsId after destruction is not auto-trusted under the old ID', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    unregisterTrustedWindow(1); // simulates the old window being destroyed
    registerTrustedWindow({ webContentsId: 2, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });

    const oldIdResult = validateTrustedSender({
      webContentsId: 1,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'file:///app/dist/index.html',
    });
    const newIdResult = validateTrustedSender({
      webContentsId: 2,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'file:///app/dist/index.html',
    });

    assert.equal(oldIdResult.ok, false);
    assert.equal(oldIdResult.reason, 'unknown_sender');
    assert.equal(newIdResult.ok, true);
  });

  test('multiple window types can be registered independently (main + overlay)', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
    registerTrustedWindow({ webContentsId: 2, windowType: 'wisp-overlay', allowedUrlPrefixes: ['file:///app/dist/index.html'] });

    const mainResult = validateTrustedSender({ webContentsId: 1, isDestroyed: false, isMainFrame: true, frameUrl: 'file:///app/dist/index.html' });
    const overlayResult = validateTrustedSender({ webContentsId: 2, isDestroyed: false, isMainFrame: true, frameUrl: 'file:///app/dist/index.html' });

    assert.equal(mainResult.windowType, 'main');
    assert.equal(overlayResult.windowType, 'wisp-overlay');
    assert.equal(_snapshotTrustedWindowsForTests().length, 2);
  });

  test('dev-server URL prefix is honored when registered (localhost:3000)', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['http://localhost:3000'] });
    const result = validateTrustedSender({
      webContentsId: 1,
      isDestroyed: false,
      isMainFrame: true,
      frameUrl: 'http://localhost:3000/#/trainer',
    });
    assert.equal(result.ok, true);
  });
  test('rejects a trusted but unauthorized window type for a privileged channel', () => {
    registerTrustedWindow({ webContentsId: 2, windowType: 'wisp-overlay', allowedUrlPrefixes: ['file:///trusted/app/index.html'] });
    const result = validateTrustedSender({ webContentsId: 2, isDestroyed: false, isMainFrame: true, frameUrl: 'file:///trusted/app/index.html' }, ['main']);
    assert.deepEqual(result, { ok: false, reason: 'unauthorized_window_type' });
  });

  test('rejects same-prefix and directory-boundary file URL confusion', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///trusted/app/index.html'] });
    for (const frameUrl of [
      'file:///trusted/app-evil/index.html',
      'file:///trusted/app/index.html.evil',
      'file:///trusted/app/sub/index.html',
      'file:///trusted/app/%2e%2e/evil/index.html',
      'file:///trusted/app%5c..%5cevil/index.html',
    ]) {
      assert.equal(validateTrustedSender({ webContentsId: 1, isDestroyed: false, isMainFrame: true, frameUrl }).ok, false, frameUrl);
    }
  });

  test('allows only query/hash variations of the approved file entry', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///trusted/app/index.html'] });
    for (const frameUrl of [
      'file:///trusted/app/index.html#/trainer',
      'file:///trusted/app/index.html?mode=trainer#/route',
    ]) {
      assert.equal(validateTrustedSender({ webContentsId: 1, isDestroyed: false, isMainFrame: true, frameUrl }).ok, true, frameUrl);
    }
  });

  test('rejects malformed and encoded-separator URL variations', () => {
    registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///trusted/app/index.html'] });
    for (const frameUrl of ['not a url', 'file:///trusted/app%2Findex.html', 'file:///trusted/app/%ZZ/index.html']) {
      assert.equal(validateTrustedSender({ webContentsId: 1, isDestroyed: false, isMainFrame: true, frameUrl }).ok, false, frameUrl);
    }
  });
});
