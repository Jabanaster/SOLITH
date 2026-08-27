import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  resolveLiveCanonicalGameIdentity,
  type WispCanonicalGameLookup,
  type WispSessionMonitorSnapshotLike,
} from '../src/core/adaptive-wisp/live-canonical-game-resolver.ts';

/**
 * Adaptive Wisp Increment 6 — live canonical-game resolution (Sections
 * "Increment 6 objectives"/"required behavior"/"Increment 6 tests").
 *
 * Pure unit tests against the resolver's injected dependencies — no
 * SessionMonitorService, no database. See adaptive-wisp-hotkey-boundary
 * -static.test.ts for the static proof that this file imports neither.
 */

function snapshot(overrides: Partial<WispSessionMonitorSnapshotLike> = {}): WispSessionMonitorSnapshotLike {
  return {
    state: 'game_running',
    confidence: 'verified',
    gameIdentity: { pid: 1234, startTime: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

function lookupThatKnows(known: Record<string, string>): WispCanonicalGameLookup {
  return (candidateId) => {
    const canonicalGameId = known[candidateId];
    return canonicalGameId ? { canonicalGameId } : null;
  };
}

describe('Increment 6 — resolveLiveCanonicalGameIdentity', () => {
  test('a recognized, attached, verified game resolves to its canonical id and process identity', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
    assert.deepEqual(resolved, { gameId: 'canonical:abc', process: { pid: 1234, startTime: '2026-01-01T00:00:00.000Z' } });
  });

  test('an unrecognized candidate id resolves to null — no fuzzy fallback, no best guess', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'unknown-game' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
    assert.equal(resolved, null);
  });

  test('no snapshot at all (monitor never started) resolves to null', () => {
    const resolved = resolveLiveCanonicalGameIdentity(null, { gameId: 'raw-game-1' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
    assert.equal(resolved, null);
  });

  test('no config (monitor running with no start config recorded) resolves to null', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), null, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
    assert.equal(resolved, null);
  });

  test('no live process identity (gameIdentity null) resolves to null even if state/config look attached', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: null }), { gameId: 'raw-game-1' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
    assert.equal(resolved, null);
  });

  for (const state of ['idle', 'disabled', 'game_not_running', 'game_exited', 'stale_evidence', 'error', 'stopped']) {
    test(`unattached lifecycle state "${state}" resolves to null`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ state }), { gameId: 'raw-game-1' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
      assert.equal(resolved, null);
    });
  }

  for (const state of ['game_running', 'observing', 'external_session_observed', 'solith_session_connected', 'session_ended_game_running']) {
    test(`attached lifecycle state "${state}" is eligible to resolve`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ state }), { gameId: 'raw-game-1' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
      assert.equal(resolved?.gameId, 'canonical:abc');
    });
  }

  for (const confidence of ['stale', 'contradictory', 'unavailable']) {
    test(`rejected evidence confidence "${confidence}" resolves to null even in an attached state`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ confidence }), { gameId: 'raw-game-1' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
      assert.equal(resolved, null);
    });
  }

  for (const confidence of ['verified', 'observed', 'likely']) {
    test(`accepted evidence confidence "${confidence}" is eligible to resolve`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ confidence }), { gameId: 'raw-game-1' }, lookupThatKnows({ 'raw-game-1': 'canonical:abc' }));
      assert.equal(resolved?.gameId, 'canonical:abc');
    });
  }

  test('a game switch (config.gameId changes between calls) resolves the new game, not the old one', () => {
    const lookup = lookupThatKnows({ 'raw-game-1': 'canonical:alpha', 'raw-game-2': 'canonical:beta' });
    const first = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, lookup);
    const second = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-2' }, lookup);
    assert.equal(first?.gameId, 'canonical:alpha');
    assert.equal(second?.gameId, 'canonical:beta');
  });

  test('detach (snapshot goes null) then reattach to the same game resolves independently, not from stale memory', () => {
    const lookup = lookupThatKnows({ 'raw-game-1': 'canonical:alpha' });
    const attached = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, lookup);
    assert.equal(attached?.gameId, 'canonical:alpha');
    const detached = resolveLiveCanonicalGameIdentity(null, { gameId: 'raw-game-1' }, lookup);
    assert.equal(detached, null);
    const reattached = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: { pid: 5678, startTime: '2026-01-01T00:05:00.000Z' } }), { gameId: 'raw-game-1' }, lookup);
    assert.deepEqual(reattached, { gameId: 'canonical:alpha', process: { pid: 5678, startTime: '2026-01-01T00:05:00.000Z' } });
  });

  test('PID reuse / process replacement is exposed transparently — the resolver reports whatever process identity the snapshot carries, it does not synthesize or cache its own', () => {
    const lookup = lookupThatKnows({ 'raw-game-1': 'canonical:alpha' });
    const before = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: { pid: 100, startTime: '2026-01-01T00:00:00.000Z' } }), { gameId: 'raw-game-1' }, lookup);
    const afterReplacement = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: { pid: 100, startTime: '2026-01-01T00:10:00.000Z' } }), { gameId: 'raw-game-1' }, lookup);
    assert.notDeepEqual(before?.process, afterReplacement?.process, 'a new startTime for the same PID (process replaced) must be reported as a different process identity, not conflated with the old one');
  });

  test('an empty candidate gameId (blank config) resolves to null', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: '' }, lookupThatKnows({ '': 'canonical:should-never-match' }));
    assert.equal(resolved, null, 'a blank candidate id must never be looked up as if it were a real id');
  });

  test('no substring or fuzzy matching: a lookup that only matches exact strings never resolves a near-miss', () => {
    const lookup: WispCanonicalGameLookup = (candidateId) => (candidateId === 'exact-match-only' ? { canonicalGameId: 'canonical:exact' } : null);
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'exact-match-only-extra' }, lookup);
    assert.equal(resolved, null);
  });
});
