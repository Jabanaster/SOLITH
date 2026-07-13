export interface DumpspaceOffsetEntry {
  name: string;
  offset: number;
}

export interface DumpspaceMember {
  className: string;
  memberName: string;
  offset: number;
  size: number;
  typeLabel: string;
  isBit: boolean;
}

export interface DumpspaceImportSummary {
  title: string;
  catalogGameId: string;
  ueOffsets: DumpspaceOffsetEntry[];
  classCount: number;
  structCount: number;
  cheatCandidates: DumpspaceMember[];
  dumperCredit?: { dumper_used?: string; dumper_link?: string };
  updatedAt?: string;
  version?: number;
}

export const UE_CHEAT_MEMBER_PATTERNS: RegExp[] = [
  /health/i,
  /hp/i,
  /stamina/i,
  /spirit/i,
  /mana/i,
  /shield/i,
  /money/i,
  /gold/i,
  /coin/i,
  /currency/i,
  /ammo/i,
  /damage/i,
  /defense|defence/i,
  /attack/i,
  /speed/i,
  /experience|exp\b/i,
  /level/i,
  /hunger|food|satiety/i,
  /weight/i,
  /durability/i,
];

export const UEDUMPER_REFERENCE = {
  repository: 'https://github.com/Spuckwaffel/UEDumper',
  license: 'MIT',
  ueVersions: 'UE 4.19 – 5.4+',
  requiredPerGame: [
    'UE version (shipping exe properties)',
    'GObjects / GNames offsets or signatures',
    'GWorld and live-editor UObject offsets',
    'Optional FName decryption',
    'UEdefinitions.h engine struct flags',
  ],
  dumpspaceFiles: [
    'Dumpspace/OffsetsInfo.json',
    'Dumpspace/ClassesInfo.json',
    'Dumpspace/StructsInfo.json',
    'Dumpspace/EnumsInfo.json',
    'Dumpspace/FunctionsInfo.json',
  ],
  solithUses: [
    'Dumpspace JSON exports as research metadata',
    'Struct member offsets for cheat candidate naming',
    'Global offsets (GWorld, etc.) as versioned notes',
  ],
  solithDoesNotBundle: [
    'UEDumper executable or Visual Studio build',
    'Kernel/driver read paths from driver.h',
    'In-process UObject live editor hooks',
  ],
} as const;
