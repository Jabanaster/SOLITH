import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { issueGrant, consumeGrant, revokeGrant, revokeGrantsForSession, clearGrantStore } from '../src/core/authority/grants.js';

describe('authority grants — bounded, single-use, expiring', () => {
  beforeEach(() => clearGrantStore());

  test('issued grant consumes exactly once', () => {
    const grant = issueGrant({ capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    const first = consumeGrant(grant.grantId, { capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    assert.equal(first.ok, true);
    const second = consumeGrant(grant.grantId, { capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    assert.equal(second.ok, false);
  });

  test('grant expires after TTL', () => {
    const nowMs = 1_000_000;
    const grant = issueGrant({ capability: 'process.launch', targetIdentifier: 'helper.exe', sessionKey: 'sess-1' }, { ttlMs: 1000, nowMs });
    const result = consumeGrant(grant.grantId, { capability: 'process.launch', targetIdentifier: 'helper.exe', sessionKey: 'sess-1' }, { nowMs: nowMs + 5000 });
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.reason, /expired/i);
  });

  test('grant bound to one target cannot authorize a different target', () => {
    const grant = issueGrant({ capability: 'process.kill', targetIdentifier: 'gameA.exe', sessionKey: 'sess-1' });
    const result = consumeGrant(grant.grantId, { capability: 'process.kill', targetIdentifier: 'gameB.exe', sessionKey: 'sess-1' });
    assert.equal(result.ok, false);
  });

  test('grant bound to one capability cannot authorize a different capability', () => {
    const grant = issueGrant({ capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    const result = consumeGrant(grant.grantId, { capability: 'process.kill', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    assert.equal(result.ok, false);
  });

  test('grant bound to one session cannot be consumed by another session', () => {
    const grant = issueGrant({ capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    const result = consumeGrant(grant.grantId, { capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-2' });
    assert.equal(result.ok, false);
  });

  test('revokeGrant invalidates an unconsumed grant', () => {
    const grant = issueGrant({ capability: 'hook.install', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    assert.equal(revokeGrant(grant.grantId), true);
    const result = consumeGrant(grant.grantId, { capability: 'hook.install', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    assert.equal(result.ok, false);
  });

  test('revokeGrantsForSession clears only that session\'s grants', () => {
    const g1 = issueGrant({ capability: 'process.attach', targetIdentifier: 'a.exe', sessionKey: 'sess-1' });
    const g2 = issueGrant({ capability: 'process.attach', targetIdentifier: 'b.exe', sessionKey: 'sess-2' });
    const revoked = revokeGrantsForSession('sess-1');
    assert.equal(revoked, 1);
    assert.equal(consumeGrant(g1.grantId, { capability: 'process.attach', targetIdentifier: 'a.exe', sessionKey: 'sess-1' }).ok, false);
    assert.equal(consumeGrant(g2.grantId, { capability: 'process.attach', targetIdentifier: 'b.exe', sessionKey: 'sess-2' }).ok, true);
  });

  test('no persistence across "restart" — a fresh store has no memory of prior grants', () => {
    issueGrant({ capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    clearGrantStore(); // simulates process restart (in-memory store is never persisted)
    const result = consumeGrant('any-id', { capability: 'process.attach', targetIdentifier: 'game.exe', sessionKey: 'sess-1' });
    assert.equal(result.ok, false);
  });
});
