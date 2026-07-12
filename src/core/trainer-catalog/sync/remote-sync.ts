import type { ModPack, TrainerCatalogEntry } from '../types.js';
import { slugifyGameId, steamCdnImages } from '../types.js';
import type { ParsedRemoteTrainer } from './parse-html.js';
import {
  parseTrainerListHtml,
  parseRemoteTrainerIndexHtml,
  parseRemoteGameCatalogHtml,
} from './parse-html.js';
import type { TrainerSyncSourceConfig } from '../types.js';

const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = 'Solith-TrainerCatalog/1.0 (+local definitions sync; no binary download)';

export interface SyncImportResult {
  provider: string;
  imported: number;
  skipped: number;
  errors: string[];
  trainers: ParsedRemoteTrainer[];
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function guessExecutable(gameName: string): string {
  const compact = gameName.replace(/[^a-zA-Z0-9]/g, '');
  return compact ? `${compact}.exe` : 'Game.exe';
}

function defaultCategories(gameName: string): string[] {
  const lower = gameName.toLowerCase();
  if (/rpg|souls|elden|witcher|avowed|baldur/i.test(lower)) return ['RPG', 'Action'];
  if (/sim|manager|tycoon|city/i.test(lower)) return ['Simulation', 'Strategy'];
  if (/fps|shooter|call of duty|battlefield/i.test(lower)) return ['Shooter', 'Action'];
  if (/racing|forza|need for speed/i.test(lower)) return ['Racing', 'Sports'];
  return ['Action', 'Single Player'];
}

export function remoteTrainerToCatalogEntry(
  trainer: ParsedRemoteTrainer,
  provider: TrainerSyncSourceConfig['id'],
): TrainerCatalogEntry {
  const catalogGameId = slugifyGameId(trainer.gameName);
  const entry: TrainerCatalogEntry = {
    catalogGameId,
    displayName: trainer.gameName,
    executables: [guessExecutable(trainer.gameName)],
    categories: defaultCategories(trainer.gameName),
    verificationStatus: 'community',
    sources: [{ provider, url: trainer.sourceUrl, lastSyncedAt: new Date().toISOString() }],
    hasModPack: true,
    modPackId: `${provider}-${catalogGameId}`,
    cheatCount: 0,
    searchableText: '',
  };
  entry.searchableText = [entry.displayName, ...entry.executables, ...entry.categories, provider]
    .join(' ')
    .toLowerCase();
  return entry;
}

export function remoteTrainerToModPack(
  trainer: ParsedRemoteTrainer,
  provider: TrainerSyncSourceConfig['id'],
): ModPack {
  const catalogGameId = slugifyGameId(trainer.gameName);
  const now = new Date().toISOString();
  const commonCheats = [
    { id: 'health', name: 'Unlimited Health', description: 'Freeze health value', category: 'Player', valueType: 'float', requiresDiscovery: true, verified: false },
    { id: 'ammo', name: 'Unlimited Ammo', description: 'Freeze ammo count', category: 'Weapons', valueType: 'int32', requiresDiscovery: true, verified: false },
    { id: 'money', name: 'Set Money', description: 'Currency / resources', category: 'Currency', valueType: 'int32', requiresDiscovery: true, verified: false },
    { id: 'speed', name: 'Super Speed', description: 'Movement speed multiplier', category: 'Player', valueType: 'float', requiresDiscovery: true, verified: false },
  ];

  return {
    packId: `${provider}-${catalogGameId}`,
    catalogGameId,
    gameName: trainer.gameName,
    source: {
      provider,
      url: trainer.sourceUrl,
      trainerTitle: trainer.title,
      lastSyncedAt: now,
    },
    verificationStatus: 'community',
    versions: [{ versionLabel: '*', executables: [guessExecutable(trainer.gameName)] }],
    cheats: commonCheats,
    connectionBaseline: 6,
    platform: 'unknown',
    syncedAt: now,
    notes: [
      `Imported trainer listing from ${provider}. Pointer paths are not verified — use Advanced Scan Mode or memory scan.`,
      'Definitions only; no third-party trainer executable was downloaded.',
    ],
  };
}

export async function syncTrainerSource(source: TrainerSyncSourceConfig): Promise<SyncImportResult> {
  const url = `${source.baseUrl.replace(/\/$/, '')}${source.listPath}`;
  const errors: string[] = [];
  let trainers: ParsedRemoteTrainer[] = [];

  try {
    const html = await fetchHtml(url);
    if (source.id === 'mrantifun') {
      trainers = parseTrainerListHtml(source.baseUrl, html);
    } else if (source.id === 'fling') {
      trainers = parseRemoteTrainerIndexHtml(html);
    } else if (source.id === 'plitch') {
      trainers = parseRemoteGameCatalogHtml(html);
    } else {
      trainers = parseTrainerListHtml(source.baseUrl, html);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { provider: source.id, imported: 0, skipped: 0, errors, trainers: [] };
  }

  return {
    provider: source.id,
    imported: trainers.length,
    skipped: 0,
    errors,
    trainers,
  };
}

export function applySteamAppId(entry: TrainerCatalogEntry, steamAppId: number): TrainerCatalogEntry {
  const images = steamCdnImages(steamAppId);
  return {
    ...entry,
    steamAppId,
    ...images,
  };
}
