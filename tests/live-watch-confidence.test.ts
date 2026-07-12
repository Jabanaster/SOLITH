import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

interface WatchRow {
  value: number;
  dataType: string;
  changedCount: number;
}

function computeConfidence(row: WatchRow, totalPolls: number): { score: number } {
  if (totalPolls === 0) return { score: 0 };
  const changeRatio = row.changedCount / totalPolls;
  let score = 50;
  if (row.changedCount === 0) score -= 35;
  else if (changeRatio > 0.85) score -= 25;
  else if (changeRatio >= 0.05 && changeRatio <= 0.6) score += 30;
  else score += 10;
  if (row.dataType === 'float' || row.dataType === 'double') score += 5;
  if (row.value < 0) score -= 20;
  return { score: Math.max(0, Math.min(100, score)) };
}

describe('LiveWatchPanel confidence heuristic', () => {
  test('rewards intermittent changes typical of real stats', () => {
    const result = computeConfidence(
      { value: 87, dataType: 'float', changedCount: 3 },
      10,
    );
    assert.ok(result.score >= 70);
  });

  test('penalizes never-changing candidates', () => {
    const result = computeConfidence(
      { value: 100, dataType: 'int32', changedCount: 0 },
      10,
    );
    assert.ok(result.score < 40);
  });
});
