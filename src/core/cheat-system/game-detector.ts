/**
 * Game auto-detection - discovers which games from the registry are installed
 */

import { execSync } from 'child_process';
import path from 'path';
import { listLiveMemoryProcesses } from '../live-memory/native-memory-driver.js';
import { gameRegistry } from './game-registry.js';
import type { GameConfig } from './types.js';

/**
 * Check if a game is currently running by examining active processes
 */
export function isGameRunning(gameConfig: GameConfig): boolean {
  try {
    const processes = listLiveMemoryProcesses();
    const executableLower = gameConfig.executable.toLowerCase();
    const aliasesLower = gameConfig.aliases?.map((a) => a.toLowerCase()) || [];

    return processes.some((p) => {
      const nameLower = p.name.toLowerCase();
      return (
        nameLower === executableLower ||
        aliasesLower.some((alias) => nameLower.endsWith(alias.toLowerCase()))
      );
    });
  } catch {
    return false;
  }
}

/**
 * Get list of currently running games from registry
 */
export function getRunningGames(): GameConfig[] {
  const games = gameRegistry.listGames();
  return games.filter((game) => isGameRunning(game));
}

/**
 * Check common Steam installation paths for a game
 */
function checkSteamPaths(executable: string): string | null {
  const steamPaths = [
    'C:\\Program Files\\Steam\\steamapps\\common',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam\\steamapps\\common'),
    path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Steam\\steamapps\\common',
    ),
  ];

  // This would require fs.existsSync which we'll handle differently
  // For now, return null (actual detection happens via running processes)
  return null;
}

/**
 * Check common Xbox Game Pass paths
 */
function checkGamePassPaths(executable: string): string | null {
  const gamePassPaths = [
    'C:\\Program Files\\WindowsApps',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsApps'),
  ];

  // Similar to Steam paths, would require fs.existsSync
  return null;
}

/**
 * Get currently installed games (via running processes)
 * Full filesystem scanning would require additional filesystem access
 */
export function getInstalledGames(): GameConfig[] {
  return getRunningGames();
}

/**
 * Get game config by running process (if available)
 */
export function getGameFromRunningProcess(): GameConfig | null {
  const running = getRunningGames();
  return running.length > 0 ? running[0] : null;
}

/**
 * Format game list for display
 */
export function formatGameList(games: GameConfig[]): Array<{ id: string; label: string; isRunning: boolean }> {
  return games.map((game) => ({
    id: game.gameId,
    label: `${game.name} (${game.cheats.length} cheats)`,
    isRunning: isGameRunning(game),
  }));
}

/**
 * Get sorted game list (running games first)
 */
export function getSortedGameList(): GameConfig[] {
  const allGames = gameRegistry.listGames();
  const running = allGames.filter((g) => isGameRunning(g));
  const notRunning = allGames.filter((g) => !isGameRunning(g));
  return [...running, ...notRunning];
}
