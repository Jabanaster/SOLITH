import type { MemoryFeatureV1, SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { SOLITH_DEFINITION_SCHEMA_VERSION } from '../definitions/schema.v1.js';
import { slugifyGameId } from '../trainer-catalog/types.js';
import type { DumpspaceImportSummary, DumpspaceMember, DumpspaceOffsetEntry } from './types.js';
import { UE_CHEAT_MEMBER_PATTERNS } from './types.js';

interface DumpspaceFileEnvelope<T> {
  updated_at?: string;
  version?: number;
  credit?: { dumper_used?: string; dumper_link?: string };
  data: T;
}

function slugId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);
}

function mapUeTypeToDataType(typeLabel: string): MemoryFeatureV1['dataType'] {
  const t = typeLabel.toLowerCase();
  if (t.includes('double')) return 'double';
  if (t.includes('float')) return 'float';
  if (t.includes('int64') || t.includes('uint64')) return 'int64';
  if (t.includes('bool')) return 'boolean';
  if (t.includes('byte') || t.includes('uint8')) return 'byte';
  return 'int32';
}

export function parseDumpspaceOffsetsJson(jsonText: string): {
  offsets: DumpspaceOffsetEntry[];
  credit?: DumpspaceFileEnvelope<unknown>['credit'];
  updatedAt?: string;
  version?: number;
} {
  const parsed = JSON.parse(jsonText) as DumpspaceFileEnvelope<Array<[string, number]>>;
  const offsets = (parsed.data ?? []).map(([name, offset]) => ({ name, offset }));
  return {
    offsets,
    credit: parsed.credit,
    updatedAt: parsed.updated_at,
    version: parsed.version,
  };
}

function parseMemberTuple(
  className: string,
  memberKey: string,
  raw: unknown,
): DumpspaceMember | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const typeLabel = typeof raw[0] === 'string' ? raw[0] : JSON.stringify(raw[0]);
  const offset = Number(raw[1]);
  const size = Number(raw[2]);
  if (!Number.isFinite(offset) || !Number.isFinite(size)) return null;
  const isBit = memberKey.includes(' : 1');
  const memberName = memberKey.replace(/\s*:\s*1$/, '').trim();
  return { className, memberName, offset, size, typeLabel, isBit };
}

export function parseDumpspaceClassesJson(jsonText: string): DumpspaceMember[] {
  const parsed = JSON.parse(jsonText) as DumpspaceFileEnvelope<Array<Record<string, unknown>>>;
  const members: DumpspaceMember[] = [];

  for (const entry of parsed.data ?? []) {
    for (const [className, body] of Object.entries(entry)) {
      if (!Array.isArray(body)) continue;
      for (const item of body) {
        if (!item || typeof item !== 'object') continue;
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
          if (key.startsWith('__')) continue;
          const member = parseMemberTuple(className, key, value);
          if (member) members.push(member);
        }
      }
    }
  }
  return members;
}

export function findCheatRelevantMembers(members: DumpspaceMember[]): DumpspaceMember[] {
  const seen = new Set<string>();
  const out: DumpspaceMember[] = [];
  for (const member of members) {
    if (!UE_CHEAT_MEMBER_PATTERNS.some((re) => re.test(member.memberName))) continue;
    const key = `${member.className}::${member.memberName}@${member.offset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(member);
  }
  return out.sort((a, b) => a.className.localeCompare(b.className) || a.offset - b.offset);
}

export function buildDumpspaceImportSummary(input: {
  title: string;
  executable: string;
  offsetsJson?: string;
  classesJson?: string;
  structsJson?: string;
}): DumpspaceImportSummary {
  const offsets = input.offsetsJson ? parseDumpspaceOffsetsJson(input.offsetsJson).offsets : [];
  const offsetMeta = input.offsetsJson ? parseDumpspaceOffsetsJson(input.offsetsJson) : null;
  const classMembers = input.classesJson ? parseDumpspaceClassesJson(input.classesJson) : [];
  const structMembers = input.structsJson ? parseDumpspaceClassesJson(input.structsJson) : [];
  const allMembers = [...classMembers, ...structMembers];
  const classNames = new Set(classMembers.map((m) => m.className));
  const structNames = new Set(structMembers.map((m) => m.className));

  return {
    title: input.title,
    catalogGameId: slugifyGameId(input.title),
    ueOffsets: offsets,
    classCount: classNames.size,
    structCount: structNames.size,
    cheatCandidates: findCheatRelevantMembers(allMembers),
    dumperCredit: offsetMeta?.credit,
    updatedAt: offsetMeta?.updatedAt,
    version: offsetMeta?.version,
  };
}

export function buildSolithDefinitionFromDumpspace(input: {
  title: string;
  executable: string;
  summary: DumpspaceImportSummary;
}): SolithDefinitionV1 {
  const memoryFeatures: MemoryFeatureV1[] = input.summary.cheatCandidates.map((member, index) => ({
    id: slugId(`${member.className}-${member.memberName}`) || `ue-member-${index + 1}`,
    name: `${member.className}.${member.memberName}`,
    category: 'UE Research',
    type: 'scan_unknown',
    dataType: mapUeTypeToDataType(member.typeLabel),
    defaultValue: 0,
    certificationLevel: 'L0',
    resolution: {
      moduleName: input.executable,
      baseOffset: `0x${member.offset.toString(16)}`,
    },
  }));

  return {
    schemaVersion: SOLITH_DEFINITION_SCHEMA_VERSION,
    id: input.summary.catalogGameId,
    title: input.title,
    gameVersion: 'ue-dumpspace',
    executableHashPrefixes: [],
    author: 'ue-dumpspace-import',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      executables: [input.executable],
      arch: 'x64',
    },
    connectionBaseline: 0,
    certificationLevel: 'L0',
    memoryFeatures,
  };
}

export function buildDumpspaceResearchNotes(summary: DumpspaceImportSummary): string[] {
  const notes = [
    `Imported from UEDumper Dumpspace export (${summary.cheatCandidates.length} cheat-relevant members, ${summary.ueOffsets.length} global offsets).`,
    'Struct offsets are relative to the UObject/class instance — require live pointer chain resolution in Solith.',
  ];
  if (summary.dumperCredit?.dumper_link) {
    notes.push(`Source tool: ${summary.dumperCredit.dumper_used ?? 'UEDumper'} (${summary.dumperCredit.dumper_link})`);
  }
  for (const offset of summary.ueOffsets.slice(0, 12)) {
    notes.push(`UE offset ${offset.name}=0x${offset.offset.toString(16)}`);
  }
  if (summary.ueOffsets.length > 12) {
    notes.push(`…and ${summary.ueOffsets.length - 12} more UE offsets`);
  }
  return notes;
}
