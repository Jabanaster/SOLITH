import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAtomfallWispProfileIfLinked, validateWispGameProfile } from '../src/core/adaptive-wisp/index.ts';

/**
 * Increment 6 Tasks 1-4 — certified production profile (Task 4).
 *
 * Schema-validity and provenance checks for the one real, non-fabricated
 * profile this closeout adds. Full end-to-end resolution (including the
 * documented pre-existing cheat-system/schema.v1 catalog gap) is covered
 * by tests/adaptive-wisp-increment6-integration.test.ts.
 */

describe('Increment 6 — buildAtomfallWispProfileIfLinked', () => {
  test('returns null when not linked to a real canonical game', () => {
    assert.equal(buildAtomfallWispProfileIfLinked(null), null);
  });

  test('returns a schema-valid profile when linked', () => {
    const profile = buildAtomfallWispProfileIfLinked('canonical:atomfall-example');
    assert.ok(profile);
    const result = validateWispGameProfile(profile);
    assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.issues));
  });

  test('carries no address, offset, or memory-layout data — Wisp profiles never do', () => {
    const profile = buildAtomfallWispProfileIfLinked('canonical:atomfall-example');
    const json = JSON.stringify(profile);
    assert.ok(!json.includes('0x1959a28'), 'the real bundled offset must never be duplicated into the Wisp profile');
    assert.ok(!/pointerChain/i.test(json));
    assert.ok(!/moduleName/i.test(json));
  });

  test('gameId always matches the linked canonicalGameId exactly — no cross-game binding', () => {
    const profileA = buildAtomfallWispProfileIfLinked('canonical:game-a');
    const profileB = buildAtomfallWispProfileIfLinked('canonical:game-b');
    assert.equal(profileA?.gameId, 'canonical:game-a');
    assert.equal(profileB?.gameId, 'canonical:game-b');
  });

  test('the single action references the real, stable entryId used by both this profile and production composition', () => {
    const profile = buildAtomfallWispProfileIfLinked('canonical:atomfall-example');
    assert.equal(profile?.actions.length, 1);
    assert.equal(profile?.actions[0].entryId, 'atomfall-current-weapon-ammo');
    assert.equal(profile?.actions[0].controlType, 'set');
  });
});
