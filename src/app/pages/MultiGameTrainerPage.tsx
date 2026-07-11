import React, { useEffect, useState, useCallback } from 'react';
import styles from './MultiGameTrainerPage.module.css';
import { GameCheatSelector } from '../components/GameCheatSelector.js';
import { GameSpecificCheatMenu } from '../components/GameSpecificCheatMenu.js';
import { initializeCheatSystem, getGameConfig } from '../../core/cheat-system/index.js';
import { trainerSessionCache } from '../stores/trainerSessionCache.js';
import type { GameConfig } from '../../core/cheat-system/types.js';

let cheatSystemInitialized = false;

export default function MultiGameTrainerPage({ initialGameId }: { initialGameId?: string | null }) {
  const [selectedGame, setSelectedGame] = useState<GameConfig | null>(null);
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  useEffect(() => {
    if (!initialGameId) return;
    const game = getGameConfig(initialGameId);
    if (game) setSelectedGame(game);
  }, [initialGameId]);

  useEffect(() => {
    if (!cheatSystemInitialized) {
      initializeCheatSystem();
      cheatSystemInitialized = true;
    }
  }, []);

  useEffect(() => {
    return () => {
      trainerSessionCache.clearAll();
    };
  }, []);

  const handleGameSelect = useCallback((game: GameConfig) => {
    setSelectedGame(game);
    setUserConfirmedOffline(false);
  }, []);

  const handleToggleOverlay = useCallback(async () => {
    const result = await window.electronAPI?.trainerOverlayToggle?.();
    if (result?.success) {
      setOverlayVisible(!!result.visible);
    }
  }, []);

  return (
    <div className={styles['page-container']}>
      <header className={styles['page-header']}>
        <h1>Live Trainer</h1>
        <p className={styles['page-subtitle']}>
          WeMod-class live memory trainer — auto-detect running games, toggle cheats in-session,
          use Ctrl+Shift+O for the overlay
        </p>
        <div className={styles['header-actions']}>
          <button type="button" className={styles['overlay-btn']} onClick={() => void handleToggleOverlay()}>
            {overlayVisible ? 'Hide Overlay' : 'Show Overlay'} (Ctrl+Shift+O)
          </button>
        </div>
      </header>

      <main className={styles['page-content']}>
        {!selectedGame && <GameCheatSelector onGameSelect={handleGameSelect} autoSelectRunning />}

        {selectedGame && (
          <>
            <div className={styles['back-bar']}>
              <button className={styles['back-btn']} onClick={() => setSelectedGame(null)}>
                ← All Games
              </button>

              <label className={styles['confirm-label']}>
                <input
                  type="checkbox"
                  checked={userConfirmedOffline}
                  onChange={(e) => setUserConfirmedOffline(e.target.checked)}
                />
                <span>I confirm this {selectedGame.name} session is single-player/offline only</span>
              </label>
            </div>

            <GameSpecificCheatMenu
              key={selectedGame.gameId}
              game={selectedGame}
              userConfirmedOffline={userConfirmedOffline}
            />
          </>
        )}
      </main>
    </div>
  );
}
