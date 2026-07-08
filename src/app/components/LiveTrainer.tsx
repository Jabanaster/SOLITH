import React, { useEffect, useState } from 'react';
import styles from './LiveTrainer.module.css';
import { useLiveTrainerWorkflow } from '../hooks/useLiveTrainerWorkflow.js';
import type { LiveValueType } from '../../core/live-memory/types.js';

interface LiveTrainerProps {
  gameName: string;
  executable: string;
  dataType: LiveValueType;
  displayName: string;
  userConfirmedOffline: boolean;
}

export const LiveTrainer: React.FC<LiveTrainerProps> = ({
  gameName,
  executable,
  dataType,
  displayName,
  userConfirmedOffline,
}) => {
  const { state, actions } = useLiveTrainerWorkflow({
    processName: executable,
    dataType,
    userConfirmedOffline,
  });

  const [scanValue, setScanValue] = useState<number | ''>('');
  const [narrowValue, setNarrowValue] = useState<number | ''>('');
  const [writeValue, setWriteValue] = useState<number | ''>('');
  const [writeResult, setWriteResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    return () => actions.cleanup();
  }, [actions]);

  const handleStartScan = async () => {
    if (typeof scanValue !== 'number' || scanValue === '') return;
    await actions.startScan(scanValue);
  };

  const handleNarrow = async () => {
    if (typeof narrowValue !== 'number' || narrowValue === '' || state.candidateCount === 0) return;
    await actions.narrowCandidates(narrowValue);
  };

  const handleWrite = async () => {
    if (typeof writeValue !== 'number' || writeValue === '') return;
    const result = await actions.writeValue(writeValue);
    setWriteResult({ success: result.allowed, message: result.reason });
    if (result.allowed && state.confirmedAddress) {
      actions.cacheAddress(state.confirmedAddress, writeValue);
    }
    setTimeout(() => setWriteResult(null), 5000);
  };

  const handleRefreshValue = async () => {
    await actions.readLiveValue();
  };

  return (
    <div className={styles['live-trainer-panel']}>
      <h2>{displayName} Trainer</h2>
      <div className={styles['trainer-status']}>
        <span className={`${styles['status-badge']} ${styles[`status-${state.status}`]}`}>
          {state.status.toUpperCase()}
        </span>
        {state.candidateCount > 0 && (
          <span className={styles['candidate-count']}>{state.candidateCount} candidates</span>
        )}
        {state.confirmedAddress && (
          <span className={styles['confirmed-addr']}>{state.confirmedAddress}</span>
        )}
      </div>

      {state.error && <div className={styles['error-message']}>{state.error}</div>}

      {state.status === 'idle' && (
        <div className={styles['scan-section']}>
          <h3>Step 1: First Scan</h3>
          <p>Enter the current {displayName.toLowerCase()} value in the game:</p>
          <div className={styles['input-group']}>
            <input
              type="number"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={`Current ${displayName.toLowerCase()} value`}
            />
            <button onClick={handleStartScan} disabled={scanValue === ''}>
              Scan
            </button>
          </div>
        </div>
      )}

      {state.status === 'scanning' && state.candidateCount > 0 && (
        <div className={styles['narrow-section']}>
          <h3>Step 2: Narrow Candidates</h3>
          <p>Change the {displayName.toLowerCase()} in-game, then enter the new value:</p>
          <div className={styles['input-group']}>
            <input
              type="number"
              value={narrowValue}
              onChange={(e) => setNarrowValue(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={`New ${displayName.toLowerCase()} value`}
            />
            <button onClick={handleNarrow} disabled={narrowValue === ''}>
              Narrow
            </button>
          </div>
          <p className={styles['candidate-info']}>Currently checking {state.candidateCount} addresses...</p>
        </div>
      )}

      {(state.status === 'narrowing' || state.status === 'confirmed') && state.candidateCount > 0 && (
        <div className={styles['narrow-section']}>
          <p className={styles['candidate-info']}>
            {state.candidateCount === 1
              ? '✓ Address confirmed!'
              : `${state.candidateCount} candidates remaining. Change value again and narrow further.`}
          </p>
          {state.candidateCount > 1 && (
            <div className={styles['input-group']}>
              <input
                type="number"
                value={narrowValue}
                onChange={(e) => setNarrowValue(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={`New ${displayName.toLowerCase()} value`}
              />
              <button onClick={handleNarrow} disabled={narrowValue === ''}>
                Narrow Again
              </button>
            </div>
          )}
        </div>
      )}

      {state.status === 'confirmed' && state.confirmedAddress && (
        <div className={styles['write-section']}>
          <h3>Step 3: Modify Value</h3>
          <div className={styles['current-value']}>
            Current: <strong>{state.liveValue ?? '—'}</strong>
            <button onClick={handleRefreshValue} className={styles['refresh-btn']}>
              ↻
            </button>
          </div>
          <div className={styles['input-group']}>
            <input
              type="number"
              value={writeValue}
              onChange={(e) => setWriteValue(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={`New ${displayName.toLowerCase()} value`}
            />
            <button onClick={handleWrite} disabled={writeValue === ''}>
              Write
            </button>
          </div>
          {writeResult && (
            <div className={`${styles['write-result']} ${styles[writeResult.success ? 'success' : 'error']}`}>
              {writeResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
