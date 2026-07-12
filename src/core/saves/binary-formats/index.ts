/**
 * Registry for structured binary save formats (read-first, patch-second).
 * Each profile declares magic bytes, endianness, and field maps — no blind blob writes.
 */

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

const PROFILES: BinarySaveFormatProfile[] = [
  {
    id: 'demo-binary-fixture',
    label: 'Demo binary fixture (test only)',
    magicBytes: [0x52, 0x46, 0x53, 0x41],
    extension: '.sav',
    endian: 'le',
    maxFileBytes: 4 * 1024 * 1024,
    fields: [
      { id: 'gold', name: 'Gold', offset: 16, dataType: 'int32', min: 0, max: 999_999_999 },
      { id: 'hp', name: 'HP', offset: 20, dataType: 'float', min: 0, max: 9999 },
    ],
    evidence: 'Fixture profile for unit tests — not a real game format.',
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
