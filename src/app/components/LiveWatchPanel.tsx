import React, { useEffect, useRef, useState } from 'react';
import styles from './LiveWatchPanel.module.css';
import type { ScanCandidate } from '../hooks/useGameCheatSession.js';

interface WatchRow extends ScanCandidate {
  changedCount: number;
  justChanged: boolean;
}

interface Confidence {
  score: number;
  reasons: string[];
}

/**
 * Scores a candidate using only signals already collected by the poll loop —
 * no event tagging or UI-value matching yet (those are real future upgrades,
 * not built here). A real stat changes sometimes but not every single tick
 * (that's a frame counter/timer) and not never (that's static or the wrong
 * field entirely) — the sweet spot in between is the strongest signal this
 * panel can compute today.
 */
function computeConfidence(row: WatchRow, totalPolls: number): Confidence {
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

interface LiveWatchPanelProps {
  cheatName: string;
  initialCandidates: ScanCandidate[];
  onReadLive: () => Promise<ScanCandidate[]>;
  onConfirm: (candidate: ScanCandidate) => void;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 300;
/** How long a row stays visually flashed after its value changes. */
const FLASH_DURATION_MS = 600;

function confidenceColor(score: number): string {
  if (score >= 70) return '#86efac';
  if (score >= 40) return '#fcd34d';
  return '#fca5a5';
}

/**
 * "Watch Live Values" — live address-list view for Advanced Scan Mode,
 * candidate set that's still too large to narrow by exact-value guessing.
 * Instead of blindly clicking Increased/Decreased and hoping the timing lines
 * up, the user watches every candidate's real value update a few times a
 * second while playing and visually picks the one that's obviously
 * correlated with the change they just caused (a hit landing, stamina spent).
 *
 * Sorted by "times changed" descending by default — a real, active stat
 * changes repeatedly during play; most false-positive candidates from a
 * broad scan are either static or change once as noise, so they sink to the
 * bottom on their own.
 */
export const LiveWatchPanel: React.FC<LiveWatchPanelProps> = ({
  cheatName,
  initialCandidates,
  onReadLive,
  onConfirm,
  onClose,
}) => {
  const [rows, setRows] = useState<WatchRow[]>(() =>
    initialCandidates.map((c) => ({ ...c, changedCount: 0, justChanged: false })),
  );
  const [isPolling, setIsPolling] = useState(true);
  const [totalPolls, setTotalPolls] = useState(0);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!isPolling) return;
    let cancelled = false;

    const tick = async () => {
      const live = await onReadLive();
      if (cancelled) return;

      const liveByAddress = new Map(live.map((c) => [c.address, c.value]));
      setRows((prev) =>
        prev.map((row) => {
          const newValue = liveByAddress.get(row.address);
          if (newValue === undefined) return { ...row, justChanged: false };
          const changed = newValue !== row.value;
          return {
            ...row,
            value: newValue,
            changedCount: row.changedCount + (changed ? 1 : 0),
            justChanged: changed,
          };
        }),
      );
      setTotalPolls((p) => p + 1);
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isPolling, onReadLive]);

  // Clear the flash highlight FLASH_DURATION_MS after each tick, independent of the poll loop.
  useEffect(() => {
    if (!rows.some((r) => r.justChanged)) return;
    const timeout = setTimeout(() => {
      setRows((prev) => prev.map((r) => (r.justChanged ? { ...r, justChanged: false } : r)));
    }, FLASH_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [rows]);

  const scored = rows.map((row) => ({ row, confidence: computeConfidence(row, totalPolls) }));
  const sorted = [...scored].sort((a, b) => b.confidence.score - a.confidence.score);

  return (
    <div className={styles['watch-overlay']}>
      <div className={styles['watch-panel']}>
        <div className={styles['watch-header']}>
          <h3>Watch Live Values — {cheatName}</h3>
          <button className={styles['watch-close-btn']} onClick={onClose}>
            ✕
          </button>
        </div>

        <p className={styles['watch-hint']}>
          {rows.length} candidates, updating {Math.round(1000 / POLL_INTERVAL_MS)}×/sec. Play normally — the row that
          flashes and changes in sync with what you just did (took a hit, threw a punch) is the real one. Sorted by
          confidence score — hover a score to see why.
        </p>

        <div className={styles['watch-controls']}>
          <button className={styles['watch-toggle-btn']} onClick={() => setIsPolling((p) => !p)}>
            {isPolling ? '⏸ Pause' : '▶ Resume'}
          </button>
        </div>

        <div className={styles['watch-table-wrap']}>
          <table className={styles['watch-table']}>
            <thead>
              <tr>
                <th>Address</th>
                <th>Type</th>
                <th>Value</th>
                <th>Changed</th>
                <th>Confidence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ row, confidence }) => (
                <tr key={row.address} className={row.justChanged ? styles['row-flash'] : ''}>
                  <td className={styles['watch-address']}>{row.address}</td>
                  <td className={styles['watch-type']}>{row.dataType ?? '—'}</td>
                  <td className={styles['watch-value']}>{row.value}</td>
                  <td className={styles['watch-count']}>{row.changedCount}</td>
                  <td
                    className={styles['watch-confidence']}
                    style={{ color: confidenceColor(confidence.score) }}
                    title={confidence.reasons.join(' • ')}
                  >
                    {confidence.score}%
                  </td>
                  <td>
                    <button className={styles['watch-use-btn']} onClick={() => onConfirm(row)}>
                      Use this address
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
