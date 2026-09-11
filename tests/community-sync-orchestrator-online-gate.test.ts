import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureCommunitySyncOrchestrator,
  isCommunitySyncPollingActive,
  reconcileCommunitySyncPolling,
  resetCommunitySyncOrchestratorForTests,
  startCommunitySyncPolling,
} from '../electron/community-sync-orchestrator.ts';
import { initDatabase } from '../src/core/database/index.ts';
import { setSetting } from '../src/core/settings/index.ts';
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

/**
 * These tests exercise the orchestrator's REAL default `isEnabled` (which
 * wires in `isOnlineOperationAllowed`), rather than overriding `isEnabled`
 * via configureCommunitySyncOrchestrator like community-sync-orchestrator.test.ts
 * does — that file only proves the orchestrator behaves correctly given
 * whatever `isEnabled` returns. This file proves the master Online Services
 * switch actually reaches that decision through real settings, so the
 * timer/sync-call machinery is not the only thing this project trusts
 * without a real check.
 */
describe('community sync orchestrator respects the Online Services master switch', () => {
  before(async () => {
    await initDatabase();
  });

  afterEach(() => {
    resetCommunitySyncOrchestratorForTests();
    setSetting('onlineServicesEnabled', true);
    setSetting('communitySyncEnabled', false);
  });

  test('onlineServicesEnabled=false blocks sync even when communitySyncEnabled=true', async () => {
    setSetting('onlineServicesEnabled', false);
    setSetting('communitySyncEnabled', true);

    let syncCalls = 0;
    let intervals = 0;
    configureCommunitySyncOrchestrator({
      sync: async () => {
        syncCalls += 1;
        return syncedResult();
      },
      setIntervalFn: ((fn: TimerHandler, ms?: number) => {
        intervals += 1;
        return setInterval(fn, ms) as unknown as NodeJS.Timeout;
      }) as typeof setInterval,
    });

    const result = await startCommunitySyncPolling();
    assert.equal(result, null);
    assert.equal(syncCalls, 0);
    assert.equal(intervals, 0);
    assert.equal(isCommunitySyncPollingActive(), false);

    const reconciled = await reconcileCommunitySyncPolling();
    assert.equal(reconciled, null);
    assert.equal(syncCalls, 0);
    assert.equal(intervals, 0);
  });

  test('onlineServicesEnabled=true and communitySyncEnabled=true allows sync', async () => {
    setSetting('onlineServicesEnabled', true);
    setSetting('communitySyncEnabled', true);

    let syncCalls = 0;
    configureCommunitySyncOrchestrator({
      sync: async () => {
        syncCalls += 1;
        return syncedResult({ imported: 1 });
      },
      setIntervalFn: (() => 1 as unknown as NodeJS.Timeout) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });

    const result = await startCommunitySyncPolling();
    assert.equal(result?.imported, 1);
    assert.equal(syncCalls, 1);
    assert.equal(isCommunitySyncPollingActive(), true);
  });

  test('onlineServicesEnabled=true but communitySyncEnabled=false still blocks sync (per-feature flag still applies)', async () => {
    setSetting('onlineServicesEnabled', true);
    setSetting('communitySyncEnabled', false);

    let syncCalls = 0;
    configureCommunitySyncOrchestrator({
      sync: async () => {
        syncCalls += 1;
        return syncedResult();
      },
    });

    const result = await startCommunitySyncPolling();
    assert.equal(result, null);
    assert.equal(syncCalls, 0);
    assert.equal(isCommunitySyncPollingActive(), false);
  });
});
