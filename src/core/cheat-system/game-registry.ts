/**
 * Game registry implementation - stores and retrieves game configurations
 */

import type { GameConfig, GameId, GameRegistry } from './types.js';

class GameRegistryImpl implements GameRegistry {
  private games: Map<GameId, GameConfig> = new Map();

  add(config: GameConfig): void {
    this.games.set(config.gameId, config);
  }

  get(gameId: GameId): GameConfig | undefined {
    return this.games.get(gameId);
  }

  getByExecutable(executable: string): GameConfig | undefined {
    const lowerExe = executable.toLowerCase();
    for (const config of this.games.values()) {
      if (config.executable.toLowerCase() === lowerExe) {
        return config;
      }
      if (config.aliases?.some((a) => a.toLowerCase() === lowerExe)) {
        return config;
      }
    }
    return undefined;
  }

  listGames(): GameConfig[] {
    return Array.from(this.games.values());
  }

  listInstalled(installedExecutables: string[]): GameConfig[] {
    const installed: GameConfig[] = [];
    const lowerInstalledExes = installedExecutables.map((exe) => exe.toLowerCase());

    for (const config of this.games.values()) {
      if (lowerInstalledExes.includes(config.executable.toLowerCase())) {
        installed.push(config);
        continue;
      }

      if (config.aliases?.some((a) => lowerInstalledExes.includes(a.toLowerCase()))) {
        installed.push(config);
      }
    }

    return installed;
  }
}

// Singleton instance
export const gameRegistry = new GameRegistryImpl();

// Initialize with all game configs (to be populated)
export function initializeGameRegistry(): void {
  // Import all game configs
  // This will be populated with individual game cheat definitions
  // See: src/core/cheat-system/games/*/config.ts
}

export function registerGame(config: GameConfig): void {
  gameRegistry.add(config);
}

export function getGameConfig(gameId: GameId): GameConfig | undefined {
  return gameRegistry.get(gameId);
}

export function listAvailableGames(): GameConfig[] {
  return gameRegistry.listGames();
}

export function findGameByExecutable(executable: string): GameConfig | undefined {
  return gameRegistry.getByExecutable(executable);
}

export function getInstalledGames(executables: string[]): GameConfig[] {
  return gameRegistry.listInstalled(executables);
}
