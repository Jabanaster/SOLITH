/**
 * Live-watch confidence heuristic — offline unit coverage of the shared helper.
 * No process attach; no electron; no live memory writes.
 */
import assert from 'node:assert/strict';
import { computeWatchConfidence } from '../src/core/live-memory/watch-confidence';

function testNeverChangedIsLow() {
  const c = computeWatchConfidence({ value: 100, dataType: 'int32', changedCount: 0 }, 20);
  assert.ok(c.score < 40, `expected low score for never-changed, got ${c.score}`);
  assert.ok(c.reasons.some((r) => /Never changed/i.test(r)));
}

function testIntermittentIsHigh() {
  // 4 changes / 20 polls = 0.2 — in the "stat-like" band
  const c = computeWatchConfidence({ value: 85, dataType: 'float', changedCount: 4 }, 20);
  assert.ok(c.score >= 70, `expected high score for intermittent float, got ${c.score}`);
}

function testEveryTickIsPenalized() {
  const c = computeWatchConfidence({ value: 1, dataType: 'int32', changedCount: 19 }, 20);
  assert.ok(c.score < 50, `expected penalty for every-tick churn, got ${c.score}`);
}

function testNegativePenalized() {
  const pos = computeWatchConfidence({ value: 10, dataType: 'float', changedCount: 4 }, 20);
  const neg = computeWatchConfidence({ value: -3, dataType: 'float', changedCount: 4 }, 20);
  assert.ok(neg.score < pos.score, 'negative value should score lower');
}

function testZeroPolls() {
  const c = computeWatchConfidence({ value: 1, dataType: 'int32', changedCount: 0 }, 0);
  assert.equal(c.score, 0);
}

testNeverChangedIsLow();
testIntermittentIsHigh();
testEveryTickIsPenalized();
testNegativePenalized();
testZeroPolls();
console.log('live-watch-confidence: 5/5 PASS');
