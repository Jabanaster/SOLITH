import { parseStringPromise } from 'xml2js';
import { slugifyGameId } from '../trainer-catalog/types.js';
import type { MemoryFeatureV1, SolithDefinitionV1 } from './schema.v1.js';
import { SOLITH_DEFINITION_SCHEMA_VERSION } from './schema.v1.js';

export interface CtMetadataEntry {
  id: string;
  name: string;
  depth: number;
  hasScript: boolean;
  variableType?: string;
  addressPreview?: string;
  category: string;
}

export interface CtMetadataResult {
  title: string;
  catalogGameId: string;
  sourceNote: string;
  entries: CtMetadataEntry[];
  definition: SolithDefinitionV1;
  pointerImportAccepted: number;
  scriptOnlyCount: number;
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

function slugId(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return base || `ct-ref-${index}`;
}

function guessCategory(name: string): string {
  const lower = name.toLowerCase();
  if (/hp|health|stamina|spirit|parry|blink|char pointer/i.test(lower)) return 'Player';
  if (/ammo|item|inventory|bag|vendor|copper|abyss gear|kuku|resource|material/i.test(lower)) return 'Inventory';
  if (/attack|defense|resistant|attr/i.test(lower)) return 'Stats';
  if (/weapon|polish|durability/i.test(lower)) return 'Weapons';
  if (/enemy|kill/i.test(lower)) return 'Enemies';
  if (/friendship|pet|archery|dragon|reputation|gui|menu/i.test(lower)) return 'Game';
  return 'Research';
}

function guessDataType(variableType?: string): MemoryFeatureV1['dataType'] {
  if (!variableType) return 'int32';
  const vt = variableType.toLowerCase();
  if (vt.includes('float')) return 'float';
  if (vt.includes('double')) return 'double';
  if (vt.includes('8 bytes')) return 'int64';
  if (vt.includes('byte')) return 'byte';
  return 'int32';
}

function flattenEntries(node: unknown, depth = 0, out: Array<Record<string, unknown>> = []): void {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const desc = textValue(record.Description).replace(/^"|"$/g, '').trim();

  if (desc) {
    out.push({
      description: desc,
      depth,
      variableType: textValue(record.VariableType),
      address: textValue(record.Address),
      hasScript: !!(record.AutoAssemblerScript || record.AssemblerScript || record.LuaScript),
    });
  }

  const children = record.CheatEntry;
  if (!children) return;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) flattenEntries(child, depth + 1, out);
}

function isNoiseTopLevel(name: string): boolean {
  return (
    /^Toggle (Scripts|Compact View)$/i.test(name) ||
    /^Old scripts/i.test(name) ||
    /opencheattables\.com/i.test(name) ||
    /^Notice:/i.test(name)
  );
}

export async function parseCheatTableMetadata(
  xmlText: string,
  options: {
    title?: string;
    sourceNote?: string;
    pointerImportAccepted?: number;
    executables?: string[];
  } = {},
): Promise<CtMetadataResult> {
  const parsed = (await parseStringPromise(xmlText, { explicitArray: false, trim: true })) as Record<
    string,
    unknown
  >;
  const table = (parsed.CheatTable ?? parsed.cheatTable) as Record<string, unknown> | undefined;
  const flat: Array<Record<string, unknown>> = [];
  if (table?.CheatEntries) flattenEntries(table.CheatEntries, 0, flat);

  const title =
    options.title ??
    (textValue(table?.CheatTableTitle) ||
      textValue(table?.Title) ||
      'Imported Cheat Table');
  const catalogGameId = slugifyGameId(title);

  const topLevel = flat.filter((row) => row.depth === 1 && !isNoiseTopLevel(String(row.description)));
  const entries: CtMetadataEntry[] = topLevel.map((row, index) => {
    const name = String(row.description);
    return {
      id: slugId(name, index),
      name,
      depth: 1,
      hasScript: Boolean(row.hasScript),
      variableType: row.variableType ? String(row.variableType) : undefined,
      addressPreview: row.address ? String(row.address).slice(0, 120) : undefined,
      category: guessCategory(name),
    };
  });

  const executable = options.executables?.[0] ?? 'Game.exe';

  const memoryFeatures: MemoryFeatureV1[] = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    category: entry.category,
    type: 'scan_unknown',
    dataType: guessDataType(entry.variableType),
    defaultValue: 1,
    certificationLevel: 'L0',
    resolution: {
      moduleName: executable,
      baseOffset: entry.addressPreview?.startsWith('0x') ? entry.addressPreview : undefined,
    },
  }));

  const definition: SolithDefinitionV1 = {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id: catalogGameId,
    title,
    gameVersion: 'community-ct',
    executableHashPrefixes: [],
    author: 'ct-metadata-import',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      executables: options.executables?.length ? options.executables : [executable],
      arch: 'x64',
    },
    connectionBaseline: 0,
    certificationLevel: 'L0',
    memoryFeatures,
  };

  return {
    title,
    catalogGameId,
    sourceNote:
      options.sourceNote ??
      'Metadata extracted from community Cheat Engine table. Auto Assembler scripts are reference-only in Solith.',
    entries,
    definition,
    pointerImportAccepted: options.pointerImportAccepted ?? 0,
    scriptOnlyCount: entries.filter((e) => e.hasScript).length,
  };
}
