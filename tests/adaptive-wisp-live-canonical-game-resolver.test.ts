import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  liveMemoryAttachmentAgreesWithObservedProcess,
  resolveLiveCanonicalGameIdentity,
  verifyObservedExecutableAgainstGame,
  type WispCanonicalGameLookup,
  type WispRegisteredExecutableIdentity,
  type WispSessionMonitorSnapshotLike,
} from '../src/core/adaptive-wisp/live-canonical-game-resolver.ts';

/**
 * Adaptive Wisp Increment 6 Tasks 1-4 — live canonical-game resolution.
 *
 * Pure unit tests against the resolver's injected dependencies — no
 * SessionMonitorService, no LiveMemorySession, no database. See
 * adaptive-wisp-hotkey-boundary-static.test.ts for the static proof that
 * this file's production counterpart imports neither.
 *
 * Default fixtures assume the OBSERVED process ('game.exe') genuinely
 * belongs to the claimed game (registeredExecutables lists it) and that
 * LiveMemorySession's attached pid (when supplied) matches the observed
 * pid — i.e. the "everything agrees, this should resolve" baseline. Each
 * defect-closing test explicitly breaks exactly one of those agreements.
 */

const DEFAULT_REGISTERED: WispRegisteredExecutableIdentity[] = [{ executablePath: 'C:/Games/Game/game.exe' }];

function snapshot(overrides: Partial<WispSessionMonitorSnapshotLike> = {}): WispSessionMonitorSnapshotLike {
  return {
    state: 'game_running',
    confidence: 'verified',
    gameIdentity: { pid: 1234, startTime: '2026-01-01T00:00:00.000Z', name: 'game.exe', executablePath: 'C:/Games/Game/game.exe' },
    ...overrides,
  };
}

function lookupThatKnows(known: Record<string, { canonicalGameId: string; registeredExecutables?: WispRegisteredExecutableIdentity[] }>): WispCanonicalGameLookup {
  return (candidateId) => {
    const entry = known[candidateId];
    return entry ? { canonicalGameId: entry.canonicalGameId, registeredExecutables: entry.registeredExecutables ?? DEFAULT_REGISTERED } : null;
  };
}

function simpleLookup(known: Record<string, string>): WispCanonicalGameLookup {
  return lookupThatKnows(Object.fromEntries(Object.entries(known).map(([k, v]) => [k, { canonicalGameId: v }])));
}

/** Matches the observed process's own pid by default (agreement baseline). */
const AGREEING_PID = 1234;

