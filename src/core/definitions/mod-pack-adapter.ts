import type { ModPack, ModPackCheat } from '../trainer-catalog/types.js';
import type { LivePointerPath } from '../live-memory/pointer-resolver.js';
import { parseHexOffset } from '../live-memory/feature-resolver.js';
import {
  SOLITH_DEFINITION_SCHEMA_VERSION,
  type MemoryFeatureType,
  type MemoryDataType,
  type MemoryFeatureV1,
  type SaveFieldFeatureV1,
  type SolithDefinitionV1,
} from './schema.v1.js';

function mapCheatValueType(valueType: string): MemoryDataType {
  switch (valueType) {
    case 'int64':
      return 'int64';
    case 'float':
      return 'float';
    case 'double':
      return 'double';
    case 'byte':
      return 'byte';
    case 'boolean':
      return 'boolean';
    case 'int32':
    default:
      return 'int32';
  }
}

function inferFeatureType(cheat: ModPackCheat): MemoryFeatureType {
  if (cheat.requiresDiscovery || !cheat.pointerPath) {
    return 'scan_unknown';
  }
  if (cheat.infiniteValue !== undefined) {
    return 'freeze';
  }
  return 'toggle';
}

function cheatToMemoryFeature(cheat: ModPackCheat, fallbackModule: string): MemoryFeatureV1 {
  const moduleName = cheat.pointerPath?.moduleName ?? fallbackModule;
  return {
    id: cheat.id,
    name: cheat.name,
    category: cheat.category,
    type: inferFeatureType(cheat),
    dataType: mapCheatValueType(cheat.valueType),
    defaultValue: cheat.defaultValue ?? cheat.infiniteValue ?? 0,
    resolution: {
      moduleName,
      baseOffset: cheat.pointerPath ? `0x${cheat.pointerPath.moduleOffset.toString(16)}` : undefined,
      pointerChain: cheat.pointerPath?.offsets,
    },
  };
}

/**
 * Convert an existing ModPack payload into the unified SolithDefinitionV1 contract.
 * Mod packs without `schemaVersion` in storage are treated as v0 and adapted at runtime.
 */
export function modPackToSolithDefinition(pack: ModPack): SolithDefinitionV1 {
  const executables = [...new Set(pack.versions.flatMap((v) => v.executables))];
  const hashPrefixes = [...new Set(pack.versions.flatMap((v) => v.executableHashPrefixes ?? []))];
  const primaryExecutable = executables[0] ?? `${pack.gameName.replace(/[^a-z0-9]/gi, '')}.exe`;

  return {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id: pack.catalogGameId,
    title: pack.gameName,
    gameVersion: pack.versions[0]?.versionLabel ?? '*',
    executableHashPrefixes: hashPrefixes,
    author: pack.source.provider,
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: pack.verificationStatus,
    },
    target: {
      executables,
      arch: 'x64',
    },
    connectionBaseline: pack.connectionBaseline,
    memoryFeatures: pack.cheats.map((cheat) => cheatToMemoryFeature(cheat, primaryExecutable)),
  };
}

/**
 * Extract fingerprint fields from a definition for attach-time verification.
 */
export function definitionFingerprintFields(definition: Pick<SolithDefinitionV1, 'executableHashPrefixes' | 'targetSHA256' | 'connectionBaseline'>) {
  return {
    executableHashPrefixes: definition.executableHashPrefixes,
    targetSHA256: definition.targetSHA256,
    connectionBaseline: definition.connectionBaseline,
  };
}

function memoryDataTypeToCheatValueType(dataType: MemoryDataType): string {
  return dataType === 'boolean' ? 'boolean' : dataType;
}

function featureToCheat(feature: MemoryFeatureV1, primaryExecutable: string): ModPackCheat {
  const requiresDiscovery = feature.type === 'scan_first' || feature.type === 'scan_unknown';
  const pointerPath: LivePointerPath | undefined =
    !requiresDiscovery && feature.resolution.baseOffset
      ? {
          moduleName: feature.resolution.moduleName || primaryExecutable,
          moduleOffset: parseHexOffset(feature.resolution.baseOffset),
          offsets: feature.resolution.pointerChain ?? [],
        }
      : undefined;

  return {
    id: feature.id,
    name: feature.name,
    description: `Imported from schema.v1 (${feature.type})`,
    category: feature.category,
    valueType: memoryDataTypeToCheatValueType(feature.dataType),
    requiresDiscovery: requiresDiscovery || !pointerPath,
    verified: false,
    pointerPath,
    infiniteValue: feature.type === 'freeze' ? Number(feature.defaultValue) : undefined,
    defaultValue: typeof feature.defaultValue === 'boolean' ? (feature.defaultValue ? 1 : 0) : feature.defaultValue,
    tags: ['schema-v1'],
  };
}

function saveFieldToCheat(field: SaveFieldFeatureV1): ModPackCheat {
  return {
    id: field.id,
    name: field.name,
    description: field.mapping.searchKey
      ? `Save field path: ${field.mapping.searchKey}`
      : 'Imported save-editor field from schema.v1',
    category: field.category,
    valueType: field.dataType,
    requiresDiscovery: true,
    verified: false,
    tags: ['schema-v1', 'save-field'],
  };
}

/**
 * Convert a compiled schema.v1 definition into a legacy ModPack for catalog loaders.
 */
export function solithDefinitionToModPack(definition: SolithDefinitionV1): ModPack {
  const executables = definition.target.executables;
  const primaryExecutable = executables[0] ?? `${definition.title.replace(/[^a-z0-9]/gi, '')}.exe`;
  const memoryCheats = (definition.memoryFeatures ?? []).map((f) => featureToCheat(f, primaryExecutable));
  const saveCheats = (definition.saveEditor?.saveFields ?? []).map(saveFieldToCheat);
  const cheats = [...memoryCheats, ...saveCheats];
  const syncedAt = new Date().toISOString();

  return {
    packId: `${definition.id}-pack`,
    catalogGameId: definition.id,
    gameName: definition.title,
    source: {
      provider: 'user',
      trainerTitle: definition.title,
      lastSyncedAt: syncedAt,
    },
    verificationStatus: definition.safety.verificationStatus,
    versions: [
      {
        versionLabel: definition.gameVersion,
        executables,
        executableHashPrefixes: definition.executableHashPrefixes,
      },
    ],
    cheats,
    connectionBaseline: definition.connectionBaseline ?? 0,
    platform: 'unknown',
    syncedAt,
    notes: definition.saveEditor
      ? [`saveEditor format=${definition.saveEditor.format} dir=${definition.saveEditor.defaultDirectory}`]
      : undefined,
  };
}

/** Detect schema.v1 definition JSON stored in trainer_mod_packs.payloadJson. */
export function isSolithDefinitionPayload(raw: unknown): raw is SolithDefinitionV1 {
  return (
    !!raw &&
    typeof raw === 'object' &&
    (raw as SolithDefinitionV1).schemaVersion === SOLITH_DEFINITION_SCHEMA_VERSION
  );
}
