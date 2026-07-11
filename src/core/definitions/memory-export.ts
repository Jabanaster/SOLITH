import type { LiveValueType } from '../live-memory/types.js';
import { slugifyDefinitionToken } from './slug.js';
import {
  SOLITH_DEFINITION_SCHEMA_VERSION,
  type MemoryDataType,
  type MemoryFeatureType,
  type MemoryFeatureV1,
  type SolithDefinitionV1,
} from './schema.v1.js';

export interface MemoryExportContext {
  gameName: string;
  executableName: string;
  featureName: string;
  featureCategory?: string;
  featureType?: MemoryFeatureType;
  dataType: LiveValueType;
  /** Absolute session address from a scan or manual entry. */
  sessionAddress: string;
  defaultValue?: number;
  moduleName?: string;
  moduleOffset?: number;
  pointerChain?: number[];
  signature?: string;
}

function liveValueToMemoryDataType(dataType: LiveValueType): MemoryDataType {
  switch (dataType) {
    case 'int64':
      return 'int64';
    case 'float':
      return 'float';
    case 'double':
      return 'double';
    case 'byte':
      return 'byte';
    case 'int32':
    case 'uint32':
    default:
      return 'int32';
  }
}

export function memoryExportContextToFeature(context: MemoryExportContext): MemoryFeatureV1 {
  const hasPointerPath =
    context.moduleOffset !== undefined ||
    (context.pointerChain && context.pointerChain.length > 0) ||
    !!context.signature;

  const type: MemoryFeatureType =
    context.featureType ?? (hasPointerPath ? 'toggle' : 'scan_first');

  const resolution = {
    moduleName: context.moduleName ?? context.executableName,
    signature: context.signature,
    baseOffset:
      context.moduleOffset !== undefined
        ? `0x${context.moduleOffset.toString(16)}`
        : undefined,
    pointerChain: context.pointerChain,
  };

  return {
    id: slugifyDefinitionToken(context.featureName),
    name: context.featureName,
    category: context.featureCategory ?? 'Discovered',
    type,
    dataType: liveValueToMemoryDataType(context.dataType),
    defaultValue: context.defaultValue ?? 0,
    resolution,
  };
}

/**
 * Build a schema.v1 definition for a live-memory discovery result.
 * Raw session addresses are exported as scan_first with a review comment in YAML.
 */
export function memoryContextToDefinition(context: MemoryExportContext): SolithDefinitionV1 {
  const feature = memoryExportContextToFeature(context);
  if (!feature.resolution.baseOffset && !feature.resolution.signature) {
    feature.type = 'scan_first';
  }

  return {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id: `custom_${slugifyDefinitionToken(context.gameName)}`,
    title: context.gameName,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'live-memory-trainer',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      executables: [context.executableName],
      arch: 'x64',
    },
    memoryFeatures: [feature],
  };
}
