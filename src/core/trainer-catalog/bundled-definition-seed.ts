import { ALL_GAMES } from '../cheat-system/games.js';
import type { CheatDefinition, GameConfig } from '../cheat-system/types.js';
import { compileDefinitionToPayload } from '../definitions/compile-yaml.v1.js';
import { solithDefinitionToModPack } from '../definitions/mod-pack-adapter.js';
import type { MemoryDataType, MemoryFeatureV1, SolithDefinitionV1 } from '../definitions/schema.v1.js';
import {
  BUNDLED_COMMUNITY_GAMES,
  communityGameId,
  type BundledCommunityGame,
} from './bundled-community-games.js';
import { buildSearchableText, steamCdnImages } from './types.js';
import {
  getCatalogEntry,
  getDefinitionPayload,
  upsertCatalogEntry,
  upsertDefinitionPayload,
} from './store.js';

function mapValueType(valueType: string): MemoryDataType {
  switch (valueType) {
    case 'float':
      return 'float';
    case 'double':
      return 'double';
    case 'int64':
      return 'int64';
    case 'byte':
      return 'byte';
    case 'bool':
    case 'boolean':
      return 'boolean';
    default:
      return 'int32';
  }
}

function defaultForCheat(cheat: CheatDefinition): number | boolean {
  if (cheat.valueType === 'bool') return true;
  if (typeof cheat.infiniteValue === 'number') return cheat.infiniteValue;
  return 1;
}

function cheatToMemoryFeature(cheat: CheatDefinition, moduleName: string): MemoryFeatureV1 {
  return {
    id: cheat.id,
    name: cheat.name,
    category: cheat.category.toLowerCase(),
    type: 'scan_unknown',
    dataType: mapValueType(cheat.valueType),
    defaultValue: defaultForCheat(cheat),
    resolution: { moduleName },
  };
}

function pinnedCheatsForGame(game: GameConfig): CheatDefinition[] {
  if (game.pinnedCheatIds?.length) {
    return game.pinnedCheatIds
      .map((id) => game.cheats.find((c) => c.id === id))
      .filter((c): c is CheatDefinition => Boolean(c));
  }
  return game.cheats.slice(0, 12);
}

function memoryDefinitionFromGame(game: GameConfig): SolithDefinitionV1 {
  const executables = [game.executable, ...(game.aliases ?? [])].filter(
    (name, index, list) => list.indexOf(name) === index,
  );

  return {
    schemaVersion: 1,
    id: game.gameId,
    title: game.name,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'bundled',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'verified',
    },
    target: {
      executables,
      arch: 'x64',
    },
    connectionBaseline: game.connectionBaseline > 0 ? game.connectionBaseline : undefined,
    memoryFeatures: pinnedCheatsForGame(game).map((cheat) =>
      cheatToMemoryFeature(cheat, game.executable),
    ),
  };
}

/**
 * Phase 3 — mirror verified live-control-catalog pointers into schema.v1 seeds
 * so dual-read prefers definitions (liveMemory: executable) without fallback.
 * Source of truth for NEW verified pointers is schema.v1 YAML/JSON authoring —
 * do not add further entries only to live-control-catalog.ts.
 */
const ATOMFALL_VERIFIED_AMMO_FEATURE: MemoryFeatureV1 = {
  id: 'atomfall-current-weapon-ammo',
  name: 'Set Current Weapon Ammo',
  category: 'weapons',
  type: 'write_once',
  dataType: 'int32',
  defaultValue: 99,
  certificationLevel: 'L2',
  resolution: {
    moduleName: 'atomfall_dx12.exe',
    baseOffset: '0x1959a28',
    pointerChain: [24],
  },
};

function enrichCuratedDefinition(definition: SolithDefinitionV1): SolithDefinitionV1 {
  if (definition.id !== 'atomfall') return definition;
  const features = [...(definition.memoryFeatures ?? [])];
  if (!features.some((f) => f.id === ATOMFALL_VERIFIED_AMMO_FEATURE.id)) {
    features.unshift(ATOMFALL_VERIFIED_AMMO_FEATURE);
  }
  return { ...definition, memoryFeatures: features };
}

const STARDEW_DEFINITION: SolithDefinitionV1 = {
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
};

