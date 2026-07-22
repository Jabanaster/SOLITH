import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseCheatTableXml, type CtImportResult } from '../definitions/ct-import.js';
import { extractAOBsFromCatalog } from '../script-research/aob-parser.js';
import { extractCheatTableRawScriptCatalog } from '../script-research/ct-script-research.js';
import type { CtRawScriptCatalog, ExtractedAobSignature } from '../script-research/types.js';
import { REGISTRY_SCHEMA_VERSION, type RegistryArtifactMetadata } from './schema.js';
import { assertValidRegistryArtifact } from './validate-registry.js';

export const CT_COMPILER_PIPELINE_SCHEMA_VERSION = '1.2.0' as const;
export const DEFAULT_MAX_CT_BYTES = 10 * 1024 * 1024;
export type CtCompilerSourceKind = 'ct-file' | 'ct-zip-entry' | 'ct-xml' | 'manual-import';

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

export interface CtCompilerPipelineEntry {
  ct_entry_id: string;
  entry_path: string[];
  label: string;
  type: string;
  address_data: {
    base: string;
    root_offset?: string;
    raw_address: string;
    pointer_chain: string[];
    is_valid_math: boolean;
  };
  linked_script_ids: string[];
  linked_aob_ids: string[];
  entry_state: {
    current_tier: 'L0';
    proven_stable_sessions: 0;
  };
}

export interface CtCompilerPipelineAobSignature {
  aob_id: string;
  origin: string | null;
  signature_type: 'script-extracted';
  pattern: string;
  module_target: string | null;
  symbol: string;
  scan_type: string;
  line_number: number;
  warnings: string[];
}

export interface CtCompilerPipelineScriptRef {
  script_id: string;
  type: CtRawScriptCatalog['scripts'][number]['type'];
  catalog_storage_key: string;
  excerpt: string;
  rejection_flags: Array<'L0_UNVERIFIED' | 'CONTAINS_AA' | 'CONTAINS_LUA' | 'CONTAINS_SCRIPT_METADATA'>;
}

export interface CtCompilerPipelineRegistry {
  $schema: 'https://solith.dev/schemas/ct-compiler-v1.2.0.json';
  schema_version: typeof CT_COMPILER_PIPELINE_SCHEMA_VERSION;
  compiled_at: string;
  source: {
    file: string;
    sha256: string;
    kind: CtCompilerSourceKind;
    user_certified?: true;
  };
  global_status: {
    certification_level: 'L0';
    verification_cycles_completed: 0;
    last_monitored_pid: null;
    local_trust_signature?: string;
  };
  entries: CtCompilerPipelineEntry[];
  aob_signatures: CtCompilerPipelineAobSignature[];
  script_catalog_refs: CtCompilerPipelineScriptRef[];
  rejections: Array<{ name: string; reason: string }>;
  warnings: string[];
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
  pipeline?: CtCompilerPipelineRegistry;
}

