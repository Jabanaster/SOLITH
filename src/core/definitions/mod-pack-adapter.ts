import type { ModPack, ModPackCheat } from '../trainer-catalog/types.js';
import {
  SOLITH_DEFINITION_SCHEMA_VERSION,
  type MemoryFeatureType,
  type MemoryDataType,
  type MemoryFeatureV1,
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
