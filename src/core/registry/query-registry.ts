import type {
  CtImportEntry,
  CtImportResult,
} from '../definitions/ct-import.js';
import type { CtRawScriptCatalogEntry } from '../script-research/types.js';
import type { CompiledCtRegistry } from './load-registry.js';
import type { RegistryAobSignature } from './compile-ct-registry.js';

export type RegistryResultType = 'pointer' | 'aob' | 'script' | 'rejection';

export interface RegistrySearchQuery {
  text?: string;
  type?: RegistryResultType | RegistryResultType[];
  module?: string;
  valueType?: string;
  source?: string;
  /** Partial / case-insensitive match against AOB symbol or pointer title. */
  symbol?: string;
  scanType?: string;
  pattern?: string;
  warnings?: boolean;
  duplicate?: boolean;
  /** When true, omit rejection-type results from the result set. */
  excludeRejected?: boolean;
}

export interface RegistrySourceLink {
  sourceFile: string;
  sourceEntryId: string | null;
  sourceEntryDescription: string;
  sourceScriptIndex: number | null;
  sourcePath: string | null;
  lineNumber: number | null;
}

export interface RegistrySearchResult {
  id: string;
  type: RegistryResultType;
  title: string;
  description: string;
  module: string | null;
  valueType: string | null;
  scanType: string | null;
  pattern: string | null;
  normalizedPattern: string | null;
  executable: false;
  warnings: string[];
  duplicateOf?: string;
  source: RegistrySourceLink;
  entry: CtImportEntry | RegistryAobSignature | CtRawScriptCatalogEntry | CtImportResult['rejected'][number];
}

export type RegistryEntry = RegistrySearchResult;

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

function normalizePattern(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\?+/g, '??')
    .toUpperCase();
}

function includesText(fields: Array<string | null | undefined>, needle: string | undefined): boolean {
  if (!needle) return true;
  const normalizedNeedle = lower(needle);
  return fields.some((field) => lower(field).includes(normalizedNeedle));
}

function requestedTypes(query: RegistrySearchQuery): Set<RegistryResultType> {
  if (!query.type) return new Set(['pointer', 'aob', 'script', 'rejection']);
  return new Set(Array.isArray(query.type) ? query.type : [query.type]);
}

function scriptId(script: CtRawScriptCatalogEntry, index: number): string {
  const slug = script.path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `ct-script-${index}-${slug || `script-${index}`}`;
}

function pointerResult(registry: CompiledCtRegistry, pointer: CtImportEntry): RegistrySearchResult {
  return {
    id: pointer.id,
    type: 'pointer',
    title: pointer.name,
    description: pointer.name,
    module: pointer.moduleName,
    valueType: pointer.dataType,
    scanType: null,
    pattern: null,
    normalizedPattern: null,
    executable: false,
    warnings: pointer.rejectedReason ? [pointer.rejectedReason] : [],
    source: {
      sourceFile: registry.sourceFile,
      sourceEntryId: pointer.id,
      sourceEntryDescription: pointer.name,
      sourceScriptIndex: null,
      sourcePath: pointer.category,
      lineNumber: null,
    },
    entry: pointer,
  };
}

function aobResult(registry: CompiledCtRegistry, signature: RegistryAobSignature): RegistrySearchResult {
  return {
    id: signature.id,
    type: 'aob',
    title: signature.symbol,
    description: signature.sourceEntryDescription,
    module: signature.module,
    valueType: null,
    scanType: signature.scanType,
    pattern: signature.pattern,
    normalizedPattern: signature.normalizedPattern,
    executable: false,
    warnings: signature.warnings,
    duplicateOf: signature.duplicateOf,
    source: {
      sourceFile: registry.sourceFile,
      sourceEntryId: signature.sourceEntryId,
      sourceEntryDescription: signature.sourceEntryDescription,
      sourceScriptIndex: signature.sourceScriptIndex,
      sourcePath: signature.sourcePath,
      lineNumber: signature.lineNumber,
    },
    entry: signature,
  };
}

