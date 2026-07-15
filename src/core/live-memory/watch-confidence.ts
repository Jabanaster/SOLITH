/**
 * Confidence heuristic for live-watch poll rows.
 * Shared by LiveWatchPanel UI and unit tests (no React dependency).
 */

export interface WatchConfidenceInput {
  value: number;
  dataType?: string;
  changedCount: number;
}

export interface WatchConfidence {
  score: number;
  reasons: string[];
}

export function computeWatchConfidence(row: WatchConfidenceInput, totalPolls: number): WatchConfidence {
  if (totalPolls === 0) return { score: 0, reasons: ['Not enough data yet'] };

  const changeRatio = row.changedCount / totalPolls;
  const reasons: string[] = [];
  let score = 50;

  if (row.changedCount === 0) {
    score -= 35;
    reasons.push('Never changed — likely static, MaxHealth-style, or the wrong field');
  } else if (changeRatio > 0.85) {
    score -= 25;
    reasons.push('Changes almost every tick — likely a timer, frame counter, or animation value');
  } else if (changeRatio >= 0.05 && changeRatio <= 0.6) {
    score += 30;
    reasons.push('Changes intermittently — consistent with a real stat responding to actions');
  } else {
    score += 10;
    reasons.push('Changes occasionally');
  }

  if (row.dataType === 'float' || row.dataType === 'double') {
    score += 5;
    reasons.push('Stored as a decimal type, typical for bars/percentages');
  }

  if (row.value < 0) {
    score -= 20;
    reasons.push('Currently negative — unusual for a health/stamina-style stat');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
