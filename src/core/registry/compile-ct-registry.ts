import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseCheatTableXml, type CtImportResult } from '../definitions/ct-import.js';
import { extractAOBsFromCatalog } from '../script-research/aob-parser.js';
import { extractCheatTableRawScriptCatalog } from '../script-research/ct-script-research.js';
import type { CtRawScriptCatalog, ExtractedAobSignature } from '../script-research/types.js';
import { REGISTRY_SCHEMA_VERSION, type RegistryArtifactMetadata } from './schema.js';
import { assertValidRegistryArtifact } from './validate-registry.js';

export interface RegistryAobSignature {
  id: string;
  symbol: string;
  scanType: string;
  module: string | null;
  pattern: string;
  normalizedPattern: string;
  sourceEntryId: string | null;
  sourceEntryDescription: string;
  sourceScriptIndex: number;
  lineNumber: number;
  executable: false;
  warnings: string[];
  duplicateOf?: string;
  completeness: ExtractedAobSignature['completeness'];
  sourcePath: string;
}

export interface SolithUnifiedCtRegistry {
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

export interface CompileSolithCtRegistryOptions {
  game?: string;
  title?: string;
  outputJsonPath?: string;
  compiledAt?: string;
}

export interface CompileSolithCtRegistryFromXmlOptions extends CompileSolithCtRegistryOptions {
  sourceFile: string;
  sourcePath: string;
}

function slugId(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildRegistryAobSignatures(scripts: CtRawScriptCatalog): RegistryAobSignature[] {
  const report = extractAOBsFromCatalog(scripts);
  const scriptIndexByPath = new Map(scripts.scripts.map((script, index) => [script.path, index]));
  const sourceIdByPath = new Map(
    scripts.scripts.map((script, index) => [
      script.path,
      `ct-script-${index}-${slugId(script.path, `script-${index}`)}`,
    ]),
  );

  return report.signatures.map((signature) => {
    const sourceScriptIndex = scriptIndexByPath.get(signature.sourcePath) ?? -1;
    const idSeed = [
      sourceScriptIndex,
      signature.sourcePath,
      signature.symbol,
      signature.scanType,
      signature.module ?? '',
      signature.pattern,
      signature.lineNumber,
    ].join('|');

    const registrySignature: RegistryAobSignature = {
      id: `aob-${slugId(signature.symbol, 'signature')}-${fnv1a32(idSeed)}`,
      symbol: signature.symbol,
      scanType: signature.scanType,
      module: signature.module ?? null,
      pattern: signature.rawPattern.trim().replace(/\s+/g, ' '),
      normalizedPattern: signature.pattern,
      sourceEntryId: sourceIdByPath.get(signature.sourcePath) ?? null,
      sourceEntryDescription: signature.sourceEntry,
      sourceScriptIndex,
      lineNumber: signature.lineNumber,
      executable: false,
      warnings: signature.warnings,
      completeness: signature.completeness,
      sourcePath: signature.sourcePath,
    };

    if (signature.duplicateOf) registrySignature.duplicateOf = signature.duplicateOf;
    return registrySignature;
  });
}

export async function compileSolithCtRegistry(
  ctFilePath: string,
  options: CompileSolithCtRegistryOptions = {},
): Promise<SolithUnifiedCtRegistry> {
  const xmlText = await fs.readFile(ctFilePath, 'utf8');
  const sourceFile = path.basename(ctFilePath);
  const sourcePath = path.resolve(ctFilePath);
  return compileSolithCtRegistryFromXml(xmlText, {
    ...options,
    sourceFile,
    sourcePath,
  });
}

export async function compileSolithCtRegistryFromXml(
  xmlText: string,
  options: CompileSolithCtRegistryFromXmlOptions,
): Promise<SolithUnifiedCtRegistry> {
  const sourceFile = options.sourceFile;
  const sourcePath = options.sourcePath;
  const sourceSha256 = crypto.createHash('sha256').update(xmlText, 'utf8').digest('hex');
  const game = options.game ?? options.title ?? path.basename(sourceFile, path.extname(sourceFile));
  const title = options.title ?? game;

  const [pointers, scripts] = await Promise.all([
    parseCheatTableXml(xmlText, { title }),
    extractCheatTableRawScriptCatalog(xmlText, {
      title,
      sourceNote:
        'Raw Cheat Engine script text extracted as inert Solith metadata. Scripts are never executed.',
    }),
  ]);
  const aobSignatures = buildRegistryAobSignatures(scripts);
  const compiledAt = options.compiledAt ?? new Date().toISOString();

  const registry: SolithUnifiedCtRegistry = {
    schemaVersion: '1.0.0',
    artifact: {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      generatedAt: compiledAt,
      source: {
        path: sourcePath,
        filename: sourceFile,
        sha256: sourceSha256,
      },
      counts: {
        pointers: pointers.accepted.length,
        scripts: scripts.scripts.length,
        aobSignatures: aobSignatures.length,
        rejections: pointers.rejected.length,
        warnings: aobSignatures.reduce((count, signature) => count + signature.warnings.length, 0),
        duplicates: aobSignatures.filter((signature) => signature.duplicateOf).length,
      },
    },
    game,
    sourceFile,
    compiledAt,
    metadata: {
      totalPointers: pointers.accepted.length,
      totalScripts: scripts.scripts.length,
      rejectedPointers: pointers.rejected.length,
      pointerImportErrors: pointers.errors.length,
      totalAobSignatures: aobSignatures.length,
      aobWarnings: aobSignatures.reduce((count, signature) => count + signature.warnings.length, 0),
      duplicateAobSignatures: aobSignatures.filter((signature) => signature.duplicateOf).length,
    },
    pointers,
    scripts,
    aobSignatures,
    rejections: pointers.rejected,
  };

  assertValidRegistryArtifact(registry);

  if (options.outputJsonPath) {
    await fs.mkdir(path.dirname(options.outputJsonPath), { recursive: true });
    await fs.writeFile(options.outputJsonPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  return registry;
}
