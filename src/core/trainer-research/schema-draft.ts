import {
  SOLITH_DEFINITION_SCHEMA_VERSION,
  type MemoryFeatureType,
  type MemoryFeatureV1,
  type SolithDefinitionV1,
} from '../definitions/schema.v1.js';
import { slugifyGameId } from '../trainer-catalog/types.js';
import type { MemoryDiffCandidate } from './types.js';

function mapMemoryDataType(dataType: string): MemoryFeatureV1['dataType'] {
  switch (dataType) {
    case 'float':
      return 'float';
    case 'double':
      return 'double';
    case 'int64':
      return 'int64';
    case 'byte':
      return 'byte';
    default:
      return 'int32';
  }
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) return trimmed.toLowerCase();
  return `0x${BigInt(trimmed).toString(16)}`;
}

export function buildSchemaDraftFromCandidates(input: {
  title: string;
  gameExecutable: string;
  trainerExePath?: string;
  trainerSha256?: string;
  candidates: MemoryDiffCandidate[];
}): SolithDefinitionV1 {
  const id = slugifyGameId(input.title);
  const memoryFeatures: MemoryFeatureV1[] = input.candidates.map((candidate) => {
    const address = normalizeAddress(candidate.address);
    const featureType: MemoryFeatureType = candidate.featureType ?? 'scan_unknown';
    return {
      id: candidate.id,
      name: candidate.label || `Research ${address}`,
      category: candidate.category || 'Research',
      type: featureType,
      dataType: mapMemoryDataType(candidate.dataType),
      defaultValue:
        mapMemoryDataType(candidate.dataType) === 'float' || mapMemoryDataType(candidate.dataType) === 'double'
          ? candidate.currentValue
          : Math.trunc(candidate.currentValue),
      certificationLevel: 'L0',
      resolution: {
        moduleName: input.gameExecutable,
        baseOffset: address,
      },
    };
  });

  return {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id,
    title: input.title,
    gameVersion: 'research-draft',
    executableHashPrefixes: [],
    author: 'external-trainer-research-lab',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      executables: [input.gameExecutable],
      arch: 'x64',
    },
    connectionBaseline: 6,
    certificationLevel: 'L0',
    memoryFeatures,
  };
}

export function buildYamlDraftFromSchema(definition: SolithDefinitionV1): string {
  const header = [
    '# Solith schema.v1 research draft — manual review required before certification.',
    '# Imported addresses are session-specific until pointer paths are verified.',
    '# Source: External Trainer Research Lab (user-supplied trainer metadata + memory diff)',
    '',
  ].join('\n');

  return `${header}${JSON.stringify(definition, null, 2)}\n`;
}
