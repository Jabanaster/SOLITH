import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWispUserState, WISP_USER_STATE_SCHEMA_VERSION } from '../src/core/adaptive-wisp/index.ts';

/**
 * Increment 3 Section 64 regression — Increment 2 persistence must remain
 * configuration-only. Runtime-binding concepts (sessionId, sessionGeneration,
 * pid, runtimeBinding) must never be accepted into the persisted user-state
 * shape. `WispUserState`'s TypeScript type has no such fields, so normal
 * typed code cannot construct one — the runtime backstop is the same
 * `.strict()` Zod schema Increment 2 already uses on load; this test proves
 * that backstop actually rejects each field, not just that the type system
 * happens to omit them.
 */
describe('Adaptive Wisp user-state schema rejects runtime-binding fields (Increment 3 regression)', () => {
  const base = { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha' };

  for (const [field, value] of [
    ['sessionId', 'wisp-session:1'],
    ['sessionGeneration', 1],
    ['pid', 12345],
    ['runtimeBinding', { actionId: 'a-health', availability: 'available' }],
  ] as const) {
    test(`a top-level "${field}" field is rejected by the strict user-state schema`, () => {
      const result = validateWispUserState({ ...base, [field]: value });
      assert.equal(result.ok, false);
    });

    test(`an override-level "${field}" field is rejected by the strict user-state schema`, () => {
      const result = validateWispUserState({ ...base, override: { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId: 'game-alpha', [field]: value } });
      assert.equal(result.ok, false);
    });
  }

  test('a clean state with no runtime fields is still accepted', () => {
    const result = validateWispUserState({ ...base, selectedProfileId: 'p1' });
    assert.equal(result.ok, true);
  });
});
