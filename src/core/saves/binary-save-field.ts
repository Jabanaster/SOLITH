import fs from 'node:fs';
import path from 'node:path';
import {
  createDefaultRfsaBuffer,
  validateRfsaHeader,
} from './binary-formats/rfsa.js';
import type { BinarySaveFormatProfile } from './binary-formats/index.js';
import {
  createDefaultGenericBuffer,
  readGenericField,
  validateGenericHeader,
  writeGenericFields,
} from './binary-formats/generic-le.js';
import { detectBinarySaveProfile } from './binary-formats/index.js';
import { detectResearchBinaryProfile } from './binary-formats/research-profiles.js';

export interface BinarySaveFieldReadResult {
  success: boolean;
  value?: number;
  error?: string;
}

export interface BinarySaveFieldWriteResult {
  success: boolean;
  error?: string;
}

function loadProfile(filePath: string): { bytes: Uint8Array; profile: BinarySaveFormatProfile } | null {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const profile =
    detectBinarySaveProfile(filePath, bytes) ?? detectResearchBinaryProfile(filePath);
  if (!profile) return null;
  return { bytes, profile };
}

export function readBinarySaveField(
  filePath: string,
  fieldId: string,
): BinarySaveFieldReadResult {
  try {
    const loaded = loadProfile(filePath);
    if (!loaded) {
      return { success: false, error: 'unsupported_binary_profile' };
    }
    const field = loaded.profile.fields.find((f) => f.id === fieldId);
    if (!field) return { success: false, error: 'unknown_field' };

    if (loaded.profile.canWrite) {
      const valid =
        loaded.profile.id === 'rfsa-v1'
          ? validateRfsaHeader(loaded.bytes)
          : validateGenericHeader(loaded.bytes, loaded.profile);
      if (!valid) return { success: false, error: 'invalid_binary_header' };
    }

    if (loaded.bytes.length < field.offset + 4) {
      return { success: false, error: 'file_too_small' };
    }
    return { success: true, value: readGenericField(loaded.bytes, field) };
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
    const loaded = loadProfile(filePath);
    if (!loaded || !loaded.profile.canWrite) {
      return { success: false, error: 'unsupported_binary_profile' };
    }
    const field = loaded.profile.fields.find((f) => f.id === fieldId);
    if (!field) return { success: false, error: 'unknown_field' };

    if (field.min !== undefined && value < field.min) {
      return { success: false, error: 'below_min' };
    }
    if (field.max !== undefined && value > field.max) {
      return { success: false, error: 'above_max' };
    }

    const patch: Record<string, number> = { [fieldId]: value };
    const next = writeGenericFields(loaded.bytes, loaded.profile, patch);
    const valid =
      loaded.profile.id === 'rfsa-v1'
        ? validateRfsaHeader(next)
        : validateGenericHeader(next, loaded.profile);
    if (!valid) return { success: false, error: 'checksum_failed' };

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

export function createDemoBinarySave(filePath: string, profileId: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const header = new Uint8Array(4);
  const bytes = new Uint8Array(fs.existsSync(filePath) ? fs.readFileSync(filePath) : []);
  const profile = detectBinarySaveProfile(filePath, bytes.length ? bytes : header);
  if (!profile || profile.id !== profileId) {
    if (profileId === 'rfsa-v1') {
      fs.writeFileSync(filePath, createDefaultRfsaBuffer());
      return;
    }
    const fromRegistry = detectBinarySaveProfile(
      `demo${profileId === 'slth-v1' ? '.slth' : profileId === 'rsav-v1' ? '.rsav' : profileId === 'bpkg-v1' ? '.bpkg' : '.gdat'}`,
      header,
    );
    if (fromRegistry) {
      fs.writeFileSync(filePath, createDefaultGenericBuffer(fromRegistry));
    }
    return;
  }
  fs.writeFileSync(filePath, createDefaultGenericBuffer(profile));
}
