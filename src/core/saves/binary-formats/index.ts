/**
 * Registry for structured binary save formats (read-first, patch-second).
 * Each profile declares magic bytes, endianness, and field maps — no blind blob writes.
 */

export { createDefaultRfsaBuffer, readRfsaFields, validateRfsaHeader, writeRfsaFields } from './rfsa.js';
export {
  createDefaultGenericBuffer,
  readGenericField,
  readGenericFields,
  validateGenericHeader,
  writeGenericFields,
} from './generic-le.js';

export type BinarySaveEndian = 'le' | 'be';

export interface BinarySaveFieldMap {
  id: string;
  name: string;
  offset: number;
  dataType: 'int32' | 'uint32' | 'float' | 'double' | 'bool8';
  max?: number;
  min?: number;
}

export interface BinarySaveFormatProfile {
  id: string;
  label: string;
  magicBytes?: number[];
  extension: string;
  endian: BinarySaveEndian;
  maxFileBytes: number;
  fields: BinarySaveFieldMap[];
  /** Human-readable evidence for support matrix. */
  evidence: string;
  canWrite: boolean;
}

const CORE_FIELDS: BinarySaveFieldMap[] = [
  { id: 'gold', name: 'Gold', offset: 16, dataType: 'int32', min: 0, max: 999_999_999 },
  { id: 'hp', name: 'HP', offset: 20, dataType: 'float', min: 0, max: 9999 },
  { id: 'stamina', name: 'Stamina', offset: 24, dataType: 'int32', min: 0, max: 9999 },
];

const PROFILES: BinarySaveFormatProfile[] = [
  {
    id: 'rfsa-v1',
    label: 'RFSA structured save (demo format #1)',
    magicBytes: [0x52, 0x46, 0x53, 0x41],
    extension: '.rfsa',
    endian: 'le',
    maxFileBytes: 64 * 1024,
    fields: CORE_FIELDS,
    evidence:
      'Documented ResourceForge RFSA v1 layout (Docs/BinaryFormats/RFSA_v1.md). Demo file: demo-game/save/player.rfsa.',
    canWrite: true,
  },
  {
    id: 'slth-v1',
    label: 'SLTH structured save (demo format #2)',
    magicBytes: [0x53, 0x4c, 0x54, 0x48],
    extension: '.slth',
    endian: 'le',
    maxFileBytes: 64 * 1024,
    fields: CORE_FIELDS,
    evidence: 'Solith demo binary layout #2 — same LE field map, SLTH magic.',
    canWrite: true,
  },
  {
    id: 'rsav-v1',
    label: 'RSAV structured save (demo format #3)',
    magicBytes: [0x52, 0x53, 0x41, 0x56],
    extension: '.rsav',
    endian: 'le',
    maxFileBytes: 64 * 1024,
    fields: CORE_FIELDS,
    evidence: 'Solith demo binary layout #3 — RSAV magic.',
    canWrite: true,
  },
  {
    id: 'bpkg-v1',
    label: 'BPKG structured save (demo format #4)',
    magicBytes: [0x42, 0x50, 0x4b, 0x47],
    extension: '.bpkg',
    endian: 'le',
    maxFileBytes: 64 * 1024,
    fields: CORE_FIELDS,
    evidence: 'Solith demo binary layout #4 — BPKG magic.',
    canWrite: true,
  },
  {
    id: 'gdat-v1',
    label: 'GDAT structured save (demo format #5)',
    magicBytes: [0x47, 0x44, 0x41, 0x54],
    extension: '.gdat',
    endian: 'le',
    maxFileBytes: 64 * 1024,
    fields: CORE_FIELDS,
    evidence: 'Solith demo binary layout #5 — GDAT magic.',
    canWrite: true,
  },
  {
    id: 'demo-binary-fixture',
    label: 'Legacy demo fixture alias (.sav)',
    magicBytes: [0x52, 0x46, 0x53, 0x41],
    extension: '.sav',
    endian: 'le',
    maxFileBytes: 4 * 1024 * 1024,
    fields: CORE_FIELDS.slice(0, 2),
    evidence: 'Alias for RFSA tests using .sav extension.',
    canWrite: false,
  },
];

export function listBinarySaveProfiles(): BinarySaveFormatProfile[] {
  return [...PROFILES];
}

export function getBinarySaveProfile(id: string): BinarySaveFormatProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

export function detectBinarySaveProfile(filePath: string, headerBytes: Uint8Array): BinarySaveFormatProfile | null {
  const lower = filePath.toLowerCase();
  for (const profile of PROFILES) {
    if (!lower.endsWith(profile.extension)) continue;
    if (!profile.magicBytes?.length) return profile;
    if (headerBytes.length < profile.magicBytes.length) continue;
    const match = profile.magicBytes.every((b, i) => headerBytes[i] === b);
    if (match) return profile;
  }
  return null;
}
