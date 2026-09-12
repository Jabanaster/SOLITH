import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCatalogGameIdForExecutable } from '../src/core/live-memory/attach-catalog-verification.js';

/**
 * Mission 20 — the primary attach flow (LiveMemoryTrainerPage.tsx) now
 * sends a best-effort catalogGameId hint at attach time (derived from
 * process-picker.ts's matchedGameId), so the Trainer Deck read bridge's
 * game-binding gate (trainer-deck-read.ts) isn't permanently unusable.
 * This proves the MAIN PROCESS never trusts that hint verbatim — it's
 * independently re-derived from the trusted catalog via matchCatalogProcess
 * before ever reaching LiveMemorySession.attach()'s fingerprint.
 */
const CATALOG = [
  { catalogGameId: 'subnautica', displayName: 'Subnautica', executables: ['Subnautica.exe'] },
  { catalogGameId: 'half-life-2', displayName: 'Half-Life 2', executables: ['hl2.exe'] },
  { catalogGameId: 'stardew-valley', displayName: 'Stardew Valley', executables: ['Stardew Valley.exe'] },
];

function realMatchCatalogProcess(
  processes: Array<{ pid: number; name: string }>,
  catalog: typeof CATALOG,
): { catalogGameId: string } | null {
  for (const proc of processes) {
    const match = catalog.find((entry) => entry.executables.some((exe) => exe.toLowerCase() === proc.name.toLowerCase()));
    if (match) return { catalogGameId: match.catalogGameId };
  }
  return null;
}

describe('verifyCatalogGameIdForExecutable (Mission 20 — attach-time identity verification)', () => {
  test('correct game -> verified, hint accepted', () => {
    const result = verifyCatalogGameIdForExecutable('subnautica', 'Subnautica.exe', 1234, CATALOG, realMatchCatalogProcess);
    assert.equal(result, 'subnautica');
  });

  test('renderer claims a game the executable does not match -> rejected (fail closed)', () => {
    // Renderer says "half-life-2" but the actual attached executable is Subnautica.exe.
    const result = verifyCatalogGameIdForExecutable('half-life-2', 'Subnautica.exe', 1234, CATALOG, realMatchCatalogProcess);
    assert.equal(result, undefined);
  });

  test('cross-game module/executable-name mismatch -> rejected', () => {
    // Executable not in the catalog at all (unknown/unrelated process).
    const result = verifyCatalogGameIdForExecutable('subnautica', 'totally-unrelated.exe', 1234, CATALOG, realMatchCatalogProcess);
    assert.equal(result, undefined);
  });

  test('missing/empty catalogGameId claim against a real executable -> rejected', () => {
    const result = verifyCatalogGameIdForExecutable('', 'Subnautica.exe', 1234, CATALOG, realMatchCatalogProcess);
    assert.equal(result, undefined);
  });

  test('stale/wrong PID does not matter here — verification is executable-name-based, PID is not trusted as identity either', () => {
    // Same executable name, arbitrary PID — verification only cares whether
    // the CLAIMED game matches what the catalog says this executable is.
    // PID reuse/staleness is handled separately by
    // LiveMemorySession.verifyAttachedProcessIdentity() at read time, not here.
    const result = verifyCatalogGameIdForExecutable('subnautica', 'Subnautica.exe', 999999, CATALOG, realMatchCatalogProcess);
    assert.equal(result, 'subnautica');
  });

  test('empty catalog -> always rejected, never crashes', () => {
    const result = verifyCatalogGameIdForExecutable('subnautica', 'Subnautica.exe', 1234, [], realMatchCatalogProcess);
    assert.equal(result, undefined);
  });

  test('case-insensitive executable match still enforces exact catalogGameId agreement', () => {
    const result = verifyCatalogGameIdForExecutable('subnautica', 'SUBNAUTICA.EXE', 1234, CATALOG, realMatchCatalogProcess);
    assert.equal(result, 'subnautica');
    const wrongClaim = verifyCatalogGameIdForExecutable('stardew-valley', 'SUBNAUTICA.EXE', 1234, CATALOG, realMatchCatalogProcess);
    assert.equal(wrongClaim, undefined);
  });
});

describe('verifyCatalogGameIdForExecutable — ambiguous/cross-game collision (Mission 11, certification pass)', () => {
  // Two unrelated titles sharing a generic/shared executable name (e.g. a
  // shared engine launcher DLL wrapper both games happen to use). The real
  // matcher (matchCatalogProcess in process-watcher.ts) deterministically
  // picks the FIRST catalog array entry that matches — it never lets the
  // renderer's claim decide which of the colliding titles "wins". That means
  // an attacker can only ever succeed by claiming exactly the id the matcher
  // already independently picked; claiming the OTHER colliding title always
  // fails closed, so ambiguity can never be leveraged to bind a session to
  // an attacker-chosen wrong game.
  const AMBIGUOUS_CATALOG = [
    { catalogGameId: 'game-a-shares-exe', displayName: 'Game A', executables: ['SharedLauncher.exe'] },
    { catalogGameId: 'game-b-shares-exe', displayName: 'Game B', executables: ['SharedLauncher.exe'] },
  ];

  test('claiming the colliding title the matcher did NOT pick -> rejected (fail closed)', () => {
    const result = verifyCatalogGameIdForExecutable(
      'game-b-shares-exe',
      'SharedLauncher.exe',
      1234,
      AMBIGUOUS_CATALOG,
      realMatchCatalogProcess,
    );
    // realMatchCatalogProcess (like the production matcher) returns the
    // first array match — 'game-a-shares-exe' — so claiming 'game-b' must fail.
    assert.equal(result, undefined);
  });

  test('claiming the colliding title the matcher DID pick succeeds, but this is the matcher\'s own deterministic pick, never the renderer\'s choice', () => {
    const result = verifyCatalogGameIdForExecutable(
      'game-a-shares-exe',
      'SharedLauncher.exe',
      1234,
      AMBIGUOUS_CATALOG,
      realMatchCatalogProcess,
    );
    assert.equal(result, 'game-a-shares-exe');
    // Reversing the catalog array order flips which id is "correct" —
    // proving the outcome is driven by the matcher's own resolution, not by
    // anything the renderer supplied.
    const reversedOrder = [...AMBIGUOUS_CATALOG].reverse();
    const resultAfterReorder = verifyCatalogGameIdForExecutable(
      'game-a-shares-exe',
      'SharedLauncher.exe',
      1234,
      reversedOrder,
      realMatchCatalogProcess,
    );
    assert.equal(resultAfterReorder, undefined, 'the same claim must fail once it is no longer the matcher\'s own pick');
  });

  test('an executable name matching no catalog entry at all -> rejected (fail closed, never a fallback guess)', () => {
    const result = verifyCatalogGameIdForExecutable(
      'game-a-shares-exe',
      'CompletelyUnknown.exe',
      1234,
      AMBIGUOUS_CATALOG,
      realMatchCatalogProcess,
    );
    assert.equal(result, undefined);
  });
});
