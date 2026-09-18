import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveScanTelemetryStore } from '../../src/core/live-memory/adaptive-scan-telemetry-store.js';
import type { ScanTelemetry } from '../../src/core/live-memory/adaptive-scan-planner.js';

function entry(recordedAt: number): ScanTelemetry {
  return {
    strategy: 'BROAD_FULL',
    regionsConsidered: 1,
    regionsScanned: 1,
    regionsSkipped: 0,
    eligibleBytes: 100,
    scannedBytes: 100,
    elapsedMillis: 1,
    resultCount: 1,
    coverage: 'complete',
    partialReads: 0,
    failedReads: 0,
    cancelled: false,
    recordedAt,
  };
}

test('list() returns entries oldest-first in recorded order', () => {
  const store = new AdaptiveScanTelemetryStore();
  store.record(entry(1));
  store.record(entry(2));
  store.record(entry(3));
  assert.deepEqual(
    store.list().map((e) => e.recordedAt),
    [1, 2, 3],
  );
});

test('history is bounded: recording past the cap evicts the oldest entry first (FIFO)', () => {
  const store = new AdaptiveScanTelemetryStore(3);
  store.record(entry(1));
  store.record(entry(2));
  store.record(entry(3));
  store.record(entry(4));
  assert.deepEqual(
    store.list().map((e) => e.recordedAt),
    [2, 3, 4],
  );
});

test('list() returns a defensive copy — mutating the result never affects the store', () => {
  const store = new AdaptiveScanTelemetryStore();
  store.record(entry(1));
  const first = store.list();
  first.push(entry(999));
  assert.equal(store.list().length, 1);
});

test('clear() empties the history', () => {
  const store = new AdaptiveScanTelemetryStore();
  store.record(entry(1));
  store.record(entry(2));
  store.clear();
  assert.deepEqual(store.list(), []);
});
