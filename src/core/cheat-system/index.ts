/**
 * Cheat system exports
 * Multi-game cheat registry, detector, and utilities
 */

// Types
export type { GameId, CheatDefinition, GameConfig, CheatToggleState, GameSession } from './types.js';

// Registry
export { gameRegistry, registerGame, getGameConfig, listAvailableGames, findGameByExecutable, getInstalledGames } from './game-registry.js';

// Game configurations
export {
  ALL_GAMES,
  PALWORLD_CONFIG,
  ATOMFALL_CONFIG,
  STARDEW_VALLEY_CONFIG,
  AVOWED_CONFIG,
  UNDISPUTED_CONFIG,
  DREDGE_CONFIG,
  CRIMSON_DESERT_CONFIG,
} from './games.js';

// Game detection
export {
  isGameRunning,
  getRunningGames,
  getInstalledGames,
  getGameFromRunningProcess,
  formatGameList,
  getSortedGameList,
} from './game-detector.js';

/**
 * Initialize the cheat system with all games
 * Call this once at app startup
 */
export function initializeCheatSystem(): void {
  const { ALL_GAMES, registerGame } = require('./games.js');

  for (const gameConfig of ALL_GAMES) {
    registerGame(gameConfig);
  }

  console.log(`✅ Cheat system initialized with ${ALL_GAMES.length} games`);
}
