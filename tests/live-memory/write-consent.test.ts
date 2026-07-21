import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWriteConsent } from '../../src/core/live-memory/write-consent.js';
import { SinglePlayerWaiverStore, SINGLE_PLAYER_WAIVER_COPY } from '../../src/core/live-memory/single-player-waiver.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function evidence(overrides: Partial<RemoteConnectionEvidence> = {}): RemoteConnectionEvidence {
  return {
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateWriteConsent (Trust Shift)', () => {
  test('blocks without waiver even when network is clean', () => {
    const result = evaluateWriteConsent({ userConfirmedOffline: false, remoteConnections: evidence() });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /waiver/i);
  });

  test('allows with waiver when remote connections are present (advisory only)', () => {
    const result = evaluateWriteConsent({
      userConfirmedOffline: true,
      remoteConnections: evidence({ remoteConnectionCount: 9 }),
    });
    assert.equal(result.allowed, true);
    assert.match(result.reason, /advisory/i);
    assert.match(result.reason, /9/);
  });

  test('allows with waiver when evidence unavailable (advisory)', () => {
    const result = evaluateWriteConsent({
      userConfirmedOffline: true,
      remoteConnections: evidence({ availability: 'unavailable' }),
    });
    assert.equal(result.allowed, true);
    assert.match(result.reason, /advisory/i);
  });
});

describe('SinglePlayerWaiverStore', () => {
  test('persists sticky accept and session cache', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-waiver-'));
    const filePath = path.join(dir, 'waiver.json');
    const store = new SinglePlayerWaiverStore(filePath);
    assert.equal(store.isAccepted('avowed'), false);
    store.accept('Avowed');
    assert.equal(store.isAccepted('avowed'), true);
    assert.match(SINGLE_PLAYER_WAIVER_COPY, /memory manipulation/i);

    const reloaded = new SinglePlayerWaiverStore(filePath);
    assert.equal(reloaded.isAccepted('avowed'), true);
  });
});
