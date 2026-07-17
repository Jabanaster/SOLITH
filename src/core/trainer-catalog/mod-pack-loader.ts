import type { GameConfig, CheatDefinition } from '../cheat-system/types.js';
import type { ModPack, ModPackCheat, TrainerCatalogEntry } from './types.js';
import {
  getDefinitionCertificationForGame,
  getModPackForGame,
  type HubCertificationLevel,
} from './store.js';

function isMemoryCheat(cheat: ModPackCheat): boolean {
  return !cheat.tags?.includes('save-field');
}

function cheatFromModPack(
  cheat: ModPackCheat,
  pack: ModPack,
  certLevel?: HubCertificationLevel,
): CheatDefinition {
  return {
    id: cheat.id,
    name: cheat.name,
    description: cheat.description,
    category: cheat.category,
    valueType: cheat.valueType as CheatDefinition['valueType'],
    infiniteValue: cheat.infiniteValue,
    defaultValue: cheat.defaultValue,
    requiresDiscovery:
      certLevel === 'L0_Community' ||
      cheat.requiresDiscovery ||
      !cheat.pointerPath,
    certLevel,
    certificationLevel: cheat.certificationLevel,
    tags: cheat.tags,
    source: {
      name: 'Community',
      url: pack.source.url,
      verified: cheat.verified,
      lastChecked: new Date(pack.syncedAt),
    },
    verified: cheat.verified,
    riskLevel: cheat.verified ? 'safe' : 'medium',
    notes: cheat.pointerPath ? 'Restart-stable pointer path available' : 'Requires memory scan to locate value',
  };
}

export function modPackToGameConfig(
  pack: ModPack,
  entry?: TrainerCatalogEntry,
  certLevel?: HubCertificationLevel,
): GameConfig {
  const executables = pack.versions.flatMap((v) => v.executables);
  const uniqueExecutables = [...new Set(executables)];
  const primaryExecutable = uniqueExecutables[0] ?? `${pack.gameName.replace(/[^a-z0-9]/gi, '')}.exe`;

  return {
    gameId: pack.catalogGameId as GameConfig['gameId'],
    name: pack.gameName,
    executable: primaryExecutable,
    aliases: uniqueExecutables.filter((e) => e !== primaryExecutable),
    platform: pack.platform === 'unknown' ? 'standalone' : pack.platform,
    cheatsSupported: pack.cheats.length > 0,
    cheatDiscoveryType: pack.cheats.some((c) => c.pointerPath) ? 'hybrid' : 'memory-scan',
    dataType: 'float',
    categories: [...new Set(pack.cheats.map((c) => c.category))].map((id) => ({
      id,
      name: id,
    })),
    cheats: pack.cheats
      .filter(isMemoryCheat)
      .map((cheat) => cheatFromModPack(cheat, pack, certLevel)),
    connectionBaseline: pack.connectionBaseline,
    description: entry?.sources?.[0]?.url
      ? `Imported mod pack from ${pack.source.provider}`
      : 'Community mod pack',
    lastUpdated: new Date(pack.syncedAt),
    images: entry?.steamAppId
      ? {
          steamAppId: entry.steamAppId,
          headerUrl: entry.headerUrl,
          coverUrl: entry.coverUrl,
          iconUrl: entry.iconUrl,
        }
      : {
          headerUrl: entry?.headerUrl,
          coverUrl: entry?.coverUrl,
          iconUrl: entry?.iconUrl,
        },
  };
}

export function loadGameConfigFromCatalog(catalogGameId: string): GameConfig | null {
  const pack = getModPackForGame(catalogGameId);
  if (!pack) return null;
  return modPackToGameConfig(
    pack,
    undefined,
    getDefinitionCertificationForGame(catalogGameId),
  );
}
