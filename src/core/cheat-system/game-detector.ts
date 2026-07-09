/**
 * Game auto-detection - discovers which games from the registry are running.
 *
 * Pure functions only — no Node built-ins (child_process, path) and no
 * direct native-memory-driver imports. This module is reachable from
 * renderer code (GameCheatSelector.tsx via App.tsx), and the renderer is
 * sandboxed (contextIsolation: true, nodeIntegration: false — see
 * electron/main.ts). Node APIs there crash at module-load time. Callers
 * fetch the running-process list via window.electronAPI.liveMemoryListProcesses()
 * (which does cross into the main process over IPC) and pass the plain
 * string list in here.
 */

import { gameRegistry } from './game-registry.js';
import type { GameConfig } from './types.js';

/** Checks whether a game's executable (or any alias) appears in a list of running process names. */
export function isGameRunning(gameConfig: GameConfig, runningProcessNames: string[]): boolean {
  const executableLower = gameConfig.executable.toLowerCase();
  const aliasesLower = gameConfig.aliases?.map((a) => a.toLowerCase()) || [];

  return runningProcessNames.some((name) => {
    const nameLower = name.toLowerCase();
    return nameLower === executableLower || aliasesLower.some((alias) => nameLower.endsWith(alias));
  });
}

/** Get list of currently running games from registry, given the current running-process names. */
export function getRunningGames(runningProcessNames: string[]): GameConfig[] {
  const games = gameRegistry.listGames();
  return games.filter((game) => isGameRunning(game, runningProcessNames));
}

/** Format game list for display. */
export function formatGameList(
  games: GameConfig[],
  runningProcessNames: string[],
): Array<{ id: string; label: string; isRunning: boolean }> {
  return games.map((game) => ({
    id: game.gameId,
    label: `${game.name} (${game.cheats.length} cheats)`,
    isRunning: isGameRunning(game, runningProcessNames),
  }));
}

/** Get sorted game list (running games first), given the current running-process names. */
export function getSortedGameList(runningProcessNames: string[]): GameConfig[] {
  const allGames = gameRegistry.listGames();
  const running = allGames.filter((g) => isGameRunning(g, runningProcessNames));
  const notRunning = allGames.filter((g) => !isGameRunning(g, runningProcessNames));
  return [...running, ...notRunning];
}
