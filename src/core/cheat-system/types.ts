/**
 * Multi-game cheat system types
 * Supports any game with extensible cheat definitions
 */

import type { LiveValueType } from '../live-memory/types.js';

export type GameId = 'palworld' | 'atomfall' | 'stardew-valley' | 'avowed' | 'undisputed' | 'dredge' | 'crimson-desert';

export interface CheatCategory {
  id: string;
  name: string;
  description?: string;
}

export interface CheatDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  valueType: LiveValueType | 'bool' | 'string'; // Extended for non-memory cheats
  infiniteValue?: number | string;
  defaultValue?: number | string;
  normalValues?: { min: number; max: number };
  requiresDiscovery: boolean; // false = known/stable, true = user must scan
  tags?: string[]; // 'infinite', 'multiplier', 'toggle', 'toggle', etc.
  source: CheatSource;
  verified: boolean;
  riskLevel: 'safe' | 'medium' | 'high'; // safe = no known issues, medium = achieves disables, high = save corruption possible
  notes?: string;
}

export interface CheatSource {
  name: 'WeMod' | 'FearLess' | 'Nexus' | 'SMAPI' | 'Console' | 'Community' | 'Official';
  url?: string;
  verified: boolean;
  lastChecked: Date;
}

export interface GameConfig {
  gameId: GameId;
  name: string;
  executable: string;
  aliases?: string[]; // e.g., ['Palworld-Win64-Shipping.exe', 'Palworld.exe']
  platform: 'steam' | 'xbox-game-pass' | 'epic' | 'standalone';
  cheatsSupported: boolean;
  cheatDiscoveryType: 'memory-scan' | 'console-command' | 'mod-command' | 'hybrid';
  dataType: LiveValueType; // Primary data type for this game (int32, float, etc.)
  categories: CheatCategory[];
  cheats: CheatDefinition[];
  connectionBaseline: number; // For online-guard (e.g., Palworld = 4)
  description: string;
  releaseDate?: string;
  lastUpdated: Date;
}

export interface GameRegistry {
  games: Map<GameId, GameConfig>;
  add(config: GameConfig): void;
  get(gameId: GameId): GameConfig | undefined;
  getByExecutable(executable: string): GameConfig | undefined;
  listGames(): GameConfig[];
  listInstalled(installedExecutables: string[]): GameConfig[];
}

export interface CheatToggleState {
  cheatId: string;
  enabled: boolean;
  value: number | string;
  isFrozen: boolean;
  status: 'idle' | 'discovering' | 'confirmed' | 'frozen' | 'error' | 'pending';
  error?: string;
  discoveredAddress?: string;
  timestamp: Date;
}

export interface GameSession {
  gameId: GameId;
  gameName: string;
  gameProcess?: {
    pid: number;
    path: string;
  };
  userConfirmedOffline: boolean;
  activeCheats: Map<string, CheatToggleState>;
  discoveredAddresses: Map<string, string>; // cheatId -> address
  startedAt: Date;
  lastActivity: Date;
}
