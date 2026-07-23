import { z } from 'zod';
import type { LiveValueType } from '../live-memory/types.js';
import type { VerificationStatus } from '../trainer-catalog/types.js';

/**
 * Solith Definition Schema v1
 *
 * Unified trainer definition contract for memory features and save-editor fields.
 * Safe execution types only — injection/DLL/code execution is explicitly forbidden.
 */

export const SOLITH_DEFINITION_SCHEMA_VERSION = 1 as const;

/** Memory actions Solith may execute. `inject` and similar are intentionally absent. */
export const MEMORY_FEATURE_TYPES = [
  'toggle',
  'freeze',
  'write_once',
  'scan_first',
  'scan_unknown',
] as const;

export type MemoryFeatureType = (typeof MEMORY_FEATURE_TYPES)[number];

export const SAVE_FORMAT_TYPES = ['json', 'xml', 'binary', 'sqlite'] as const;
export type SaveFormatType = (typeof SAVE_FORMAT_TYPES)[number];

export const MEMORY_DATA_TYPES = ['int32', 'int64', 'float', 'double', 'boolean', 'byte'] as const;
export type MemoryDataType = (typeof MEMORY_DATA_TYPES)[number];

export const CERTIFICATION_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type CertificationLevel = (typeof CERTIFICATION_LEVELS)[number];

export const TARGET_LAUNCHERS = ['steam', 'gog', 'epic', 'xbox_pc', 'ea', 'ubisoft', 'rockstar', 'standalone', 'unknown'] as const;
export type TargetLauncher = (typeof TARGET_LAUNCHERS)[number];

export const TARGET_PACKAGING = ['win32', 'msixvc', 'uwp', 'appcontainer', 'unknown'] as const;
export type TargetPackaging = (typeof TARGET_PACKAGING)[number];

export const TARGET_ACCESS_MODELS = [
  'standard_user_readonly',
  'restricted_or_denied',
  'protected_target_blocked',
] as const;
export type TargetAccessModel = (typeof TARGET_ACCESS_MODELS)[number];

export interface SolithTargetMetadataV1 {
  targetId: string;
  launcher: TargetLauncher;
  executableName: string;
  executableSha256?: string;
  executableHashPrefixes?: string[];
  moduleName: string;
  packaging: TargetPackaging;
  accessModel: TargetAccessModel;
  certificationLevel?: CertificationLevel;
}

export interface SolithDefinitionV1 {
  schemaVersion: typeof SOLITH_DEFINITION_SCHEMA_VERSION;
  id: string;
  title: string;
  gameVersion: string;
  /** Optional full SHA-256 of the main executable for exact drift detection. */
  targetSHA256?: string;
  /** Prefixes of SHA-256 hex — any matching prefix counts as compatible. */
  executableHashPrefixes: string[];
  author: string;
  safety: {
    requiresApproval: boolean;
    requiresOfflineConfirm: boolean;
    verificationStatus: VerificationStatus;
  };
  target: {
    executables: string[];
    arch: 'x86' | 'x64';
  };
  /**
   * Optional launcher/build-specific executable identities.
   * Certification applies per target metadata entry; game-level identity stays
   * human-readable while Steam/GOG/Epic/Xbox builds remain separate evidence.
   */
  targetMetadata?: SolithTargetMetadataV1[];
  /** Per-game reviewed connection baseline for the online-session guard. */
  connectionBaseline?: number;
  /** Aggregate pack certification (max achieved across features). */
  certificationLevel?: CertificationLevel;
  memoryFeatures?: MemoryFeatureV1[];
  saveEditor?: SaveEditorV1;
}

export interface MemoryFeatureResolutionV1 {
  /** AOB pattern e.g. "48 8B 05 ? ? ? ?" — tried before static pointer path. */
  signature?: string;
  moduleName: string;
  /** Hex offset from module base or from AOB match, e.g. "0x02F4A1". */
  baseOffset?: string;
  pointerChain?: number[];
}

export interface MemoryFeatureV1 {
  id: string;
  name: string;
  category: string;
  type: MemoryFeatureType;
  dataType: MemoryDataType;
  defaultValue: number | boolean;
  resolution: MemoryFeatureResolutionV1;
  /** Offline certification tier — L3+ required for bundled verified cheats. */
  certificationLevel?: CertificationLevel;
}

export interface SaveFieldFeatureV1 {
  id: string;
  name: string;
  category: string;
  dataType: string;
  mapping: {
    searchKey?: string;
    hexOffset?: string;
    query?: string;
  };
}

export interface SaveEditorV1 {
  defaultDirectory: string;
  extension: string;
  format: SaveFormatType;
  saveFields: SaveFieldFeatureV1[];
}

