/**
 * Cheat system exports
 * Multi-game cheat registry, detector, and utilities
 */

// Types
export type { GameId, CheatDefinition, GameConfig, CheatToggleState, GameSession } from './types.js';

// Registry
export {
  gameRegistry,
  registerGame,
  getGameConfig,
  listAvailableGames,
  findGameByExecutable,
} from './game-registry.js';
export { getInstalledGames as getRegistryInstalledGames } from './game-registry.js';

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

// Game detection — pure functions, take a running-process-name list as input
// (see game-detector.ts for why: no Node/native imports allowed here, this
// module is reachable from renderer code).
export { isGameRunning, getRunningGames, formatGameList, getSortedGameList } from './game-detector.js';

import { ALL_GAMES } from './games.js';
import { registerGame } from './game-registry.js';

/**
 * Initialize the cheat system with all games.
 * Call this once at app startup (idempotent — safe to call more than once).
 */
export function initializeCheatSystem(): void {
  for (const gameConfig of ALL_GAMES) {
    registerGame(gameConfig);
  }
}
