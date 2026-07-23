import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveCorrelationWatcher } from '../../src/core/live-memory/live-correlation-watcher.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';

const HANDLE = { pid: 1234, opaque: { fake: true } };

test('LiveCorrelationWatcher scores a candidate that matches a declared decrease event', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 125,
    [0x200n.toString()]: 125,
  });
  const watcher = new LiveCorrelationWatcher({
    driver,
    handle: HANDLE,
    candidates: [
      { id: 'health-real', address: '0x100', value: 125, dataType: 'float', source: 'auto-scan', scanMode: 'exact' },
      { id: 'health-static', address: '0x200', value: 125, dataType: 'float', source: 'auto-scan', scanMode: 'exact' },
    ],
  });

  watcher.pollOnce();
  driver.setValue(0x100n, 88);
  watcher.pollOnce();
  const report = watcher.recordEvent({ kind: 'took_damage', expectedDirection: 'decreased', expectedDelta: 37 });

  assert.equal(report.readOnly, true);
  assert.equal(report.executable, false);
  assert.equal(report.strong[0]?.id, 'health-real');
  assert.ok((report.strong[0]?.score ?? 0) > (report.candidates.find((c) => c.id === 'health-static')?.score ?? 100));
  assert.equal(report.strong[0]?.exactDeltaMatches, 1);
});

test('LiveCorrelationWatcher keeps noisy every-poll values separate from event-correlated candidates', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 725,
    [0x200n.toString()]: 1000,
  });
  const watcher = new LiveCorrelationWatcher({
    driver,
    handle: HANDLE,
    candidates: [
      { id: 'gold-real', address: '0x100', value: 725, dataType: 'int32', source: 'auto-scan', scanMode: 'exact' },
      { id: 'timer-noise', address: '0x200', value: 1000, dataType: 'int32', source: 'auto-scan', scanMode: 'greaterThan' },
    ],
  });

  watcher.pollOnce();
  for (let i = 0; i < 5; i += 1) {
    driver.setValue(0x200n, 1001 + i);
    watcher.pollOnce();
  }

  driver.setValue(0x100n, 710);
  driver.setValue(0x200n, 2000);
  watcher.pollOnce();
  const report = watcher.recordEvent({ kind: 'spent_resource', expectedDirection: 'decreased', expectedDelta: 15 });

  assert.equal(report.strong[0]?.id, 'gold-real');
  const noisy = report.candidates.find((candidate) => candidate.id === 'timer-noise');
  assert.ok(noisy);
  assert.ok(noisy!.score < report.strong[0]!.score);
  assert.ok(noisy!.reasons.some((reason) => /almost every poll/i.test(reason)));
});

test('LiveCorrelationWatcher matches recent decreases even after regen starts before the event click', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 140,
    [0x200n.toString()]: 140,
  });
  const watcher = new LiveCorrelationWatcher({
    driver,
    handle: HANDLE,
    candidates: [
      { id: 'stamina-real', address: '0x100', value: 140, dataType: 'float', source: 'auto-scan', scanMode: 'exact' },
      { id: 'stamina-static', address: '0x200', value: 140, dataType: 'float', source: 'auto-scan', scanMode: 'exact' },
    ],
    eventLookbackMs: 1500,
  });

  watcher.pollOnce();
  driver.setValue(0x100n, 116);
  watcher.pollOnce();
  driver.setValue(0x100n, 119.5);
  watcher.pollOnce();

  const report = watcher.recordEvent({ kind: 'used_stamina', expectedDirection: 'decreased', expectedDelta: 24 });

  assert.equal(report.strong[0]?.id, 'stamina-real');
  assert.equal(report.strong[0]?.exactDeltaMatches, 1);
  assert.deepEqual(report.strong[0]?.recentValues, [140, 140, 116, 119.5]);
  assert.ok(report.strong[0]?.reasons.some((reason) => /lookback/i.test(reason)));
});

test('LiveCorrelationWatcher exposes recent delta trails for UI research without write affordances', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 725,
  });
  const watcher = new LiveCorrelationWatcher({
    driver,
    handle: HANDLE,
    candidates: [
      { id: 'gold-real', address: '0x100', value: 725, dataType: 'int32', source: 'auto-scan', scanMode: 'exact' },
    ],
  });

  watcher.pollOnce();
  driver.setValue(0x100n, 710);
  watcher.pollOnce();
  const report = watcher.getReport();

  assert.equal(report.readOnly, true);
  assert.equal(report.executable, false);
  assert.deepEqual(report.candidates[0]?.recentDeltas, [0, -15]);
  assert.deepEqual(report.candidates[0]?.recentValues, [725, 725, 710]);
});

test('LiveCorrelationWatcher supports mixed value types without collapsing to one data type', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 155,
    [0x200n.toString()]: 155,
  });
  const watcher = new LiveCorrelationWatcher({
    driver,
    handle: HANDLE,
    candidates: [
      { id: 'essence-float', address: '0x100', value: 155, dataType: 'float', source: 'unknown-scan' },
      { id: 'essence-int32', address: '0x200', value: 155, dataType: 'int32', source: 'auto-scan' },
    ],
  });

  watcher.pollOnce();
  driver.setValue(0x100n, 110);
  driver.setValue(0x200n, 155);
  watcher.pollOnce();
  const report = watcher.recordEvent({ kind: 'custom', label: 'cast spell', expectedDirection: 'decreased' });

  assert.equal(report.strong[0]?.id, 'essence-float');
  assert.equal(report.strong[0]?.dataType, 'float');
  assert.equal(report.candidates.find((candidate) => candidate.id === 'essence-int32')?.dataType, 'int32');
});

test('LiveCorrelationWatcher marks unreadable candidates instead of crashing', () => {
  const driver = new FakeMemoryDriver();
  const errors: string[] = [];
  const watcher = new LiveCorrelationWatcher({
    driver,
    handle: HANDLE,
    candidates: [
      { id: 'missing', address: '0x999', value: 1, dataType: 'int32', source: 'manual' },
    ],
    onError: (error) => errors.push(error),
  });

  const report = watcher.pollOnce();

  assert.equal(report.unreadable[0]?.id, 'missing');
  assert.equal(report.totals.unreadable, 1);
  assert.equal(report.totals.polls, 1);
  assert.ok(errors.length > 0);
});
