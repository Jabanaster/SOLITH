import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Truth table verification test for discriminated union boolean checks
describe('Candidate 1B Discriminant Safety & Fail-Closed Guard Analysis', () => {
  type DiscriminatedResult =
    | { ok: true; value: string }
    | { ok: false; error: { code: string; message: string } };

  function evaluateOriginal(result: any): 'success' | 'denied' {
    if (!result.ok) {
      return 'denied';
    }
    return 'success';
  }

  function evaluateCandidate1B(result: any): 'success' | 'denied' {
    if (result.ok === false) {
      return 'denied';
    }
    return 'success';
  }

  function evaluateSaferAlternative(result: any): 'success' | 'denied' {
    if (result.ok !== true) {
      return 'denied';
    }
    return 'success';
  }

  test('valid ok: true payload evaluates to success across all guards', () => {
    const validOk: DiscriminatedResult = { ok: true, value: 'data' };
    assert.equal(evaluateOriginal(validOk), 'success');
    assert.equal(evaluateCandidate1B(validOk), 'success');
    assert.equal(evaluateSaferAlternative(validOk), 'success');
  });

  test('valid ok: false payload evaluates to denied across all guards', () => {
    const validFail: DiscriminatedResult = { ok: false, error: { code: 'ERR', message: 'failed' } };
    assert.equal(evaluateOriginal(validFail), 'denied');
    assert.equal(evaluateCandidate1B(validFail), 'denied');
    assert.equal(evaluateSaferAlternative(validFail), 'denied');
  });

  test('malformed ok: undefined payload - Candidate 1B FAILS OPEN, Safer Alternative FAILS CLOSED', () => {
    const malformed = { ok: undefined, value: 'unauthorized_access' };
    assert.equal(evaluateOriginal(malformed), 'denied', 'Original !result.ok fails closed');
    assert.equal(evaluateCandidate1B(malformed), 'success', 'VULNERABILITY: Candidate 1B result.ok === false fails open!');
    assert.equal(evaluateSaferAlternative(malformed), 'denied', 'Safer alternative result.ok !== true fails closed');
  });

  test('malformed ok: null payload - Candidate 1B FAILS OPEN, Safer Alternative FAILS CLOSED', () => {
    const malformed = { ok: null, value: 'unauthorized_access' };
    assert.equal(evaluateOriginal(malformed), 'denied');
    assert.equal(evaluateCandidate1B(malformed), 'success');
    assert.equal(evaluateSaferAlternative(malformed), 'denied');
  });

  test('missing ok property - Candidate 1B FAILS OPEN, Safer Alternative FAILS CLOSED', () => {
    const malformed = { value: 'unauthorized_access' };
    assert.equal(evaluateOriginal(malformed), 'denied');
    assert.equal(evaluateCandidate1B(malformed), 'success');
    assert.equal(evaluateSaferAlternative(malformed), 'denied');
  });
});
