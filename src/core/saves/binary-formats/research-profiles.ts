/**
 * Commercial-game binary save research profiles (read-only detection).
 * See Docs/BinaryFormats/RESEARCH_INDEX.md for evidence and promotion gates.
 */
import type { BinarySaveFormatProfile } from './index.js';

export const RESEARCH_BINARY_PROFILES: BinarySaveFormatProfile[] = [
  {
    id: 'terraria-plr-v1',
    label: 'Terraria player file (.plr)',
    extension: '.plr',
    endian: 'le',
    maxFileBytes: 16 * 1024 * 1024,
    fields: [
      { id: 'version', name: 'Save version', offset: 0, dataType: 'int32' },
      { id: 'name-length', name: 'Name length', offset: 4, dataType: 'int32' },
    ],
    evidence:
      'Public Terraria save documentation — version int32 @0. Full field map is version-dependent; read-only until fixture verification.',
    canWrite: false,
  },
  {
    id: 'hollow-knight-userdat-v1',
    label: 'Hollow Knight user*.dat',
    extension: '.dat',
    endian: 'le',
    maxFileBytes: 8 * 1024 * 1024,
    fields: [],
    evidence:
      'Encrypted player container — detected by filename pattern user*.dat under Saves/. No field writes without decryption research.',
    canWrite: false,
  },
  {
    id: 'projectzomboid-bin-v1',
    label: 'Project Zomboid save chunk',
    extension: '.bin',
    endian: 'le',
    maxFileBytes: 64 * 1024 * 1024,
    fields: [],
    evidence:
      'Opaque world/player chunks under Zomboid/Saves — research profile for discovery byte-diff only.',
    canWrite: false,
  },
];

export function detectResearchBinaryProfile(filePath: string): BinarySaveFormatProfile | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.plr')) {
    return RESEARCH_BINARY_PROFILES.find((p) => p.id === 'terraria-plr-v1') ?? null;
  }
  if (lower.includes('hollow knight') && lower.endsWith('.dat')) {
    return RESEARCH_BINARY_PROFILES.find((p) => p.id === 'hollow-knight-userdat-v1') ?? null;
  }
  const base = lower.split(/[/\\]/).pop() ?? lower;
  if (base.startsWith('user') && base.endsWith('.dat')) {
    return RESEARCH_BINARY_PROFILES.find((p) => p.id === 'hollow-knight-userdat-v1') ?? null;
  }
  if (lower.endsWith('.bin') && lower.includes('zomboid')) {
    return RESEARCH_BINARY_PROFILES.find((p) => p.id === 'projectzomboid-bin-v1') ?? null;
  }
  return null;
}