const HEX_OFFSET = z.string().regex(/^0x[0-9a-fA-F]+$/, 'baseOffset must be 0x-prefixed hex');
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/i);
const SHA256_PREFIX = z.string().regex(/^[a-f0-9]{4,64}$/i);

export const MemoryFeatureResolutionV1Schema = z.object({
  signature: z.string().min(3).max(512).optional(),
  moduleName: z.string().min(1).max(260),
  baseOffset: HEX_OFFSET.optional(),
  pointerChain: z.array(z.number().int().nonnegative()).max(32).optional(),
});

export const MemoryFeatureV1Schema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  type: z.enum(MEMORY_FEATURE_TYPES),
  dataType: z.enum(MEMORY_DATA_TYPES),
  defaultValue: z.union([z.number().finite(), z.boolean()]),
  resolution: MemoryFeatureResolutionV1Schema,
  certificationLevel: z.enum(CERTIFICATION_LEVELS).optional(),
});

export const SaveFieldFeatureV1Schema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  dataType: z.string().min(1).max(40),
  mapping: z.object({
    searchKey: z.string().max(512).optional(),
    hexOffset: HEX_OFFSET.optional(),
    query: z.string().max(1024).optional(),
  }),
});

export const SaveEditorV1Schema = z.object({
  defaultDirectory: z.string().min(1).max(512),
  extension: z.string().min(1).max(32),
  format: z.enum(SAVE_FORMAT_TYPES),
  saveFields: z.array(SaveFieldFeatureV1Schema).max(500),
});

export const SolithTargetMetadataV1Schema = z.object({
  targetId: z.string().min(1).max(128),
  launcher: z.enum(TARGET_LAUNCHERS),
  executableName: z.string().min(1).max(260),
  executableSha256: SHA256.optional(),
  executableHashPrefixes: z.array(SHA256_PREFIX).max(32).optional(),
  moduleName: z.string().min(1).max(260),
  packaging: z.enum(TARGET_PACKAGING),
  accessModel: z.enum(TARGET_ACCESS_MODELS),
  certificationLevel: z.enum(CERTIFICATION_LEVELS).optional(),
}).superRefine((target, ctx) => {
  if (target.accessModel !== 'standard_user_readonly' && target.certificationLevel && target.certificationLevel !== 'L0') {
    ctx.addIssue({
      code: 'custom',
      path: ['certificationLevel'],
      message: 'Restricted or protected target metadata cannot claim L1+ certification.',
    });
  }
});

export const SolithDefinitionV1Schema = z.object({
  schemaVersion: z.literal(SOLITH_DEFINITION_SCHEMA_VERSION),
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  gameVersion: z.string().min(1).max(80),
  targetSHA256: SHA256.optional(),
  executableHashPrefixes: z.array(SHA256_PREFIX).max(32).default([]),
  author: z.string().min(1).max(120),
  safety: z.object({
    requiresApproval: z.boolean(),
    requiresOfflineConfirm: z.boolean(),
    verificationStatus: z.enum(['verified', 'community', 'metadata-only', 'unverified']),
  }),
  target: z.object({
    executables: z.array(z.string().min(1).max(260)).min(1).max(32),
    arch: z.enum(['x86', 'x64']),
  }),
  targetMetadata: z.array(SolithTargetMetadataV1Schema).max(64).optional(),
  connectionBaseline: z.number().int().nonnegative().max(64).optional(),
  certificationLevel: z.enum(CERTIFICATION_LEVELS).optional(),
  memoryFeatures: z.array(MemoryFeatureV1Schema).max(500).optional(),
  saveEditor: SaveEditorV1Schema.optional(),
});

export function parseSolithDefinitionV1(input: unknown): SolithDefinitionV1 {
  return SolithDefinitionV1Schema.parse(input);
}

export function validateSolithDefinitionV1(input: unknown): string[] {
  const result = SolithDefinitionV1Schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/** Map schema memory data types to live-memory driver types. */
export function memoryDataTypeToLiveValue(dataType: MemoryDataType): LiveValueType {
  switch (dataType) {
    case 'boolean':
      return 'byte';
    case 'int64':
      return 'int64';
    case 'float':
      return 'float';
    case 'double':
      return 'double';
    case 'byte':
      return 'byte';
    case 'int32':
    default:
      return 'int32';
  }
}

export function memoryFeatureDefaultNumber(feature: MemoryFeatureV1): number {
  if (typeof feature.defaultValue === 'boolean') {
    return feature.defaultValue ? 1 : 0;
  }
  return feature.defaultValue;
}
