import React, { useCallback, useEffect, useState } from 'react';
import styles from './TrainerOverlayPage.module.css';
import { initializeCheatSystem } from '../../core/cheat-system/index.js';
import { GameCheatSelector } from '../components/GameCheatSelector.js';
import { GameSpecificCheatMenu } from '../components/GameSpecificCheatMenu.js';
import type { GameConfig } from '../../core/cheat-system/types.js';

let cheatSystemInitialized = false;

export default function TrainerOverlayPage() {
  const [selectedGame, setSelectedGame] = useState<GameConfig | null>(null);
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);

  useEffect(() => {
    if (!cheatSystemInitialized) {
      initializeCheatSystem();
      cheatSystemInitialized = true;
    }
  }, []);

  const handleHide = useCallback(async () => {
    await window.electronAPI?.trainerOverlayHide?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onTrainerHotkey?.((payload: { action: string }) => {
      if (payload.action === 'hide_overlay') {
        void handleHide();
      }
    });
    return () => unsubscribe?.();
  }, [handleHide]);

  return (
    <div className={styles['overlay-root']}>
      <header className={styles['overlay-header']}>
        <div>
          <h1>Solith Overlay</h1>
          <p>Ctrl+Shift+O toggle · Ctrl+Shift+\ hide</p>
        </div>
        <button type="button" className={styles['close-btn']} onClick={() => void handleHide()} aria-label="Hide overlay">
          ×
        </button>
      </header>

      {!selectedGame && (
        <GameCheatSelector onGameSelect={setSelectedGame} autoSelectRunning />
      )}

      {selectedGame && (
        <>
          <div className={styles['toolbar']}>
            <button type="button" className={styles['back-btn']} onClick={() => setSelectedGame(null)}>
              ← Games
            </button>
            <label className={styles['offline-check']}>
              <input
                type="checkbox"
                checked={userConfirmedOffline}
                onChange={(e) => setUserConfirmedOffline(e.target.checked)}
              />
              <span>Offline / single-player confirmed</span>
            </label>
          </div>
          <div className={styles['cheat-panel']}>
            <GameSpecificCheatMenu
              key={selectedGame.gameId}
              game={selectedGame}
              userConfirmedOffline={userConfirmedOffline}
            />
          </div>
        </>
      )}
    </div>
  );
}
