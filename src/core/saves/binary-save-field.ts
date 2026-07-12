import fs from 'node:fs';
import path from 'node:path';
import {
  createDefaultRfsaBuffer,
  readRfsaFields,
  validateRfsaHeader,
  writeRfsaFields,
  type RfsaFields,
} from './binary-formats/rfsa.js';
import type { BinarySaveFormatProfile } from './binary-formats/index.js';
import { detectBinarySaveProfile } from './binary-formats/index.js';

export interface BinarySaveFieldReadResult {
  success: boolean;
  value?: number;
  error?: string;
}

export interface BinarySaveFieldWriteResult {
  success: boolean;
  error?: string;
}

const FIELD_TO_RFSA: Record<string, keyof RfsaFields> = {
  gold: 'gold',
  hp: 'hp',
  stamina: 'stamina',
};

export function readBinarySaveField(
  filePath: string,
  fieldId: string,
): BinarySaveFieldReadResult {
  try {
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const profile = detectBinarySaveProfile(filePath, bytes);
    if (!profile || !profile.canWrite) {
      return { success: false, error: 'unsupported_binary_profile' };
    }
    const rfsaKey = FIELD_TO_RFSA[fieldId];
    if (!rfsaKey) return { success: false, error: 'unknown_field' };
    const fields = readRfsaFields(bytes);
    return { success: true, value: fields[rfsaKey] as number };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function writeBinarySaveField(
  filePath: string,
  fieldId: string,
  value: number,
): BinarySaveFieldWriteResult {
  try {
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const profile = detectBinarySaveProfile(filePath, bytes);
    if (!profile || !profile.canWrite) {
      return { success: false, error: 'unsupported_binary_profile' };
    }
    const rfsaKey = FIELD_TO_RFSA[fieldId];
    if (!rfsaKey) return { success: false, error: 'unknown_field' };

    const map = profile.fields.find((f) => f.id === fieldId);
    if (map?.min !== undefined && value < map.min) {
      return { success: false, error: 'below_min' };
    }
    if (map?.max !== undefined && value > map.max) {
      return { success: false, error: 'above_max' };
    }

    const next = writeRfsaFields(bytes, { [rfsaKey]: value } as Partial<RfsaFields>);
    if (!validateRfsaHeader(next)) {
      return { success: false, error: 'checksum_failed' };
    }
    fs.writeFileSync(filePath, next);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function createDemoRfsaSave(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, createDefaultRfsaBuffer());
}
