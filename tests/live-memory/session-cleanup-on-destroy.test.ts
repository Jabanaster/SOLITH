import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { wireSessionCleanupOnDestroy, type DestroyableEmitter } from '../../src/core/live-memory/session-cleanup.ts';

function makeFakeWebContents(): { emitter: DestroyableEmitter; destroy: () => void } {
  const listeners: Array<() => void> = [];
  const emitter: DestroyableEmitter = {
    once(event, listener) {
      if (event === 'destroyed') listeners.push(listener);
      return emitter;
    },
  };
  return {
    emitter,
    destroy: () => listeners.forEach((fn) => fn()),
  };
}

describe('wireSessionCleanupOnDestroy', () => {
  test('invokes the cleanup callback when the emitter fires "destroyed"', () => {
    const { emitter, destroy } = makeFakeWebContents();
    let calls = 0;
    wireSessionCleanupOnDestroy(emitter, () => {
      calls += 1;
    });

    assert.equal(calls, 0, 'cleanup must not run before destroy fires');
    destroy();
    assert.equal(calls, 1);
  });

  test('does not register a second listener for the same emitter across repeated attach cycles', () => {
    const { emitter, destroy } = makeFakeWebContents();
    let calls = 0;
    // Simulates a renderer attaching, detaching, and re-attaching on the same window —
    // bindSessionBundle calls this on every successful attach.
    wireSessionCleanupOnDestroy(emitter, () => { calls += 1; });
    wireSessionCleanupOnDestroy(emitter, () => { calls += 1; });
    wireSessionCleanupOnDestroy(emitter, () => { calls += 1; });

    destroy();

    assert.equal(calls, 1, 'only the first registration should have taken effect');
  });

  test('two different emitters (two windows) are wired independently', () => {
    const a = makeFakeWebContents();
    const b = makeFakeWebContents();
    let aCalls = 0;
    let bCalls = 0;
    wireSessionCleanupOnDestroy(a.emitter, () => { aCalls += 1; });
    wireSessionCleanupOnDestroy(b.emitter, () => { bCalls += 1; });

    a.destroy();

    assert.equal(aCalls, 1);
    assert.equal(bCalls, 0, 'destroying window A must not affect window B');
  });
});
