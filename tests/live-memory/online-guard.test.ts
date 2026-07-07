import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOnlineGuard } from '../../src/core/live-memory/online-guard.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';

function evidence(overrides: Partial<RemoteConnectionEvidence> = {}): RemoteConnectionEvidence {
  return {
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateOnlineGuard', () => {
  test('blocks when user has not confirmed offline play, even with clean evidence', () => {
    const result = evaluateOnlineGuard({ userConfirmedOffline: false, remoteConnections: evidence() });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /not confirmed/i);
  });

  test('allows when user confirmed offline and no remote connections observed', () => {
    const result = evaluateOnlineGuard({ userConfirmedOffline: true, remoteConnections: evidence() });
    assert.equal(result.allowed, true);
  });

  test('blocks when remote connections are present, overriding user confirmation', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ remoteConnectionCount: 2 }),
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /remote connection/i);
  });

  test('fails closed when evidence is unavailable, even with user confirmation', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ availability: 'unavailable' }),
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /could not verify/i);
  });

  test('fails closed on permission_denied evidence', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ availability: 'permission_denied' }),
    });
    assert.equal(result.allowed, false);
  });

  test('fails closed on error evidence', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ availability: 'error' }),
    });
    assert.equal(result.allowed, false);
  });

  // ── Per-game connection baseline (KI-017) ──────────────────────────────────

  test("omitting acceptedConnectionBaseline behaves identically to today's strict policy (no regression)", () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ remoteConnectionCount: 1 }),
    });
    assert.equal(result.allowed, false);
  });

  test('a count at the declared baseline is allowed', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ remoteConnectionCount: 5 }),
      acceptedConnectionBaseline: 5,
    });
    assert.equal(result.allowed, true);
    assert.match(result.reason, /baseline/i);
  });

  test('a count under the declared baseline is allowed', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ remoteConnectionCount: 2 }),
      acceptedConnectionBaseline: 5,
    });
    assert.equal(result.allowed, true);
  });

  test('a count above the declared baseline still blocks', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ remoteConnectionCount: 6 }),
      acceptedConnectionBaseline: 5,
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /baseline of 5/i);
  });

  test('unavailable evidence still fails closed regardless of baseline', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ availability: 'error' }),
      acceptedConnectionBaseline: 5,
    });
    assert.equal(result.allowed, false);
  });

  test('missing user confirmation still blocks regardless of baseline', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: false,
      remoteConnections: evidence({ remoteConnectionCount: 0 }),
      acceptedConnectionBaseline: 5,
    });
    assert.equal(result.allowed, false);
  });

  test('baseline of 0 behaves exactly like the default (any connection blocks)', () => {
    const result = evaluateOnlineGuard({
      userConfirmedOffline: true,
      remoteConnections: evidence({ remoteConnectionCount: 1 }),
      acceptedConnectionBaseline: 0,
    });
    assert.equal(result.allowed, false);
  });
});
