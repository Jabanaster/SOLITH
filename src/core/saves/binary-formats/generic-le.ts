/**
 * Shared little-endian fixed-offset binary layout used by demo save profiles #1–#5.
 * Each profile supplies its own magic bytes; field map comes from BinarySaveFormatProfile.
 */

import type { BinarySaveFieldMap, BinarySaveFormatProfile } from './index.js';

export const GENERIC_MIN_BYTES = 36;

export interface GenericBinaryFields {
  flags: number;
  gold: number;
  hp: number;
  stamina: number;
}

function xorChecksum(bytes: Uint8Array): number {
  let acc = 0;
  for (let i = 0; i < 32; i++) acc ^= bytes[i] ?? 0;
  return acc >>> 0;
}

export function validateGenericHeader(bytes: Uint8Array, profile: BinarySaveFormatProfile): boolean {
  if (bytes.length < GENERIC_MIN_BYTES) return false;
  const magic = profile.magicBytes;
  if (!magic?.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 1) return false;
  const expected = view.getUint32(32, true);
  return expected === xorChecksum(bytes);
}

export function readGenericField(bytes: Uint8Array, field: BinarySaveFieldMap): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (field.dataType) {
    case 'int32':
      return view.getInt32(field.offset, true);
    case 'uint32':
      return view.getUint32(field.offset, true);
    case 'float':
      return view.getFloat32(field.offset, true);
    case 'double':
      return view.getFloat64(field.offset, true);
    case 'bool8':
      return view.getUint8(field.offset) ? 1 : 0;
    default:
      throw new Error(`unsupported_field_type:${field.dataType}`);
  }
}

export function readGenericFields(bytes: Uint8Array, profile: BinarySaveFormatProfile): GenericBinaryFields {
  const gold = profile.fields.find((f) => f.id === 'gold');
  const hp = profile.fields.find((f) => f.id === 'hp');
  const stamina = profile.fields.find((f) => f.id === 'stamina');
  if (!gold || !hp || !stamina) throw new Error('profile_missing_core_fields');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    flags: view.getUint32(8, true),
    gold: readGenericField(bytes, gold),
    hp: readGenericField(bytes, hp),
    stamina: readGenericField(bytes, stamina),
  };
}

export function writeGenericField(
  bytes: Uint8Array,
  field: BinarySaveFieldMap,
  value: number,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (field.dataType) {
    case 'int32':
      view.setInt32(field.offset, value, true);
      break;
    case 'uint32':
      view.setUint32(field.offset, value, true);
      break;
    case 'float':
      view.setFloat32(field.offset, value, true);
      break;
    case 'double':
      view.setFloat64(field.offset, value, true);
      break;
    case 'bool8':
      view.setUint8(field.offset, value ? 1 : 0);
      break;
    default:
      throw new Error(`unsupported_field_type:${field.dataType}`);
  }
}

export function writeGenericFields(
  current: Uint8Array,
  profile: BinarySaveFormatProfile,
  patch: Partial<GenericBinaryFields>,
): Uint8Array {
  const out = new Uint8Array(Math.max(current.length, GENERIC_MIN_BYTES));
  out.set(current.subarray(0, Math.min(current.length, out.length)));

  if (profile.magicBytes) {
    for (let i = 0; i < profile.magicBytes.length; i++) out[i] = profile.magicBytes[i];
  }
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(4, 1, true);

  let base: GenericBinaryFields = { gold: 0, hp: 100, stamina: 100, flags: 0 };
  if (current.length >= GENERIC_MIN_BYTES && validateGenericHeader(current, profile)) {
    base = readGenericFields(current, profile);
  }

  view.setUint32(8, patch.flags ?? base.flags, true);
  for (const field of profile.fields) {
    const key = field.id as keyof GenericBinaryFields;
    if (key in patch && patch[key] !== undefined) {
      writeGenericField(out, field, patch[key] as number);
    } else if (key in base) {
      writeGenericField(out, field, base[key] as number);
    }
  }

  view.setUint32(32, xorChecksum(out), true);
  return out;
}

export function createDefaultGenericBuffer(profile: BinarySaveFormatProfile): Uint8Array {
  return writeGenericFields(new Uint8Array(GENERIC_MIN_BYTES), profile, {
    gold: 500,
    hp: 100,
    stamina: 100,
    flags: 0,
  });
}
