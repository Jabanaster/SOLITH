import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConnectionBaseline, listReviewedConnectionBaselines } from '../../src/core/live-memory/game-connection-baselines.js';

test('getConnectionBaseline returns 0 (strict default) for an unreviewed executable', () => {
  assert.equal(getConnectionBaseline('SomeRandomGame.exe'), 0);
});

test('getConnectionBaseline returns the reviewed baseline for Stardew Valley', () => {
  assert.equal(getConnectionBaseline('Stardew Valley.exe'), 5);
});

test('getConnectionBaseline matches case-insensitively', () => {
  assert.equal(getConnectionBaseline('stardew valley.exe'), 5);
  assert.equal(getConnectionBaseline('STARDEW VALLEY.EXE'), 5);
});

test('listReviewedConnectionBaselines includes evidence for every entry', () => {
  const entries = listReviewedConnectionBaselines();
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(entry.executableName.length > 0);
    assert.ok(entry.evidence.length > 0);
    assert.ok(entry.reviewedAt.length > 0);
    assert.ok(entry.acceptedConnectionBaseline >= 0);
  }
});
