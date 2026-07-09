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
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (!cheatSystemInitialized) {
      initializeCheatSystem();
      cheatSystemInitialized = true;
    }
  }, []);

  useEffect(() => {
    window.electronAPI
      .getSettings()
      .then((s: any) => setFeatureEnabled(!!s?.v2LiveModeEnabled))
      .catch(() => setFeatureEnabled(false));
  }, []);

  const handleEnableFeature = useCallback(async () => {
    setEnabling(true);
    try {
      await window.electronAPI.setSetting('v2LiveModeEnabled', true);
      setFeatureEnabled(true);
    } finally {
      setEnabling(false);
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

  return (
    <div className={styles['page-container']}>
      <header className={styles['page-header']}>
        <h1>Multi-Game Live Trainer</h1>
        <p className={styles['page-subtitle']}>
          One-click cheats for 7 games — Palworld, Atomfall, Stardew Valley, Avowed, Undisputed,
          Dredge, and Crimson Desert
        </p>
      </header>

      {featureEnabled === false && (
        <div className={styles['feature-gate-banner']}>
          <p>
            Live memory access is disabled by default (single-player/offline only, no injection). Enable it to scan
            and write cheats for a running game.
          </p>
          <button className={styles['enable-btn']} onClick={handleEnableFeature} disabled={enabling}>
            {enabling ? 'Enabling…' : 'Enable Live Memory Access'}
          </button>
        </div>
      )}

      <main className={styles['page-content']}>
        {!selectedGame && <GameCheatSelector onGameSelect={handleGameSelect} autoSelectRunning={true} />}

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

            {/* key={gameId} forces a full remount (fresh session hook, fresh
                process handle) on game switch — state from one game's cheats
                must never bleed into another's. */}
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
