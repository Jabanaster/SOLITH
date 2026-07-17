/**
 * Multi-game cheat system types
 * Supports any game with extensible cheat definitions
 */

import type { LiveValueType } from '../live-memory/types.js';

export type GameId = string;

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
  certLevel?: 'L0_Community' | 'L3_Certified';
  certificationLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  tags?: string[]; // 'infinite', 'multiplier', 'toggle', 'toggle', etc.
  source: CheatSource;
  verified: boolean;
  riskLevel: 'safe' | 'medium' | 'high'; // safe = no known issues, medium = achieves disables, high = save corruption possible
  notes?: string;
}

export interface CheatSource {
  name:
    | 'Community Catalog'
    | 'Community Research'
    | 'Mod Repository'
    | 'SMAPI'
    | 'Console'
    | 'Community'
    | 'Official'
    | 'Remote Forum'
    | 'Remote Listing'
    | 'Remote Catalog';
  url?: string;
  verified: boolean;
  lastChecked: Date;
}

export interface GameImageUrls {
  /** Wide header/banner image (Steam CDN 'header.jpg' style, ~460x215 or similar) */
  headerUrl?: string;
  /** Tall cover/library art (Steam CDN 'library_600x900.jpg' style) */
  coverUrl?: string;
  /** Small square icon (Steam CDN 'icon.jpg' or capsule) */
  iconUrl?: string;
  /** Steam AppID, when known — used to construct CDN fallback URLs */
  steamAppId?: number;
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
  images?: GameImageUrls;
  pinnedCheatIds?: string[]; // Cheats shown in the "Pinned" section at top
}

export interface GameRegistry {
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