function scriptResult(registry: CompiledCtRegistry, script: CtRawScriptCatalogEntry, index: number): RegistrySearchResult {
  return {
    id: scriptId(script, index),
    type: 'script',
    title: script.name,
    description: script.path,
    module: null,
    valueType: null,
    scanType: null,
    pattern: null,
    normalizedPattern: null,
    executable: false,
    warnings: [],
    source: {
      sourceFile: registry.sourceFile,
      sourceEntryId: scriptId(script, index),
      sourceEntryDescription: script.name,
      sourceScriptIndex: index,
      sourcePath: script.path,
      lineNumber: null,
    },
    entry: script,
  };
}

function rejectionResult(
  registry: CompiledCtRegistry,
  rejection: CtImportResult['rejected'][number],
  index: number,
): RegistrySearchResult {
  return {
    id: `rejection-${index}-${rejection.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || index}`,
    type: 'rejection',
    title: rejection.name,
    description: rejection.reason,
    module: null,
    valueType: null,
    scanType: null,
    pattern: null,
    normalizedPattern: null,
    executable: false,
    warnings: [rejection.reason],
    source: {
      sourceFile: registry.sourceFile,
      sourceEntryId: null,
      sourceEntryDescription: rejection.name,
      sourceScriptIndex: null,
      sourcePath: null,
      lineNumber: null,
    },
    entry: rejection,
  };
}

function allResults(registry: CompiledCtRegistry): RegistrySearchResult[] {
  return [
    ...registry.pointers.accepted.map((pointer) => pointerResult(registry, pointer)),
    ...registry.aobSignatures.map((signature) => aobResult(registry, signature)),
    ...registry.scripts.scripts.map((script: CtRawScriptCatalogEntry, index: number) =>
      scriptResult(registry, script, index),
    ),
    ...registry.rejections.map((rejection, index) => rejectionResult(registry, rejection, index)),
  ];
}

function matches(result: RegistrySearchResult, query: RegistrySearchQuery): boolean {
  const textFields = [
    result.title,
    result.description,
    result.module,
    result.valueType,
    result.scanType,
    result.pattern,
    result.normalizedPattern,
    result.source.sourceEntryDescription,
    result.source.sourcePath,
    result.type === 'script' ? (result.entry as CtRawScriptCatalogEntry).raw_script_content : null,
  ];

  if (!includesText(textFields, query.text)) return false;
  if (query.symbol) {
    const symbolHaystack =
      result.type === 'aob'
        ? result.title
        : result.type === 'pointer'
          ? result.title
          : `${result.title} ${result.description}`;
    if (!lower(symbolHaystack).includes(lower(query.symbol))) return false;
  }
  if (query.module && lower(result.module) !== lower(query.module)) return false;
  if (query.valueType && lower(result.valueType) !== lower(query.valueType)) return false;
  if (query.source && !includesText([result.source.sourceEntryDescription, result.source.sourcePath], query.source)) return false;
  if (query.scanType && lower(result.scanType) !== lower(query.scanType)) return false;
  if (query.pattern) {
    const patternNeedle = normalizePattern(query.pattern);
    const haystack = normalizePattern(`${result.pattern ?? ''} ${result.normalizedPattern ?? ''}`);
    if (!haystack.includes(patternNeedle)) return false;
  }
  if (query.warnings != null && (result.warnings.length > 0) !== query.warnings) return false;
  if (query.duplicate != null && Boolean(result.duplicateOf) !== query.duplicate) return false;
  return true;
}

export function searchRegistry(
  registry: CompiledCtRegistry,
  query: RegistrySearchQuery = {},
): RegistrySearchResult[] {
  const types = requestedTypes(query);
  return allResults(registry)
    .filter((result) => types.has(result.type))
    .filter((result) => !(query.excludeRejected && result.type === 'rejection'))
    .filter((result) => matches(result, query))
    .sort((a, b) => {
      const typeOrder: Record<RegistryResultType, number> = { pointer: 0, aob: 1, script: 2, rejection: 3 };
      return typeOrder[a.type] - typeOrder[b.type] || a.id.localeCompare(b.id);
    });
}

export function getRegistryEntry(registry: CompiledCtRegistry, id: string): RegistryEntry | null {
  return searchRegistry(registry).find((result) => result.id === id) ?? null;
}
