import React, { useState, useEffect } from 'react';
import styles from './GameCheatSelector.module.css';
import { gameRegistry } from '../../core/cheat-system/game-registry.js';
import { getRunningGames, getSortedGameList, isGameRunning } from '../../core/cheat-system/game-detector.js';
import type { GameId, GameConfig } from '../../core/cheat-system/types.js';

interface GameCheatSelectorProps {
  onGameSelect: (gameConfig: GameConfig) => void;
  autoSelectRunning?: boolean; // Auto-select if only one game is running
}

export const GameCheatSelector: React.FC<GameCheatSelectorProps> = ({
  onGameSelect,
  autoSelectRunning = true,
}) => {
  const [selectedGameId, setSelectedGameId] = useState<GameId | null>(null);
  const [games, setGames] = useState<GameConfig[]>([]);
  const [runningGames, setRunningGames] = useState<Set<GameId>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadGamesAndRunningState() {
      // Process detection crosses into the main process over IPC — this
      // component must never import the native driver or game-detector's
      // process-enumeration path directly (renderer is sandboxed; see
      // useGameCheatSession.ts for the full explanation of why that crashes).
      let runningProcessNames: string[] = [];
      try {
        const result = await window.electronAPI.liveMemoryListProcesses();
        if (result.success && result.processes) {
          runningProcessNames = result.processes.map((p) => p.name);
        }
      } catch {
        // Feature flag off or IPC unavailable — fall back to "nothing detected running",
        // games still list normally, just without running-state badges.
      }
      if (cancelled) return;

      const allGames = getSortedGameList(runningProcessNames);
      setGames(allGames);

      const running = getRunningGames(runningProcessNames);
      setRunningGames(new Set(running.map((g) => g.gameId)));

      if (autoSelectRunning && running.length === 1) {
        setSelectedGameId(running[0].gameId);
        onGameSelect(running[0]);
      }
    }

    void loadGamesAndRunningState();
    return () => {
      cancelled = true;
    };
  }, [autoSelectRunning, onGameSelect]);

  const handleSelectGame = (gameId: GameId) => {
    setSelectedGameId(gameId);
    const selectedGame = gameRegistry.get(gameId);
    if (selectedGame) {
      onGameSelect(selectedGame);
    }
  };

  if (games.length === 0) {
    return (
      <div className={styles['selector-container']}>
        <div className={styles['no-games-message']}>
          <p>No games registered in cheat system</p>
          <p className={styles['helper-text']}>Please check your installation</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles['selector-container']}>
      <div className={styles['selector-header']}>
        <h2>Select a Game</h2>
        <p className={styles['subtitle']}>
          {runningGames.size > 0
            ? `${runningGames.size} game${runningGames.size === 1 ? '' : 's'} running`
            : 'No games running'}
        </p>
      </div>

      <div className={styles['games-grid']}>
        {games.map((game) => {
          const isRunning = runningGames.has(game.gameId);
          const isSelected = selectedGameId === game.gameId;

          return (
            <button
              key={game.gameId}
              className={`${styles['game-card']} ${isRunning ? styles['running'] : ''} ${isSelected ? styles['selected'] : ''}`}
              onClick={() => handleSelectGame(game.gameId)}
              title={game.description}
            >
              <div className={styles['game-name']}>{game.name}</div>

              {isRunning && <div className={styles['running-badge']}>🎮 Running</div>}

              <div className={styles['game-info']}>
                <span className={styles['cheat-count']}>{game.cheats.length} cheats</span>
                <span className={styles['platform-badge']}>{game.platform}</span>
              </div>

              <div className={styles['discovery-type']}>{game.cheatDiscoveryType}</div>
            </button>
          );
        })}
      </div>

      {selectedGameId && (
        <div className={styles['selected-game-info']}>
          {(() => {
            const game = gameRegistry.get(selectedGameId);
            if (!game) return null;

            return (
              <>
                <h3>About {game.name}</h3>
                <p>{game.description}</p>
                <div className={styles['game-stats']}>
                  <span>📊 {game.cheats.length} cheats available</span>
                  <span>🎮 {game.categories.length} categories</span>
                  <span>🔍 {game.cheatDiscoveryType} discovery</span>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};