export interface CompileSolithCtRegistryOptions {
  game?: string;
  title?: string;
  outputJsonPath?: string;
  compiledAt?: string;
  maxCtBytes?: number;
  sourceKind?: CtCompilerSourceKind;
  userCertified?: boolean;
  localTrustSignature?: string;
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

function scriptCatalogId(script: CtRawScriptCatalog['scripts'][number], index: number): string {
  return `ct-script-${index}-${slugId(script.path, `script-${index}`)}`;
}

function scriptStorageKey(scriptId: string): string {
  return `quarantine::${scriptId}::inert`;
}

function pointerChainHex(pointerChain: number[]): string[] {
  return pointerChain.map((offset) => `0x${offset.toString(16).toUpperCase()}`);
}

function scriptRejectionFlags(
  script: CtRawScriptCatalog['scripts'][number],
): CtCompilerPipelineScriptRef['rejection_flags'] {
  const flags: CtCompilerPipelineScriptRef['rejection_flags'] = ['L0_UNVERIFIED'];
  if (script.type === 'AutoAssembler_Script') flags.push('CONTAINS_AA');
  if (script.type === 'Lua_Script') flags.push('CONTAINS_LUA');
  if (script.type === 'CheatScript_Metadata') flags.push('CONTAINS_SCRIPT_METADATA');
  return flags;
}

function buildPipelineRegistry(input: {
  compiledAt: string;
  sourceFile: string;
  sourcePath: string;
  sourceSha256: string;
  sourceKind?: CtCompilerSourceKind;
  userCertified?: boolean;
  localTrustSignature?: string;
  pointers: CtImportResult;
  scripts: CtRawScriptCatalog;
  aobSignatures: RegistryAobSignature[];
}): CtCompilerPipelineRegistry {
  const scriptIdByIndex = new Map(
    input.scripts.scripts.map((script, index) => [index, scriptCatalogId(script, index)]),
  );
  const aobIdsBySourceScript = new Map<number, string[]>();
  for (const signature of input.aobSignatures) {
    const list = aobIdsBySourceScript.get(signature.sourceScriptIndex) ?? [];
    list.push(signature.id);
    aobIdsBySourceScript.set(signature.sourceScriptIndex, list);
  }
  const warnings = [
    ...input.pointers.errors.map((error) => `pointer_import:${error}`),
    ...input.aobSignatures.flatMap((signature) =>
      signature.warnings.map((warning) => `aob:${signature.id}:${warning}`),
    ),
    ...(input.userCertified
      ? ['manual_import_declared: still requires bounded read-only verification before L3 and L4 gates']
      : []),
  ];

  return {
    $schema: 'https://solith.dev/schemas/ct-compiler-v1.2.0.json',
    schema_version: CT_COMPILER_PIPELINE_SCHEMA_VERSION,
    compiled_at: input.compiledAt,
    source: {
      file: input.sourcePath.includes('#') ? input.sourcePath : input.sourceFile,
      sha256: input.sourceSha256,
      kind: input.sourceKind ?? (input.sourcePath.includes('#') ? 'ct-zip-entry' : 'ct-file'),
      ...(input.userCertified ? { user_certified: true as const } : {}),
    },
    global_status: {
      certification_level: 'L0',
      verification_cycles_completed: 0,
      last_monitored_pid: null,
      ...(input.localTrustSignature ? { local_trust_signature: input.localTrustSignature } : {}),
    },
    entries: input.pointers.accepted.map((pointer) => ({
      ct_entry_id: pointer.ctId ?? pointer.id,
      entry_path: [pointer.category, pointer.name],
      label: pointer.name,
      type: pointer.dataType,
      address_data: {
        base: pointer.moduleName,
        root_offset: pointer.baseOffset,
        raw_address: pointer.rawAddress,
        pointer_chain: pointerChainHex(pointer.pointerChain),
        is_valid_math: pointer.liveResolution !== 'incomplete',
      },
      linked_script_ids: [],
      linked_aob_ids: [],
      entry_state: {
        current_tier: 'L0',
        proven_stable_sessions: 0,
      },
    })),
    aob_signatures: input.aobSignatures.map((signature) => ({
      aob_id: signature.id,
      origin: signature.sourceScriptIndex >= 0
        ? scriptIdByIndex.get(signature.sourceScriptIndex) ?? null
        : null,
      signature_type: 'script-extracted',
      pattern: signature.normalizedPattern,
      module_target: signature.module,
      symbol: signature.symbol,
      scan_type: signature.scanType,
      line_number: signature.lineNumber,
      warnings: signature.warnings,
    })),
    script_catalog_refs: input.scripts.scripts.map((script, index) => {
      const scriptId = scriptIdByIndex.get(index) ?? scriptCatalogId(script, index);
      return {
        script_id: scriptId,
        type: script.type,
        catalog_storage_key: scriptStorageKey(scriptId),
        excerpt: script.script_excerpt,
        rejection_flags: scriptRejectionFlags(script),
      };
    }),
    rejections: input.pointers.rejected,
    warnings,
  };
}

function assertCtSizeWithinLimit(byteLength: number, maxCtBytes = DEFAULT_MAX_CT_BYTES): void {
  if (byteLength > maxCtBytes) {
    throw new Error(`CT file exceeds ${maxCtBytes} byte import cap.`);
  }
}

export async function compileSolithCtRegistry(
  ctFilePath: string,
  options: CompileSolithCtRegistryOptions = {},
): Promise<SolithUnifiedCtRegistry> {
  const stats = await fs.stat(ctFilePath);
  assertCtSizeWithinLimit(stats.size, options.maxCtBytes);
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
  assertCtSizeWithinLimit(Buffer.byteLength(xmlText, 'utf8'), options.maxCtBytes);
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
  const pipeline = buildPipelineRegistry({
    compiledAt,
    sourceFile,
    sourcePath,
    sourceSha256,
    sourceKind: options.sourceKind,
    userCertified: options.userCertified,
    localTrustSignature: options.localTrustSignature,
    pointers,
    scripts,
    aobSignatures,
  });

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
    pipeline,
  };

  assertValidRegistryArtifact(registry);

  if (options.outputJsonPath) {
    await fs.mkdir(path.dirname(options.outputJsonPath), { recursive: true });
    await fs.writeFile(options.outputJsonPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  return registry;
}