describe('Increment 6 — resolveLiveCanonicalGameIdentity', () => {
  test('a recognized, attached, verified game with a matching registered executable and agreeing live-memory pid resolves', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), AGREEING_PID);
    assert.deepEqual(resolved, { gameId: 'canonical:abc', process: { pid: 1234, startTime: '2026-01-01T00:00:00.000Z', name: 'game.exe', executablePath: 'C:/Games/Game/game.exe' } });
  });

  test('an unrecognized candidate id resolves to null — no fuzzy fallback, no best guess', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'unknown-game' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), AGREEING_PID);
    assert.equal(resolved, null);
  });

  test('no snapshot at all (monitor never started) resolves to null', () => {
    const resolved = resolveLiveCanonicalGameIdentity(null, { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), null);
    assert.equal(resolved, null);
  });

  test('no config (monitor running with no start config recorded) resolves to null', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), null, simpleLookup({ 'raw-game-1': 'canonical:abc' }), AGREEING_PID);
    assert.equal(resolved, null);
  });

  test('no live process identity (gameIdentity null) resolves to null even if state/config look attached', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: null }), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), null);
    assert.equal(resolved, null);
  });

  for (const state of ['idle', 'disabled', 'game_not_running', 'game_exited', 'stale_evidence', 'error', 'stopped']) {
    test(`unattached lifecycle state "${state}" resolves to null`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ state }), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), AGREEING_PID);
      assert.equal(resolved, null);
    });
  }

  for (const state of ['game_running', 'observing', 'external_session_observed', 'solith_session_connected', 'session_ended_game_running']) {
    test(`attached lifecycle state "${state}" is eligible to resolve`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ state }), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), AGREEING_PID);
      assert.equal(resolved?.gameId, 'canonical:abc');
    });
  }

  for (const confidence of ['stale', 'contradictory', 'unavailable']) {
    test(`rejected evidence confidence "${confidence}" resolves to null even in an attached state`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ confidence }), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), AGREEING_PID);
      assert.equal(resolved, null);
    });
  }

  for (const confidence of ['verified', 'observed', 'likely']) {
    test(`accepted evidence confidence "${confidence}" is eligible to resolve`, () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ confidence }), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:abc' }), AGREEING_PID);
      assert.equal(resolved?.gameId, 'canonical:abc');
    });
  }

  test('a game switch (config.gameId changes between calls) resolves the new game, not the old one', () => {
    const lookup = lookupThatKnows({
      'raw-game-1': { canonicalGameId: 'canonical:alpha', registeredExecutables: [{ executablePath: 'C:/Games/Game/game.exe' }] },
      'raw-game-2': { canonicalGameId: 'canonical:beta', registeredExecutables: [{ executablePath: 'C:/Games/Game/game.exe' }] },
    });
    const first = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, lookup, AGREEING_PID);
    const second = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-2' }, lookup, AGREEING_PID);
    assert.equal(first?.gameId, 'canonical:alpha');
    assert.equal(second?.gameId, 'canonical:beta');
  });

  test('detach (snapshot goes null) then reattach to the same game resolves independently, not from stale memory', () => {
    const lookup = simpleLookup({ 'raw-game-1': 'canonical:alpha' });
    const attached = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, lookup, AGREEING_PID);
    assert.equal(attached?.gameId, 'canonical:alpha');
    const detached = resolveLiveCanonicalGameIdentity(null, { gameId: 'raw-game-1' }, lookup, null);
    assert.equal(detached, null);
    const reattached = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: { pid: 5678, startTime: '2026-01-01T00:05:00.000Z', name: 'game.exe', executablePath: 'C:/Games/Game/game.exe' } }), { gameId: 'raw-game-1' }, lookup, 5678);
    assert.deepEqual(reattached, { gameId: 'canonical:alpha', process: { pid: 5678, startTime: '2026-01-01T00:05:00.000Z', name: 'game.exe', executablePath: 'C:/Games/Game/game.exe' } });
  });

  test('PID reuse / process replacement is exposed transparently — the resolver reports whatever process identity the snapshot carries, it does not synthesize or cache its own', () => {
    const lookup = simpleLookup({ 'raw-game-1': 'canonical:alpha' });
    const before = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: { pid: 100, startTime: '2026-01-01T00:00:00.000Z', name: 'game.exe', executablePath: 'C:/Games/Game/game.exe' } }), { gameId: 'raw-game-1' }, lookup, 100);
    const afterReplacement = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: { pid: 100, startTime: '2026-01-01T00:10:00.000Z', name: 'game.exe', executablePath: 'C:/Games/Game/game.exe' } }), { gameId: 'raw-game-1' }, lookup, 100);
    assert.notDeepEqual(before?.process, afterReplacement?.process, 'a new startTime for the same PID (process replaced) must be reported as a different process identity, not conflated with the old one');
  });

  test('an empty candidate gameId (blank config) resolves to null', () => {
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: '' }, simpleLookup({ '': 'canonical:should-never-match' }), AGREEING_PID);
    assert.equal(resolved, null, 'a blank candidate id must never be looked up as if it were a real id');
  });

  test('no substring or fuzzy matching: a lookup that only matches exact strings never resolves a near-miss', () => {
    const lookup: WispCanonicalGameLookup = (candidateId) => (candidateId === 'exact-match-only' ? { canonicalGameId: 'canonical:exact', registeredExecutables: DEFAULT_REGISTERED } : null);
    const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'exact-match-only-extra' }, lookup, AGREEING_PID);
    assert.equal(resolved, null);
  });

  describe('Finding 1 (High) fix — renderer cannot select any valid canonical ID without the observed process actually belonging to it', () => {
    test('renderer supplies a correct ID for a game whose registered executable matches the observed process: resolves', () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:real-game' }), AGREEING_PID);
      assert.equal(resolved?.gameId, 'canonical:real-game');
    });

    test('renderer supplies a wrong-but-VALID ID for a real, different, unrelated game: the observed executable does not match THAT game\'s installations, so it must not resolve', () => {
      const lookup = lookupThatKnows({
        'raw-game-1': { canonicalGameId: 'canonical:unrelated-real-game', registeredExecutables: [{ executablePath: 'C:/Games/OtherGame/other.exe' }] },
      });
      const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, lookup, AGREEING_PID);
      assert.equal(resolved, null, 'a valid canonical ID existing is not sufficient — the attached process must independently belong to that specific game');
    });

    test('a game with zero registered installations never resolves, even with an exact ID match and a genuinely running process', () => {
      const lookup = lookupThatKnows({ 'raw-game-1': { canonicalGameId: 'canonical:undiscovered', registeredExecutables: [] } });
      const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, lookup, AGREEING_PID);
      assert.equal(resolved, null, 'no registered installation data means no trustworthy evidence this game is what is actually running');
    });

    test('renderer ID absent: resolves to null regardless of executable evidence', () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: '' }, simpleLookup({ 'raw-game-1': 'canonical:real-game' }), AGREEING_PID);
      assert.equal(resolved, null);
    });

    test('persisted stale ID (an old config.gameId the renderer never refreshed): still must independently verify against whatever process is CURRENTLY observed', () => {
      // Simulates a renderer that started monitoring "raw-game-1" long ago and never
      // updated config.gameId even though the observed executable is now something else.
      const lookup = lookupThatKnows({
        'raw-game-1': { canonicalGameId: 'canonical:stale-claim', registeredExecutables: [{ executablePath: 'C:/Games/OldGame/old.exe' }] },
      });
      const resolved = resolveLiveCanonicalGameIdentity(snapshot({ gameIdentity: { pid: 999, startTime: '2026-01-01T00:00:00.000Z', name: 'newgame.exe', executablePath: 'C:/Games/NewGame/newgame.exe' } }), { gameId: 'raw-game-1' }, lookup, 999);
      assert.equal(resolved, null, 'stale config.gameId must not be trusted just because it is a valid ID string');
    });
  });

  describe('Finding 2 (Medium) fix — LiveMemorySession attachment must agree with the observed process', () => {
    test('LiveMemorySession attached to a DIFFERENT pid than SessionMonitorService observed: must not resolve', () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:real-game' }), 9999);
      assert.equal(resolved, null, 'two independently-correct subsystems disagreeing on which process is in play must fail closed');
    });

    test('no LiveMemorySession attached at all (null pid): resolution proceeds on SessionMonitorService evidence alone', () => {
      const resolved = resolveLiveCanonicalGameIdentity(snapshot(), { gameId: 'raw-game-1' }, simpleLookup({ 'raw-game-1': 'canonical:real-game' }), null);
      assert.equal(resolved?.gameId, 'canonical:real-game');
    });
  });

  describe('launcher vs actual game process', () => {
    test('a launcher executable that is not in the game\'s own registered executables never resolves as the game', () => {
      const lookup = lookupThatKnows({ 'raw-game-1': { canonicalGameId: 'canonical:real-game', registeredExecutables: [{ processNames: ['RealGame.exe'] }] } });
      const launcherSnapshot = snapshot({ gameIdentity: { pid: 1234, startTime: '2026-01-01T00:00:00.000Z', name: 'GameLauncher.exe', executablePath: 'C:/Launchers/GameLauncher.exe' } });
      const resolved = resolveLiveCanonicalGameIdentity(launcherSnapshot, { gameId: 'raw-game-1' }, lookup, AGREEING_PID);
      assert.equal(resolved, null, 'a launcher must not be mistaken for the actual game process it is not registered as');
    });

    test('the actual game executable (case/path-variant of a registered process name) does resolve', () => {
      const lookup = lookupThatKnows({ 'raw-game-1': { canonicalGameId: 'canonical:real-game', registeredExecutables: [{ processNames: ['RealGame.exe'] }] } });
      const gameSnapshot = snapshot({ gameIdentity: { pid: 1234, startTime: '2026-01-01T00:00:00.000Z', name: 'realgame.exe', executablePath: 'D:/SteamLibrary/RealGame/bin/REALGAME.EXE' } });
      const resolved = resolveLiveCanonicalGameIdentity(gameSnapshot, { gameId: 'raw-game-1' }, lookup, AGREEING_PID);
      assert.equal(resolved?.gameId, 'canonical:real-game');
    });
  });
});

