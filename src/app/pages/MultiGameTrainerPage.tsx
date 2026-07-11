import React, { useEffect, useState, useCallback } from 'react';
import styles from './MultiGameTrainerPage.module.css';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { GameCheatSelector } from '../components/GameCheatSelector.js';
import { GameSpecificCheatMenu } from '../components/GameSpecificCheatMenu.js';
import { initializeCheatSystem, getGameConfig, registerGame } from '../../core/cheat-system/index.js';
import { trainerSessionCache } from '../stores/trainerSessionCache.js';
import type { GameConfig } from '../../core/cheat-system/types.js';

let cheatSystemInitialized = false;

export default function MultiGameTrainerPage({ initialGameId }: { initialGameId?: string | null }) {
  const [selectedGame, setSelectedGame] = useState<GameConfig | null>(null);
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  useEffect(() => {
    if (!initialGameId) return;

    const local = getGameConfig(initialGameId);
    if (local) {
      setSelectedGame(local);
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await window.electronAPI?.trainerCatalogLoadGame?.({ catalogGameId: initialGameId });
      if (cancelled || !result?.success || !result.config) return;
      registerGame(result.config);
      setSelectedGame(result.config);
    })();

    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onTrainerHotkey?.((payload) => {
      if (payload.action === 'hide_overlay') {
        setOverlayVisible(false);
        return;
      }
      if (payload.action === 'toggle_overlay') {
        setOverlayVisible((visible) => !visible);
      }
    });
    return () => unsubscribe?.();
  }, []);

  return (
    <div className={styles['page-container']}>
      <PageModuleHeader
        artwork="trainerController"
        className={styles['page-header']}
        title="Live Trainer"
        description="WeMod-class live memory trainer — auto-detect running games, toggle cheats in-session, F1–F12 hotkeys, Ctrl+Shift+O overlay"
        actions={
          <div className={styles['header-actions']}>
            <button type="button" className={styles['overlay-btn']} onClick={() => void handleToggleOverlay()}>
              {overlayVisible ? 'Hide Overlay' : 'Show Overlay'} (Ctrl+Shift+O)
            </button>
          </div>
        }
      />

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
