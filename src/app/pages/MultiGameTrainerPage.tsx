import React, { useEffect, useState, useCallback } from 'react';
import styles from './MultiGameTrainerPage.module.css';
import { GameCheatSelector } from '../components/GameCheatSelector.js';
import { GameSpecificCheatMenu } from '../components/GameSpecificCheatMenu.js';
import { initializeCheatSystem } from '../../core/cheat-system/index.js';
import { trainerSessionCache } from '../stores/trainerSessionCache.js';
import type { GameConfig } from '../../core/cheat-system/types.js';

let cheatSystemInitialized = false;

export default function MultiGameTrainerPage() {
  const [selectedGame, setSelectedGame] = useState<GameConfig | null>(null);
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);

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

  // Reset offline confirmation when switching games — a confirmation for one
  // game's connection profile must not silently carry over to another.
  const handleGameSelect = useCallback((game: GameConfig) => {
    setSelectedGame(game);
    setUserConfirmedOffline(false);
  }, []);

  const handleCheatToggle = useCallback(
    (cheatId: string, enabled: boolean, value: number | string) => {
      // eslint-disable-next-line no-console
      console.log(`[${selectedGame?.name}] toggle ${cheatId} -> ${enabled} (${value})`);
    },
    [selectedGame],
  );

  const handleCheatFreeze = useCallback(
    (cheatId: string, enabled: boolean) => {
      // eslint-disable-next-line no-console
      console.log(`[${selectedGame?.name}] freeze ${cheatId} -> ${enabled}`);
    },
    [selectedGame],
  );

  const handleCheatDiscover = useCallback(
    (cheatId: string) => {
      // eslint-disable-next-line no-console
      console.log(`[${selectedGame?.name}] discover ${cheatId}`);
    },
    [selectedGame],
  );

  const handleValueApply = useCallback(
    (cheatId: string, value: number | string) => {
      // eslint-disable-next-line no-console
      console.log(`[${selectedGame?.name}] apply ${cheatId} = ${value}`);
    },
    [selectedGame],
  );

  return (
    <div className={styles['page-container']}>
      <header className={styles['page-header']}>
        <h1>Multi-Game Live Trainer</h1>
        <p className={styles['page-subtitle']}>
          One-click cheats for 7 games — Palworld, Atomfall, Stardew Valley, Avowed, Undisputed,
          Dredge, and Crimson Desert
        </p>
      </header>

      <main className={styles['page-content']}>
        {!selectedGame && (
          <GameCheatSelector onGameSelect={handleGameSelect} autoSelectRunning={true} />
        )}

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
                <span>
                  I confirm this {selectedGame.name} session is single-player/offline only
                </span>
              </label>
            </div>

            <GameSpecificCheatMenu
              game={selectedGame}
              userConfirmedOffline={userConfirmedOffline}
              onCheatToggle={handleCheatToggle}
              onCheatFreeze={handleCheatFreeze}
              onCheatDiscover={handleCheatDiscover}
              onValueApply={handleValueApply}
            />
          </>
        )}
      </main>
    </div>
  );
}
