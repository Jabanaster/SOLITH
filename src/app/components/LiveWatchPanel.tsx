import React, { useEffect, useRef, useState } from 'react';
import styles from './LiveWatchPanel.module.css';
import type { ScanCandidate } from '../hooks/useGameCheatSession.js';
import { computeWatchConfidence } from '../../core/live-memory/watch-confidence.js';

interface WatchRow extends ScanCandidate {
  changedCount: number;
  justChanged: boolean;
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

  const scored = rows.map((row) => ({ row, confidence: computeWatchConfidence(row, totalPolls) }));
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
