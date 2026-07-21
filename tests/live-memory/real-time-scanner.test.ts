import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeScanner } from '../../src/core/live-memory/real-time-scanner.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';

const HANDLE = { pid: 1234, opaque: { fake: true } };

test('RealtimeScanner establishes a baseline without isolating immediately', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 140,
  });
  const updates: unknown[] = [];
  let isolated = false;

  const scanner = new RealtimeScanner({
    driver,
    handle: HANDLE,
    candidates: [{ address: '0x100', value: 140 }],
    dataType: 'float',
    pollIntervalMs: 200,
    onCandidateUpdate: (candidates) => updates.push(candidates),
    onIsolated: () => {
      isolated = true;
    },
    onError: assert.fail,
  });

  scanner.pollOnce();

  assert.equal(updates.length, 1);
  assert.equal(isolated, false);
  assert.equal(scanner.getStopReason(), null);
});

test('RealtimeScanner narrows to candidates that changed with gameplay value', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 140,
    [0x200n.toString()]: 140,
    [0x300n.toString()]: 140,
  });
  const updates: { address: string; value: number }[][] = [];

  const scanner = new RealtimeScanner({
    driver,
    handle: HANDLE,
    candidates: [
      { address: '0x100', value: 140 },
      { address: '0x200', value: 140 },
      { address: '0x300', value: 140 },
    ],
    dataType: 'float',
    pollIntervalMs: 200,
    onCandidateUpdate: (candidates) => updates.push(candidates),
    onError: assert.fail,
  });

  scanner.pollOnce();
  driver.setValue(0x100n, 88);
  driver.setValue(0x300n, 88);
  scanner.pollOnce();

  assert.deepEqual(
    updates.at(-1)?.map((candidate) => candidate.address),
    ['0x100', '0x300'],
  );
});

test('RealtimeScanner reports isolation after a changed pool reaches one candidate', () => {
  const driver = new FakeMemoryDriver({
    [0x100n.toString()]: 140,
    [0x200n.toString()]: 140,
  });
  let isolated: { address: string; value: number } | null = null;

  const scanner = new RealtimeScanner({
    driver,
    handle: HANDLE,
    candidates: [
      { address: '0x100', value: 140 },
      { address: '0x200', value: 140 },
    ],
    dataType: 'float',
    pollIntervalMs: 200,
    onCandidateUpdate: () => undefined,
    onIsolated: (candidate) => {
      isolated = candidate;
    },
    onError: assert.fail,
  });

  scanner.pollOnce();
  driver.setValue(0x200n, 88);
  scanner.pollOnce();

  assert.deepEqual(isolated, { address: '0x200', value: 88 });
  assert.equal(scanner.getStopReason(), 'isolated');
  assert.equal(scanner.isActive(), false);
});

test('RealtimeScanner stalls when every candidate becomes unreadable', () => {
  const driver = new FakeMemoryDriver();
  let stalled = false;
  let error = '';

  const scanner = new RealtimeScanner({
    driver,
    handle: HANDLE,
    candidates: [{ address: '0x999', value: 2 }],
    dataType: 'int32',
    pollIntervalMs: 200,
    onCandidateUpdate: assert.fail,
    onStalled: () => {
      stalled = true;
    },
    onError: (message) => {
      error = message;
    },
  });

  scanner.pollOnce();

  assert.equal(stalled, true);
  assert.equal(error, 'All candidates became unreadable');
  assert.equal(scanner.getStopReason(), 'stalled');
});
