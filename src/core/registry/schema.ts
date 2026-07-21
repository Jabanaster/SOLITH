import type { CtImportResult } from '../definitions/ct-import.js';
import type { CtRawScriptCatalog } from '../script-research/types.js';
import type { RegistryAobSignature } from './compile-ct-registry.js';

export const REGISTRY_SCHEMA_VERSION = 1 as const;

export interface RegistrySourceMetadata {
  path: string;
  filename: string;
  sha256: string;
}

export interface RegistryCounts {
  pointers: number;
  scripts: number;
  aobSignatures: number;
  rejections: number;
  warnings: number;
  duplicates: number;
}

export interface RegistryArtifactMetadata {
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  generatedAt: string;
  source: RegistrySourceMetadata;
  counts: RegistryCounts;
}

export interface VersionedRegistryArtifact {
  schemaVersion: '1.0.0';
  artifact: RegistryArtifactMetadata;
  game: string;
  sourceFile: string;
  compiledAt: string;
  metadata: {
    totalPointers: number;
    totalScripts: number;
    rejectedPointers: number;
    pointerImportErrors: number;
    totalAobSignatures: number;
    aobWarnings: number;
    duplicateAobSignatures: number;
  };
  pointers: CtImportResult;
  scripts: CtRawScriptCatalog;
  aobSignatures: RegistryAobSignature[];
  rejections: CtImportResult['rejected'];
}