function communityDefinitionFromGame(game: BundledCommunityGame): SolithDefinitionV1 {
  const id = communityGameId(game);
  const moduleName = game.executables[0] ?? `${id}.exe`;
  const memoryFeatures: MemoryFeatureV1[] = [
    {
      id: 'infinite-health',
      name: 'Infinite Health',
      category: 'player',
      type: 'scan_unknown',
      dataType: 'int32',
      defaultValue: 9999,
      resolution: { moduleName },
    },
    {
      id: 'infinite-stamina',
      name: 'Infinite Stamina',
      category: 'player',
      type: 'scan_unknown',
      dataType: 'int32',
      defaultValue: 9999,
      resolution: { moduleName },
    },
    {
      id: 'set-currency',
      name: 'Set Currency',
      category: 'inventory',
      type: 'scan_unknown',
      dataType: 'int32',
      defaultValue: 999999,
      resolution: { moduleName },
    },
  ];

  return {
    schemaVersion: 1,
    id,
    title: game.name,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'bundled',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      executables: game.executables,
      arch: 'x64',
    },
    memoryFeatures,
  };
}

/**
 * Phase 3 authoring cutover: curated titles are compiled into schema.v1 payloads
 * at seed time. New titles/controls must be authored as schema.v1 definitions
 * (YAML → compile → SQLite), not by extending ALL_GAMES / live-control-catalog /
 * game-profiles as the capability SoT. Legacy files remain for presentation /
 * fallback until Phase 4 deletion approval.
 */
function buildBundledDefinitions(): SolithDefinitionV1[] {
  const memoryGames = ALL_GAMES.filter(
    (game) => game.cheatDiscoveryType === 'memory-scan' || game.cheatDiscoveryType === 'hybrid',
  );
  const curated = [STARDEW_DEFINITION, ...memoryGames.map(memoryDefinitionFromGame)].map(
    enrichCuratedDefinition,
  );
  const community = BUNDLED_COMMUNITY_GAMES.map(communityDefinitionFromGame);
  return [...curated, ...community];
}

const BUNDLED_DEFINITIONS: SolithDefinitionV1[] = buildBundledDefinitions();

function cheatCountForDefinition(definition: SolithDefinitionV1): number {
  return (definition.memoryFeatures?.length ?? 0) + (definition.saveEditor?.saveFields.length ?? 0);
}

function syncCatalogEntryForDefinition(
  definition: SolithDefinitionV1,
  packId: string,
  meta?: Pick<BundledCommunityGame, 'steamAppId' | 'categories' | 'executables'>,
): void {
  const catalogGameId = definition.id;
  const existing = getCatalogEntry(catalogGameId);
  const steamAppId = meta?.steamAppId ?? existing?.steamAppId;
  const images = steamAppId ? steamCdnImages(steamAppId) : {};
  const categories = meta?.categories ?? existing?.categories ?? ['Action'];
  const executables = meta?.executables ?? definition.target.executables;
  upsertCatalogEntry({
    catalogGameId,
    displayName: definition.title,
    steamAppId,
    executables,
    categories,
    ...images,
    headerUrl: existing?.headerUrl ?? images.headerUrl,
    coverUrl: existing?.coverUrl ?? images.coverUrl,
    iconUrl: existing?.iconUrl ?? images.iconUrl,
    verificationStatus: definition.safety.verificationStatus,
    sources: existing?.sources ?? [{ provider: 'bundled', url: 'bundled://schema.v1' }],
    hasModPack: true,
    modPackId: packId,
    cheatCount: cheatCountForDefinition(definition),
    searchableText: buildSearchableText({
      displayName: definition.title,
      executables,
      categories,
    }),
  });
}

const COMMUNITY_META_BY_ID = new Map(
  BUNDLED_COMMUNITY_GAMES.map((g) => [
    communityGameId(g),
    { steamAppId: g.steamAppId, categories: g.categories, executables: g.executables },
  ]),
);

/** Upsert schema.v1 payloads for all curated catalog games. */
export function ensureBundledDefinitions(): number {
  let upserted = 0;
  const syncedAt = new Date().toISOString();

  for (const definition of BUNDLED_DEFINITIONS) {
    const pack = solithDefinitionToModPack(definition);
    const payloadJson = compileDefinitionToPayload(definition);
    const existing = getDefinitionPayload(definition.id);
    if (existing && compileDefinitionToPayload(existing) === payloadJson) continue;

    upsertDefinitionPayload(
      pack.packId,
      definition.id,
      payloadJson,
      definition.safety.verificationStatus,
      'bundled',
      syncedAt,
    );
    syncCatalogEntryForDefinition(definition, pack.packId, COMMUNITY_META_BY_ID.get(definition.id));
    upserted += 1;
  }

  return upserted;
}

export function bundledDefinitionIds(): string[] {
  return BUNDLED_DEFINITIONS.map((d) => d.id);
}

export function bundledDefinitionsForTests(): SolithDefinitionV1[] {
  return BUNDLED_DEFINITIONS;
}
