import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotifyCatalogUpdate } from '../src/core/notifications/catalogUpdateRule.ts';

describe('shouldNotifyCatalogUpdate', () => {
  test('first-ever successful sync never notifies, even with imports', () => {
    assert.equal(shouldNotifyCatalogUpdate({ hasSyncedBefore: false, importedCount: 5 }), false);
  });

  test('first-ever successful sync with zero imports never notifies', () => {
    assert.equal(shouldNotifyCatalogUpdate({ hasSyncedBefore: false, importedCount: 0 }), false);
  });

  test('later sync with imports notifies', () => {
    assert.equal(shouldNotifyCatalogUpdate({ hasSyncedBefore: true, importedCount: 1 }), true);
  });

  test('later sync with zero imports does not notify', () => {
    assert.equal(shouldNotifyCatalogUpdate({ hasSyncedBefore: true, importedCount: 0 }), false);
  });
});
