import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNITY_SYNC_INTERVAL_MS,
  configureCommunitySyncOrchestrator,
  isCommunitySyncPollingActive,
  reconcileCommunitySyncPolling,
  resetCommunitySyncOrchestratorForTests,
  startCommunitySyncPolling,
  stopCommunitySyncPolling,
} from '../electron/community-sync-orchestrator.ts';
import type { CommunitySyncResult } from '../src/core/trainer-catalog/sync/hub-client.ts';

function syncedResult(partial: Partial<CommunitySyncResult> = {}): CommunitySyncResult {
  return {
    status: 'synced',
    imported: 0,
    skippedUserDefinitions: 0,
    rejected: 0,
    pages: 1,
    maxLocalTimestamp: 0,
    ...partial,
  };
}

describe('community sync orchestrator', () => {
  afterEach(() => {
    resetCommunitySyncOrchestratorForTests();
  });

  test('disabled means zero sync calls and no interval', async () => {
    let syncCalls = 0;
    let intervals = 0;
    const logs: string[] = [];
    configureCommunitySyncOrchestrator({
      isEnabled: () => false,
      sync: async () => {
        syncCalls += 1;
        return syncedResult();
      },
      log: (message) => logs.push(message),
      setIntervalFn: ((fn: TimerHandler, ms?: number) => {
        intervals += 1;
        return setInterval(fn, ms) as unknown as NodeJS.Timeout;
      }) as typeof setInterval,
    });

    const result = await reconcileCommunitySyncPolling();
    assert.equal(result, null);
    assert.equal(syncCalls, 0);
    assert.equal(intervals, 0);
    assert.equal(isCommunitySyncPollingActive(), false);
    assert.deepEqual(logs, ['disabled - timer cleared, zero Hub network']);
  });

  test('enable mounts interval and runs an immediate sync', async () => {
    let syncCalls = 0;
    let intervalMs = 0;
    const handles: Array<ReturnType<typeof setInterval>> = [];
    configureCommunitySyncOrchestrator({
      isEnabled: () => true,
      sync: async () => {
        syncCalls += 1;
        return syncedResult({ imported: 2 });
      },
      setIntervalFn: ((fn: TimerHandler, ms?: number) => {
        intervalMs = Number(ms);
        const handle = setInterval(fn, 60_000);
        handles.push(handle);
        return handle as unknown as NodeJS.Timeout;
      }) as typeof setInterval,
      clearIntervalFn: ((handle: NodeJS.Timeout) => {
        clearInterval(handle as unknown as ReturnType<typeof setInterval>);
      }) as typeof clearInterval,
    });

    const result = await startCommunitySyncPolling();
    assert.equal(result?.imported, 2);
    assert.equal(syncCalls, 1);
    assert.equal(intervalMs, COMMUNITY_SYNC_INTERVAL_MS);
    assert.equal(isCommunitySyncPollingActive(), true);

    stopCommunitySyncPolling();
    for (const handle of handles) clearInterval(handle);
    assert.equal(isCommunitySyncPollingActive(), false);
  });

  test('disable after enable clears the timer', async () => {
    let enabled = true;
    let syncCalls = 0;
    configureCommunitySyncOrchestrator({
      isEnabled: () => enabled,
      sync: async () => {
        syncCalls += 1;
        return syncedResult();
      },
    });

    await startCommunitySyncPolling();
    assert.equal(isCommunitySyncPollingActive(), true);
    assert.equal(syncCalls, 1);

    enabled = false;
    const result = await reconcileCommunitySyncPolling();
    assert.equal(result, null);
    assert.equal(isCommunitySyncPollingActive(), false);
    assert.equal(syncCalls, 1);
  });

  test('overlapping ticks reuse the in-flight promise', async () => {
    let started = 0;
    let finished = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    configureCommunitySyncOrchestrator({
      isEnabled: () => true,
      sync: async () => {
        started += 1;
        await gate;
        finished += 1;
        return syncedResult({ imported: started });
      },
      // Avoid real timers in this test — start only creates the interval handle.
      setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });

    const first = startCommunitySyncPolling();
    const second = startCommunitySyncPolling();
    assert.equal(started, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(finished, 1);
    assert.equal(a?.imported, 1);
    assert.equal(b?.imported, 1);
  });
});
