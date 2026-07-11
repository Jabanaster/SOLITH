import { compileDefinitionToPayload } from '../definitions/compile-yaml.v1.js';
import { solithDefinitionToModPack } from '../definitions/mod-pack-adapter.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { steamCdnImages } from './types.js';
import {
  getCatalogEntry,
  getDefinitionPayload,
  upsertCatalogEntry,
  upsertDefinitionPayload,
} from './store.js';

const BUNDLED_DEFINITIONS: SolithDefinitionV1[] = [
  {
    schemaVersion: 1,
    id: 'stardew-valley',
    title: 'Stardew Valley',
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'bundled',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'verified',
    },
    target: {
      executables: ['Stardew Valley.exe', 'StardewValley.exe'],
      arch: 'x64',
    },
    connectionBaseline: 5,
    saveEditor: {
      defaultDirectory: '%APPDATA%/StardewValley/Saves',
      extension: 'xml',
      format: 'xml',
      saveFields: [
        {
          id: 'stardew-money',
          name: 'Money',
          category: 'currency',
          dataType: 'number',
          mapping: { searchKey: 'SaveGame.player.0.money' },
        },
        {
          id: 'stardew-stamina',
          name: 'Stamina',
          category: 'stats',
          dataType: 'number',
          mapping: { searchKey: 'SaveGame.player.0.stamina.0.float.0' },
        },
        {
          id: 'stardew-farming-xp',
          name: 'Farming XP',
          category: 'skills',
          dataType: 'number',
          mapping: { searchKey: 'SaveGame.player.0.experiencePoints.0.int.0' },
        },
        {
          id: 'stardew-max-stamina',
          name: 'Max Stamina',
          category: 'stats',
          dataType: 'number',
          mapping: { searchKey: 'SaveGame.player.0.maxStamina.0.float.0' },
        },
      ],
    },
  },
  {
    schemaVersion: 1,
    id: 'palworld',
    title: 'Palworld',
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'bundled',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'verified',
    },
    target: {
      executables: ['Palworld-Win64-Shipping.exe', 'Palworld.exe'],
      arch: 'x64',
    },
    connectionBaseline: 4,
    memoryFeatures: [
      {
        id: 'infinite-player-health',
        name: 'Infinite Player Health',
        category: 'player',
        type: 'scan_unknown',
        dataType: 'float',
        defaultValue: 9999,
        resolution: { moduleName: 'Palworld-Win64-Shipping.exe' },
      },
      {
        id: 'infinite-stamina',
        name: 'Infinite Stamina',
        category: 'player',
        type: 'scan_unknown',
        dataType: 'float',
        defaultValue: 9999,
        resolution: { moduleName: 'Palworld-Win64-Shipping.exe' },
      },
      {
        id: 'instant-capture',
        name: 'Instant Capture',
        category: 'game',
        type: 'scan_unknown',
        dataType: 'float',
        defaultValue: 1,
        resolution: { moduleName: 'Palworld-Win64-Shipping.exe' },
      },
    ],
  },
];

function cheatCountForDefinition(definition: SolithDefinitionV1): number {
  return (definition.memoryFeatures?.length ?? 0) + (definition.saveEditor?.saveFields.length ?? 0);
}

function syncCatalogEntryForDefinition(definition: SolithDefinitionV1, packId: string): void {
  const catalogGameId = definition.id;
  const existing = getCatalogEntry(catalogGameId);
  const images = existing?.steamAppId ? steamCdnImages(existing.steamAppId) : {};
  upsertCatalogEntry({
    catalogGameId,
    displayName: definition.title,
    steamAppId: existing?.steamAppId,
    executables: definition.target.executables,
    categories: existing?.categories ?? ['Action'],
    ...images,
    headerUrl: existing?.headerUrl ?? images.headerUrl,
    coverUrl: existing?.coverUrl ?? images.coverUrl,
    iconUrl: existing?.iconUrl ?? images.iconUrl,
    verificationStatus: definition.safety.verificationStatus,
    sources: existing?.sources ?? [{ provider: 'bundled', url: 'bundled://schema.v1' }],
    hasModPack: true,
    modPackId: packId,
    cheatCount: cheatCountForDefinition(definition),
    searchableText: '',
  });
}

/** Upsert schema.v1 payloads for bundled catalog games (Palworld, Stardew Valley). */
export function ensureBundledDefinitions(): number {
  let upserted = 0;
  const syncedAt = new Date().toISOString();

  for (const definition of BUNDLED_DEFINITIONS) {
    if (getDefinitionPayload(definition.id)) continue;

    const pack = solithDefinitionToModPack(definition);
    const payloadJson = compileDefinitionToPayload(definition);
    upsertDefinitionPayload(
      pack.packId,
      definition.id,
      payloadJson,
      definition.safety.verificationStatus,
      'bundled',
      syncedAt,
    );
    syncCatalogEntryForDefinition(definition, pack.packId);
    upserted += 1;
  }

  return upserted;
}

export function bundledDefinitionIds(): string[] {
  return BUNDLED_DEFINITIONS.map((d) => d.id);
}
