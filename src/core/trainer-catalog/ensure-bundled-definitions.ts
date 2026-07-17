/**
 * Node/Electron-only: upsert bundled schema.v1 definitions into SQLite catalog store.
 * Keep store imports out of bundled-definition-seed.ts so the Vite renderer can
 * load seeded definitions for save-edit controls without pulling sql.js / app-paths.
 */
import { compileDefinitionToPayload } from '../definitions/compile-yaml.v1.js';
import { solithDefinitionToModPack } from '../definitions/mod-pack-adapter.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import {
  BUNDLED_COMMUNITY_GAMES,
  communityGameId,
  type BundledCommunityGame,
} from './bundled-community-games.js';
import { bundledDefinitionsForTests } from './bundled-definition-seed.js';
import {
  getCatalogEntry,
  getDefinitionPayload,
  upsertCatalogEntry,
  upsertDefinitionPayload,
} from './store.js';
import { buildSearchableText, steamCdnImages } from './types.js';

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
  const definitions = bundledDefinitionsForTests();

  for (const definition of definitions) {
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
