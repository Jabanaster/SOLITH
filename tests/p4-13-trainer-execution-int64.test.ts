import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  TrainerProposeWriteFeatureSchema,
  TrainerProposeFreezeFeatureSchema,
  TrainerExecuteCompositeSchema,
} from '../electron/ipc-validation.js';

/**
 * P4-13 §19 — int64 IPC precision, schema layer only.
 *
 * `requestedValue`/`value` stay plain `number` everywhere in this stack —
 * that mirrors the pre-existing, untouched Phase 2 write primitives
 * (`MemoryManager.proposeWrite`/`proposeFreeze`, `LiveWriteProposal`/
 * `FreezeProposal` in src/core/live-memory/types.ts), which are out of this
 * stage's scope. What IS fixed here is the transport layer: an optional
 * decimal-string sibling (`requestedValueBigint`/`valueBigint`), matching
 * the established `LiveMemoryScanFirstSchema.targetValueBigint` convention,
 * that carries an exact int64 value with no precision loss through THIS
 * schema boundary. It is not yet threaded into the runtime dispatch call —
 * see the doc comment above `TrainerProposeWriteFeatureSchema` in
 * electron/ipc-validation.ts for the exact remaining boundary.
 */
describe('P4-13 int64 IPC transport — schema layer', () => {
  const BEYOND_MAX_SAFE_INTEGER = '9223372036854775000'; // exceeds Number.MAX_SAFE_INTEGER, fits in int64

  test('TrainerProposeWriteFeatureSchema accepts a valid requestedValueBigint decimal string', () => {
    const parsed = TrainerProposeWriteFeatureSchema.parse({
      featureId: 'gold',
      requestedValue: 9223372036854775000, // lossy display value — real precision carried below
      requestedValueBigint: BEYOND_MAX_SAFE_INTEGER,
    });
    assert.equal(parsed.requestedValueBigint, BEYOND_MAX_SAFE_INTEGER);
    // The exact value survives round-trip through BigInt() untouched by JS number precision loss.
    assert.equal(BigInt(parsed.requestedValueBigint!).toString(), BEYOND_MAX_SAFE_INTEGER);
  });

  test('TrainerProposeWriteFeatureSchema still parses without requestedValueBigint (backward compatible)', () => {
    const parsed = TrainerProposeWriteFeatureSchema.parse({ featureId: 'gold', requestedValue: 5000 });
    assert.equal(parsed.requestedValueBigint, undefined);
  });

  test('TrainerProposeWriteFeatureSchema rejects a malformed requestedValueBigint', () => {
    assert.throws(() =>
      TrainerProposeWriteFeatureSchema.parse({ featureId: 'gold', requestedValue: 5000, requestedValueBigint: 'not-a-number' }),
    );
  });

  test('TrainerProposeFreezeFeatureSchema accepts a valid valueBigint decimal string', () => {
    const parsed = TrainerProposeFreezeFeatureSchema.parse({
      featureId: 'ammo',
      value: 99,
      valueBigint: BEYOND_MAX_SAFE_INTEGER,
    });
    assert.equal(parsed.valueBigint, BEYOND_MAX_SAFE_INTEGER);
  });

  test('composite transaction write/freeze actions accept the same bigint siblings', () => {
    const parsed = TrainerExecuteCompositeSchema.parse({
      id: 'txn-1',
      actions: [
        {
          kind: 'write',
          featureId: 'gold',
          requestedValue: 9223372036854775000,
          requestedValueBigint: BEYOND_MAX_SAFE_INTEGER,
          proposalId: 'prop-1',
          consentToken: randomUUID(),
        },
        {
          kind: 'freeze',
          featureId: 'ammo',
          value: 99,
          valueBigint: '99',
          proposalId: 'prop-2',
          consentToken: randomUUID(),
        },
      ],
    });
    assert.equal((parsed.actions[0] as { requestedValueBigint?: string }).requestedValueBigint, BEYOND_MAX_SAFE_INTEGER);
  });

  test('a negative int64 decimal string round-trips exactly', () => {
    const NEGATIVE = '-9223372036854775000';
    const parsed = TrainerProposeWriteFeatureSchema.parse({
      featureId: 'gold',
      requestedValue: -9223372036854775000,
      requestedValueBigint: NEGATIVE,
    });
    assert.equal(BigInt(parsed.requestedValueBigint!).toString(), NEGATIVE);
  });
});
