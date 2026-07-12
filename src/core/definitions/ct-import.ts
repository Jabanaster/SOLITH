import { parseStringPromise } from 'xml2js';
import type { MemoryDataType, MemoryFeatureV1, SolithDefinitionV1 } from './schema.v1.js';
import { SOLITH_DEFINITION_SCHEMA_VERSION, validateSolithDefinitionV1 } from './schema.v1.js';
import { slugifyGameId } from '../trainer-catalog/types.js';

export interface CtImportEntry {
  id: string;
  name: string;
  category: string;
  dataType: MemoryDataType;
  moduleName: string;
  baseOffset?: string;
  pointerChain: number[];
  rejectedReason?: string;
}

export interface CtImportResult {
  title: string;
  catalogGameId: string;
  accepted: CtImportEntry[];
  rejected: Array<{ name: string; reason: string }>;
  definition: SolithDefinitionV1;
  errors: string[];
}

const REJECTED_CHILD_TAGS = [
  'AutoAssemblerScript',
  'AssemblerScript',
  'LuaScript',
  'CheatEntry',
] as const;

function mapVariableType(raw: string | undefined): MemoryDataType | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes('4 bytes') || normalized === 'dword') return 'int32';
  if (normalized.includes('8 bytes') || normalized === 'qword') return 'int64';
  if (normalized.includes('float')) return 'float';
  if (normalized.includes('double')) return 'double';
  if (normalized.includes('byte')) return 'byte';
  if (normalized.includes('bool')) return 'byte';
  return null;
}

function slugId(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return base || `cheat-${index}`;
}

function parseAddress(address: string): { moduleName: string; baseOffset?: string } | null {
  const trimmed = address.trim();
  const moduleMatch = trimmed.match(/^"?([^"+]+)"?\+([0-9A-Fa-fx]+)/);
  if (moduleMatch) {
    const offset = moduleMatch[2].startsWith('0x') ? moduleMatch[2] : `0x${moduleMatch[2]}`;
    return { moduleName: moduleMatch[1], baseOffset: offset };
  }
  if (/^0x[0-9A-Fa-fa-f]+$/i.test(trimmed)) {
    return { moduleName: 'unknown-module.exe' };
  }
  return null;
}

function hasRejectedScript(entry: Record<string, unknown>): string | null {
  for (const tag of REJECTED_CHILD_TAGS) {
    if (tag === 'CheatEntry') continue;
    if (entry[tag]) return `${tag} not supported`;
  }
  if (entry.LuaScript && String(entry.LuaScript).trim()) return 'LuaScript not supported';
  if (entry.AutoAssemblerScript && String(entry.AutoAssemblerScript).trim()) return 'AutoAssembler not supported';
  return null;
}

function flattenCheatEntries(node: unknown, out: Record<string, unknown>[]): void {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  if (record.CheatEntry && !record.VariableType && !record.Address && !record.Description) {
    const children = record.CheatEntry;
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) flattenCheatEntries(child, out);
    return;
  }

  if (record.CheatEntries && !record.VariableType && !record.Address) {
    flattenCheatEntries(record.CheatEntries, out);
    return;
  }

  if (record.Description || record.VariableType || record.Address) {
    out.push(record);
  }

  const children = record.CheatEntry;
  if (!children) return;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) flattenCheatEntries(child, out);
}

function textValue(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return String(field[0] ?? '');
  if (typeof field === 'object' && field !== null && '_' in (field as object)) {
    return String((field as { _: string })._);
  }
  return String(field);
}

function parseOffsets(entry: Record<string, unknown>): number[] {
  const offsetsRaw = entry.Offsets;
  if (!offsetsRaw || typeof offsetsRaw !== 'object') return [];
  const offsetList = (offsetsRaw as { Offset?: unknown }).Offset;
  if (!offsetList) return [];
  const items = Array.isArray(offsetList) ? offsetList : [offsetList];
  return items
    .map((o) => {
      const s = textValue(o).trim();
      const hex = s.startsWith('0x') ? s : `0x${s}`;
      const n = Number.parseInt(hex.slice(2), 16);
      return Number.isFinite(n) ? n : null;
    })
    .filter((n): n is number => n !== null);
}

export async function parseCheatTableXml(xmlText: string, options: { title?: string } = {}): Promise<CtImportResult> {
  const rejected: Array<{ name: string; reason: string }> = [];
  const accepted: CtImportEntry[] = [];

  let parsed: Record<string, unknown>;
  try {
    parsed = (await parseStringPromise(xmlText, { explicitArray: false, trim: true })) as Record<string, unknown>;
  } catch {
    return emptyResult(options.title ?? 'Imported Table', ['xml_parse_error']);
  }

  const table = (parsed.CheatTable ?? parsed.cheatTable) as Record<string, unknown> | undefined;
  if (!table) {
    return emptyResult(options.title ?? 'Imported Table', ['missing_CheatTable_root']);
  }

  const titleFromTable =
    textValue(table.CheatTableTitle) || textValue(table.Title) || 'Imported Memory Table';
  const title = options.title ?? titleFromTable;

  const catalogGameId = slugifyGameId(title);
  const flat: Record<string, unknown>[] = [];
  flattenCheatEntries(table.CheatEntries, flat);

  flat.forEach((entry, index) => {
    const name = textValue(entry.Description).replace(/^"|"$/g, '').trim() || `Cheat ${index + 1}`;
    const scriptReject = hasRejectedScript(entry);
    if (scriptReject) {
      rejected.push({ name, reason: scriptReject });
      return;
    }

    const dataType = mapVariableType(textValue(entry.VariableType));
    const address = parseAddress(textValue(entry.Address));
    if (!dataType) {
      rejected.push({ name, reason: 'unsupported VariableType' });
      return;
    }
    if (!address?.moduleName) {
      rejected.push({ name, reason: 'unsupported Address format' });
      return;
    }

    accepted.push({
      id: slugId(name, index),
      name,
      category: 'Imported',
      dataType,
      moduleName: address.moduleName,
      baseOffset: address.baseOffset,
      pointerChain: parseOffsets(entry),
    });
  });

  const memoryFeatures: MemoryFeatureV1[] = accepted.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    type: e.baseOffset || e.pointerChain.length > 0 ? 'freeze' : 'scan_unknown',
    dataType: e.dataType,
    defaultValue: e.dataType === 'float' || e.dataType === 'double' ? 100 : 9999,
    certificationLevel: 'L0',
    resolution: {
      moduleName: e.moduleName,
      baseOffset: e.baseOffset,
      pointerChain: e.pointerChain.length > 0 ? e.pointerChain : undefined,
    },
  }));

  const definition: SolithDefinitionV1 = {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id: catalogGameId,
    title,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'ct-import',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      executables: [...new Set(accepted.map((a) => a.moduleName).filter((m) => m !== 'unknown-module.exe'))],
      arch: 'x64',
    },
    memoryFeatures,
  };

  if (definition.target.executables.length === 0) {
    definition.target.executables = ['Game.exe'];
  }

  const errors = validateSolithDefinitionV1(definition);
  return { title, catalogGameId, accepted, rejected, definition, errors };
}

function emptyResult(title: string, errors: string[]): CtImportResult {
  const catalogGameId = slugifyGameId(title);
  const definition: SolithDefinitionV1 = {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id: catalogGameId,
    title,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'ct-import',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: { executables: ['Game.exe'], arch: 'x64' },
    memoryFeatures: [],
  };
  return { title, catalogGameId, accepted: [], rejected: [], definition, errors };
}
