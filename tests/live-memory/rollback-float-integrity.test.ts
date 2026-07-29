import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRollbackValue } from '../../src/core/live-memory/live-memory-session.js';

describe('rollback type integrity', () => {
  test('supported integer types compare exactly', () => {
    for (const type of ['byte', 'int32', 'uint32'] as const) {
      assert.deepEqual(compareRollbackValue(type, 42, 42), { comparable: true, equal: true });
      assert.deepEqual(compareRollbackValue(type, 43, 42), { comparable: true, equal: false });
    }
  });
  test('int64 rejects unsafe precision', () => {
    assert.deepEqual(compareRollbackValue('int64', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), { comparable: true, equal: true });
    assert.deepEqual(compareRollbackValue('int64', Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1), { comparable: false, reason: 'unsafe_integer' });
  });
  test('float compares exact float32 encodings', () => {
    assert.deepEqual(compareRollbackValue('float', 0.10000000149011612, 0.1), { comparable: true, equal: true });
    assert.deepEqual(compareRollbackValue('float', 1, 1 + 2 ** -22), { comparable: true, equal: false });
  });
  test('NaN policy is Object.is equality for floats', () => {
    assert.deepEqual(compareRollbackValue('float', NaN, NaN), { comparable: true, equal: true });
    assert.deepEqual(compareRollbackValue('double', NaN, NaN), { comparable: true, equal: true });
  });
  test('signed zero remains distinct', () => {
    assert.deepEqual(compareRollbackValue('float', -0, +0), { comparable: true, equal: false });
    assert.deepEqual(compareRollbackValue('double', -0, +0), { comparable: true, equal: false });
  });
  test('infinities compare by exact sign', () => {
    assert.deepEqual(compareRollbackValue('double', Infinity, Infinity), { comparable: true, equal: true });
    assert.deepEqual(compareRollbackValue('double', Infinity, -Infinity), { comparable: true, equal: false });
  });
  test('integer comparisons reject non-finite and fractional values', () => {
    assert.deepEqual(compareRollbackValue('int32', NaN, NaN), { comparable: false, reason: 'non_finite_integer' });
    assert.deepEqual(compareRollbackValue('uint32', 1.5, 1.5), { comparable: false, reason: 'non_finite_integer' });
  });
  test('unknown types fail closed', () => {
    assert.deepEqual(compareRollbackValue('boolean' as never, 1, 1), { comparable: false, reason: 'unsupported_type' });
  });
});
