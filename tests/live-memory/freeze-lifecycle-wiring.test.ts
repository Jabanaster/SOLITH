import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreezeLifecycleWiring } from '../../src/core/live-memory/freeze-lifecycle-wiring.js';

class Emitter {
  private listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((entry) => entry !== wrapped));
      listener(...args);
    };
    return this.on(event, wrapped);
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}

test('freeze lifecycle cleanup is owner-scoped, idempotent, and covers renderer events', () => {
  const app = new Emitter();
  const webContents = new Emitter() as Emitter & { id: number };
  webContents.id = 42;
  const window = new Emitter() as Emitter & { webContents: typeof webContents };
  window.webContents = webContents;
  const calls: string[] = [];
  const wiring = createFreezeLifecycleWiring(app, {
    stopByRenderer: (id, reason) => calls.push(`${id}:${reason}`),
    stopAll: (reason) => calls.push(`all:${reason}`),
  });

  wiring.wireWindow(window);
  wiring.wireWindow(window);
  webContents.emit('did-start-navigation', {}, 'https://example.test', false, true);
  webContents.emit('did-start-navigation', {}, 'https://example.test/#hash', true, true);
  webContents.emit('render-process-gone');
  webContents.emit('destroyed');
  window.emit('closed');
  app.emit('before-quit');

  assert.deepEqual(calls, [
    '42:navigation_started',
    '42:renderer_crashed',
    '42:renderer_destroyed',
    '42:window_closed',
    'all:app_quit',
  ]);
});