describe('Increment 6 — verifyObservedExecutableAgainstGame (unit)', () => {
  test('matches by executablePath basename, case-insensitively, separator-normalized', () => {
    assert.equal(verifyObservedExecutableAgainstGame({ executablePath: 'C:\\Games\\Foo\\FOO.EXE' }, [{ executablePath: 'c:/games/foo/foo.exe' }]), true);
  });

  test('matches by processNames basename', () => {
    assert.equal(verifyObservedExecutableAgainstGame({ name: 'Foo.exe' }, [{ processNames: ['foo.exe'] }]), true);
  });

  test('no substring matching: "foo.exe" does not match a registered "notfoo.exe"', () => {
    assert.equal(verifyObservedExecutableAgainstGame({ name: 'foo.exe' }, [{ processNames: ['notfoo.exe'] }]), false);
  });

  test('no evidence at all (no name, no path): never matches', () => {
    assert.equal(verifyObservedExecutableAgainstGame({}, [{ processNames: ['foo.exe'] }]), false);
  });

  test('empty registered-executables list: never matches', () => {
    assert.equal(verifyObservedExecutableAgainstGame({ name: 'foo.exe' }, []), false);
  });
});

describe('Increment 6 — liveMemoryAttachmentAgreesWithObservedProcess (unit)', () => {
  test('null liveMemoryAttachedPid always agrees (nothing to cross-check)', () => {
    assert.equal(liveMemoryAttachmentAgreesWithObservedProcess(null, 1234), true);
    assert.equal(liveMemoryAttachmentAgreesWithObservedProcess(null, null), true);
  });

  test('matching pids agree', () => {
    assert.equal(liveMemoryAttachmentAgreesWithObservedProcess(1234, 1234), true);
  });

  test('mismatched pids disagree', () => {
    assert.equal(liveMemoryAttachmentAgreesWithObservedProcess(1234, 5678), false);
  });

  test('observed pid null while live-memory pid is set: disagree (fail closed)', () => {
    assert.equal(liveMemoryAttachmentAgreesWithObservedProcess(1234, null), false);
  });
});
