import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeRemoteConnections, parsePowerShellConnections } from '../../src/core/live-memory/remote-connection-observer.js';

const NOW = '2026-07-06T00:00:00.000Z';

test('parsePowerShellConnections: empty output means zero connections, available', () => {
  const result = parsePowerShellConnections('', NOW);
  assert.equal(result.availability, 'available');
  assert.equal(result.remoteConnectionCount, 0);
});

test('parsePowerShellConnections: whitespace-only output means zero connections, available', () => {
  const result = parsePowerShellConnections('   \r\n  ', NOW);
  assert.equal(result.availability, 'available');
  assert.equal(result.remoteConnectionCount, 0);
});

test('parsePowerShellConnections: single connection (ConvertTo-Json emits a bare object, not an array)', () => {
  const result = parsePowerShellConnections('{"RemoteAddress":"91.222.185.230"}', NOW);
  assert.equal(result.availability, 'available');
  assert.equal(result.remoteConnectionCount, 1);
});

test('parsePowerShellConnections: multiple connections, this is the real Stardew Valley evidence shape', () => {
  const raw = JSON.stringify([
    { RemoteAddress: '2a04:4e42:5::497' },
    { RemoteAddress: '2a04:4e42:5::497' },
    { RemoteAddress: '91.222.185.230' },
  ]);
  const result = parsePowerShellConnections(raw, NOW);
  assert.equal(result.availability, 'available');
  assert.equal(result.remoteConnectionCount, 3);
});

test('parsePowerShellConnections: loopback remote addresses are excluded from the count', () => {
  const raw = JSON.stringify([
    { RemoteAddress: '127.0.0.1' },
    { RemoteAddress: '::1' },
    { RemoteAddress: '203.0.113.5' },
  ]);
  const result = parsePowerShellConnections(raw, NOW);
  assert.equal(result.availability, 'available');
  assert.equal(result.remoteConnectionCount, 1);
});

test('parsePowerShellConnections: malformed JSON fails closed as an error, not a crash', () => {
  const result = parsePowerShellConnections('not json {{{', NOW);
  assert.equal(result.availability, 'error');
  assert.equal(result.remoteConnectionCount, 0);
  assert.ok(result.error);
});

test('parsePowerShellConnections: entries missing RemoteAddress are skipped, not counted', () => {
  const raw = JSON.stringify([{ SomethingElse: 'x' }, { RemoteAddress: '198.51.100.7' }]);
  const result = parsePowerShellConnections(raw, NOW);
  assert.equal(result.remoteConnectionCount, 1);
});

test('observeRemoteConnections: rejects a non-positive-integer pid before touching the OS', async () => {
  const result = await observeRemoteConnections(-1);
  assert.equal(result.availability, 'error');
  assert.equal(result.error, 'invalid_pid');
});

test('observeRemoteConnections: rejects a non-integer pid before touching the OS', async () => {
  const result = await observeRemoteConnections(1.5);
  assert.equal(result.availability, 'error');
  assert.equal(result.error, 'invalid_pid');
});

test('observeRemoteConnections: rejects pid=0 before touching the OS', async () => {
  const result = await observeRemoteConnections(0);
  assert.equal(result.availability, 'error');
  assert.equal(result.error, 'invalid_pid');
});
