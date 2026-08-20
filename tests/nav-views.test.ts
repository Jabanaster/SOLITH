import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_VIEWS, isValidView } from '../src/app/nav-views.js';

describe('isValidView — untrusted notification navigation trust boundary', () => {
  it('accepts every legitimate View id', () => {
    for (const view of ALL_VIEWS) {
      assert.equal(isValidView(view), true, `expected "${view}" to be a valid View`);
    }
  });

  it('rejects an unknown/corrupted persisted view', () => {
    assert.equal(isValidView('not-a-real-view'), false);
    assert.equal(isValidView('../../etc/passwd'), false);
    assert.equal(isValidView('<script>alert(1)</script>'), false);
  });

  it('rejects malformed/empty values without throwing', () => {
    assert.equal(isValidView(''), false);
    assert.equal(isValidView('LIBRARY'), false, 'case-sensitive — must not accept a near-miss');
    assert.equal(isValidView('library '), false, 'must not accept a value with stray whitespace');
  });

  it('has no duplicate entries', () => {
    assert.equal(new Set(ALL_VIEWS).size, ALL_VIEWS.length);
  });
});
