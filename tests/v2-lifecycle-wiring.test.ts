/**
 * Deterministic unit tests for the V2 lifecycle-wiring module.
 *
 * All Electron objects (app, BrowserWindow, webContents) are replaced with
 * FakeEventEmitter-based fakes. No Electron process is launched.
 *
 * Tests assert listener counts where possible, not only final monitor state,
 * to prove that registration is exact and disposal is complete.
 *
 * LW-01  successful start records the initiating renderer as owner
 * LW-02  failed start does not change ownership
 * LW-03  explicit stop by owner clears ownership
 * LW-04  owning webContents destruction stops monitoring
 * LW-05  unrelated webContents destruction does not stop monitoring
 * LW-06  owning BrowserWindow close stops monitoring
 * LW-07  application before-quit stops monitoring
 * LW-08  feature disable stops monitoring immediately
 * LW-09  feature disable while already stopped is harmless
 * LW-10  close + destroyed + before-quit is idempotent
 * LW-11  repeated wiring installation does not duplicate global listeners
 * LW-12  wireWindow called twice on same window does not duplicate listeners
 * LW-13  disposer removes registered lifecycle listeners
 * LW-14  ownership is cleared after application shutdown
 * LW-15  restart by the same renderer remains correctly owned
 * LW-16  attempted start by another renderer follows ownership policy
 * LW-17  stale destroyed event from old renderer cannot stop a newer owner
 * LW-18  cleanup invokes monitor.stop() with a reason string
 * LW-19  invalid or destroyed IPC sender is rejected
 * LW-20  disabled feature flag rejects start request
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLifecycleWiring,
  type MonitorHandle,
  type AppLike,
  type BrowserWindowLike,
  type WebContentsLike,
  type StartConfig,
} from '../src/core/v2/lifecycle-wiring.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

class FakeEventEmitter {
  private _listeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();

  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(listener);
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    const arr = this._listeners.get(event);
    if (!arr) return this;
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
    return this;
  }

  emit(event: string): void {
    for (const l of [...(this._listeners.get(event) ?? [])]) l();
  }

  listenerCount(event: string): number {
    return this._listeners.get(event)?.length ?? 0;
  }
}

class FakeApp extends FakeEventEmitter implements AppLike {}

class FakeWebContents extends FakeEventEmitter implements WebContentsLike {
  _destroyed = false;
  constructor(public readonly id: number) { super(); }
  isDestroyed(): boolean { return this._destroyed; }
  destroy(): void {
    this._destroyed = true;
    this.emit('destroyed');
  }
}

class FakeBrowserWindow extends FakeEventEmitter implements BrowserWindowLike {
  constructor(public readonly webContents: FakeWebContents) { super(); }
  close(): void { this.emit('closed'); }
}

class FakeMonitor implements MonitorHandle {
  stops: string[] = [];
  starts: StartConfig[] = [];
  isRunning = false;
  startResult: { success: boolean; error?: string } = { success: true };

  start(config: StartConfig): { success: boolean; error?: string } {
    this.starts.push(config);
    if (this.startResult.success) this.isRunning = true;
    return this.startResult;
  }

  stop(reason = 'test'): void {
    this.stops.push(reason);
    this.isRunning = false;
  }

  getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

const CONFIG: StartConfig = { gameId: 'game-1', executableName: 'game.exe' };

function makeSetup() {
  const monitor = new FakeMonitor();
  const appFake = new FakeApp();
  const wiring = createLifecycleWiring(monitor, appFake);
  return { monitor, app: appFake, wiring };
}

function makeWindow(id = 1): { win: FakeBrowserWindow; wc: FakeWebContents } {
  const wc = new FakeWebContents(id);
  const win = new FakeBrowserWindow(wc);
  return { win, wc };
}

const STARTED = { featureEnabled: true, senderValid: true };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('lifecycle-wiring', () => {

  // LW-01: successful start records the initiating renderer as owner
  it('LW-01: successful start records sender as owner', () => {
    const { wiring } = makeSetup();
    const result = wiring.handleStart(42, CONFIG, STARTED);
    assert.ok(result.success);
    assert.equal(wiring.ownerWebContentsId, 42);
  });

  // LW-02: failed start does not change ownership
  it('LW-02: failed start does not change ownership', () => {
    const { monitor, wiring } = makeSetup();
    monitor.startResult = { success: false, error: 'already running' };
    wiring.handleStart(42, CONFIG, STARTED);
    assert.equal(wiring.ownerWebContentsId, null);
  });

  // LW-03: explicit stop by owner clears ownership
  it('LW-03: owner stop clears ownership', () => {
    const { wiring } = makeSetup();
    wiring.handleStart(42, CONFIG, STARTED);
    wiring.handleStop(42);
    assert.equal(wiring.ownerWebContentsId, null);
  });

  // LW-04: owning webContents destruction stops monitoring
  it('LW-04: owning webContents destruction stops monitoring', () => {
    const { monitor, wiring } = makeSetup();
    const { win, wc } = makeWindow(42);
    wiring.wireWindow(win);
    wiring.handleStart(42, CONFIG, STARTED);

    wc.destroy();

    assert.equal(monitor.stops.length, 1);
    assert.equal(monitor.stops[0], 'renderer_destroyed');
    assert.equal(wiring.ownerWebContentsId, null);
  });

  // LW-05: unrelated webContents destruction does not stop monitoring
  it('LW-05: unrelated webContents destruction does not stop monitoring', () => {
    const { monitor, wiring } = makeSetup();
    const { win: win42 } = makeWindow(42);
    const { win: win99, wc: wc99 } = makeWindow(99);

    wiring.wireWindow(win42);
    wiring.wireWindow(win99);
    wiring.handleStart(42, CONFIG, STARTED);

    // Destroy the unrelated renderer
    wc99.destroy();

    assert.equal(monitor.stops.length, 0, 'unrelated destruction must not stop monitoring');
    assert.equal(wiring.ownerWebContentsId, 42, 'owner unchanged');
  });

  // LW-06: owning BrowserWindow close stops monitoring
  it('LW-06: window close stops monitoring', () => {
    const { monitor, wiring } = makeSetup();
    const { win } = makeWindow(42);
    wiring.wireWindow(win);
    wiring.handleStart(42, CONFIG, STARTED);

    win.close();

    assert.equal(monitor.stops.length, 1);
    assert.equal(monitor.stops[0], 'window_closed');
  });

  // LW-07: application before-quit stops monitoring
  it('LW-07: app before-quit stops monitoring', () => {
    const { monitor, app, wiring } = makeSetup();
    wiring.handleStart(42, CONFIG, STARTED);

    app.emit('before-quit');

    assert.equal(monitor.stops.length, 1);
    assert.equal(monitor.stops[0], 'app_quit');
  });

  // LW-08: feature disable stops monitoring immediately
  it('LW-08: feature disable stops active monitoring', () => {
    const { monitor, wiring } = makeSetup();
    wiring.handleStart(42, CONFIG, STARTED);
    wiring.notifyFeatureChanged(false);

    assert.equal(monitor.stops.length, 1);
    assert.equal(monitor.stops[0], 'feature_disabled');
    assert.equal(wiring.ownerWebContentsId, null);
  });

  // LW-09: feature disable while already stopped is harmless
  it('LW-09: feature disable while stopped is harmless', () => {
    const { monitor, wiring } = makeSetup();
    wiring.notifyFeatureChanged(false);
    assert.equal(monitor.stops.length, 0, 'no stop call when already stopped');
  });

  // LW-10: close + destroyed + before-quit cleanup remains idempotent
  it('LW-10: multiple shutdown signals are idempotent', () => {
    const { monitor, app, wiring } = makeSetup();
    const { win, wc } = makeWindow(42);
    wiring.wireWindow(win);
    wiring.handleStart(42, CONFIG, STARTED);

    win.close();          // → stop('window_closed'), isRunning = false
    wc.destroy();         // → isRunning already false, safeStop is a no-op
    app.emit('before-quit'); // → isRunning already false, safeStop is a no-op

    assert.equal(monitor.stops.length, 1, 'monitor.stop() called exactly once');
  });

  // LW-11: single wiring registers exactly one app-level listener
  it('LW-11: createLifecycleWiring registers exactly one app listener', () => {
    const app = new FakeApp();
    const monitor = new FakeMonitor();
    createLifecycleWiring(monitor, app);
    assert.equal(app.listenerCount('before-quit'), 1,
      'exactly one before-quit listener per wiring instance');
  });

  // LW-12: wireWindow called twice on the same window object does not duplicate listeners
  it('LW-12: wireWindow is idempotent per window object', () => {
    const { wiring } = makeSetup();
    const { win } = makeWindow(42);

    wiring.wireWindow(win);
    wiring.wireWindow(win); // second call — should be a no-op

    assert.equal(win.listenerCount('closed'), 1, 'closed listener registered exactly once');
  });

  // LW-13: disposer removes the registered app lifecycle listener
  it('LW-13: dispose removes before-quit listener', () => {
    const app = new FakeApp();
    const monitor = new FakeMonitor();
    const wiring = createLifecycleWiring(monitor, app);

    assert.equal(app.listenerCount('before-quit'), 1, 'listener present before dispose');
    wiring.dispose();
    assert.equal(app.listenerCount('before-quit'), 0, 'listener removed after dispose');
  });

  // LW-13b: dispose is idempotent — calling twice does not throw
  it('LW-13b: dispose is idempotent (safe to call twice)', () => {
    const app = new FakeApp();
    const monitor = new FakeMonitor();
    const wiring = createLifecycleWiring(monitor, app);

    wiring.dispose();
    assert.doesNotThrow(() => wiring.dispose(), 'second dispose must not throw');
    assert.equal(app.listenerCount('before-quit'), 0, 'listener count stays 0 after double dispose');
  });

  // LW-13c: dispose + before-quit: after dispose, app quit does NOT call monitor.stop()
  it('LW-13c: after dispose, app before-quit no longer stops the monitor', () => {
    const app = new FakeApp();
    const monitor = new FakeMonitor();
    const wiring = createLifecycleWiring(monitor, app);
    wiring.handleStart(42, CONFIG, STARTED);

    wiring.dispose();         // remove the listener
    app.emit('before-quit'); // should be a no-op now

    assert.equal(monitor.stops.length, 0,
      'before-quit must not invoke monitor.stop() after dispose');
  });

  // LW-14: ownership is cleared after application shutdown
  it('LW-14: ownership cleared after app quit', () => {
    const { app, wiring } = makeSetup();
    wiring.handleStart(42, CONFIG, STARTED);
    app.emit('before-quit');
    assert.equal(wiring.ownerWebContentsId, null);
  });

  // LW-15: restart by the same renderer retains correct ownership
  it('LW-15: same renderer can stop and restart, retaining ownership', () => {
    const { monitor, wiring } = makeSetup();
    wiring.handleStart(42, CONFIG, STARTED);
    wiring.handleStop(42);
    wiring.handleStart(42, CONFIG, STARTED);

    assert.equal(wiring.ownerWebContentsId, 42);
    assert.equal(monitor.starts.length, 2, 'start called twice');
  });

  // LW-16: attempted start by another renderer cannot hijack an owned session
  it('LW-16: unrelated renderer cannot hijack an owned session', () => {
    const { monitor, wiring } = makeSetup();
    wiring.handleStart(42, CONFIG, STARTED);

    // Simulate monitor rejecting a second start (already running)
    monitor.startResult = { success: false, error: 'Monitor already running. Stop it first.' };
    const result = wiring.handleStart(99, CONFIG, STARTED);

    assert.equal(result.success, false);
    assert.equal(wiring.ownerWebContentsId, 42, 'ownership remains with renderer 42');
  });

  // LW-17: stale destruction event from an old renderer cannot stop a newer owner
  it('LW-17: stale wc destruction cannot stop a newer owner', () => {
    const { monitor, wiring } = makeSetup();
    const { win: win42, wc: wc42 } = makeWindow(42);
    const { win: win99 } = makeWindow(99);

    // Renderer 42 owns the session, then stops
    wiring.wireWindow(win42);
    wiring.handleStart(42, CONFIG, STARTED);
    wiring.handleStop(42); // explicit stop, ownership cleared

    // Renderer 99 takes over
    wiring.wireWindow(win99);
    wiring.handleStart(99, CONFIG, STARTED);

    // Now wc42's destroyed event fires (stale — the session moved to 99)
    // ownerWebContentsId is 99, not 42, so safeStop must not fire
    wc42.destroy();

    assert.equal(wiring.ownerWebContentsId, 99, 'ownership still belongs to renderer 99');
    // stops: one for handleStop(42) — no extra stop from stale destruction
    assert.equal(monitor.stops.length, 1, 'no extra stop from stale wc destruction');
  });

  // LW-18: cleanup invokes monitor.stop() with a non-empty reason string
  it('LW-18: cleanup calls monitor.stop() with a reason', () => {
    const { monitor, wiring } = makeSetup();
    wiring.handleStart(42, CONFIG, STARTED);
    wiring.notifyFeatureChanged(false);

    assert.ok(monitor.stops.length > 0, 'monitor.stop() invoked');
    assert.ok(monitor.stops[0].length > 0, 'reason is a non-empty string');
  });

  // LW-19: destroyed IPC sender is rejected before touching monitor state
  it('LW-19: invalid sender is rejected without touching monitor', () => {
    const { monitor, wiring } = makeSetup();
    const result = wiring.handleStart(99, CONFIG, {
      featureEnabled: true,
      senderValid: false,  // event.sender.isDestroyed() === true
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /sender_invalid/);
    assert.equal(wiring.ownerWebContentsId, null);
    assert.equal(monitor.starts.length, 0, 'monitor.start() never called for invalid sender');
  });

  // LW-20: disabled feature flag rejects start without calling monitor.start()
  it('LW-20: disabled feature flag rejects start', () => {
    const { monitor, wiring } = makeSetup();
    const result = wiring.handleStart(42, CONFIG, {
      featureEnabled: false,
      senderValid: true,
    });

    assert.equal(result.success, false);
    assert.equal(wiring.ownerWebContentsId, null);
    assert.equal(monitor.starts.length, 0, 'monitor.start() never called when feature disabled');
  });

});
