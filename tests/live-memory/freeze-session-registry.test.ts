import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FreezeSessionRegistry, type FreezeSessionAuditEvent } from '../../src/core/live-memory/freeze-session-registry.js';

interface Entry { fn: () => void; delay: number }
function scheduler() {
  const entries: Entry[] = [];
  return {
    scheduler: {
      schedule(fn: () => void, delay: number) {
        const entry = { fn, delay };
        entries.push(entry);
        return entry;
      },
      cancel(handle: unknown) {
        const index = entries.indexOf(handle as Entry);
        if (index >= 0) entries.splice(index, 1);
      },
    },
    fireNext() { entries.shift()?.fn(); },
  };
}

function input(id: string, rendererId = 7, pid = 1234) {
  return {
    freezeSessionId: id,
    rendererId,
    frameId: 1,
    pid,
    startedAt: 1_000,
    expiresAt: 2_000,
    approvalTokenId: `${id}-token`,
  };
}

function makeRegistry(cleanup: (record: unknown) => void = () => {}) {
  const events: FreezeSessionAuditEvent[] = [];
  const timers = scheduler();
  const registry = new FreezeSessionRegistry({
    audit: { emit: (event) => events.push(event) },
    cleanup,
    now: () => 1_000,
    scheduler: timers.scheduler,
  });
  return { registry, events, timers };
}

function activate(registry: FreezeSessionRegistry, id: string) {
  registry.markApproved(id);
  registry.markStarting(id);
  registry.markActive(id);
}

describe('FreezeSessionRegistry', () => {
  test('rejects invalid transitions', () => {
    const { registry } = makeRegistry();
    registry.register(input('one'));
    assert.deepEqual(registry.markActive('one'), { ok: false, code: 'invalid_transition' });
  });

  test('cleanup is idempotent and returns the same terminal state', () => {
    let calls = 0;
    const { registry } = makeRegistry(() => { calls += 1; });
    registry.register(input('one'));
    activate(registry, 'one');
    const first = registry.stopById('one');
    const second = registry.stopById('one');
    assert.equal(calls, 1);
    assert.equal(first.ok && first.record.state, 'STOPPED');
    assert.deepEqual(second, first);
  });

  test('cleanup failure lands in CLEANUP_FAILED and surfaces failure', () => {
    const { registry } = makeRegistry(() => { throw new Error('close failed'); });
    registry.register(input('one'));
    activate(registry, 'one');
    const result = registry.stopById('one');
    assert.equal(result.ok, false);
    assert.equal(registry.get('one')?.state, 'CLEANUP_FAILED');
    assert.equal(registry.get('one')?.cleanupState, 'FAILED');
    assert.equal(!result.ok && result.code, 'cleanup_failed');
  });

  test('stopByRenderer only affects sessions owned by that renderer', () => {
    const { registry } = makeRegistry();
    for (const record of [input('one', 7, 1234), input('two', 8, 1234), input('three', 7, 9999)]) {
      registry.register(record);
      activate(registry, record.freezeSessionId);
    }
    registry.stopByRenderer(7);
    assert.equal(registry.get('one')?.state, 'STOPPED');
    assert.equal(registry.get('three')?.state, 'STOPPED');
    assert.equal(registry.get('two')?.state, 'ACTIVE');
  });

  test('stopAll stops every owned session and expiry auto-stops at the cap', () => {
    const { registry, timers } = makeRegistry();
    registry.register(input('one'));
    activate(registry, 'one');
    timers.fireNext();
    assert.equal(registry.get('one')?.state, 'EXPIRED');

    registry.register(input('two'));
    activate(registry, 'two');
    registry.stopAll('app_quit');
    assert.equal(registry.get('two')?.state, 'STOPPED');
  });
});
