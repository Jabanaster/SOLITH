/**
 * RFSA — ResourceForge Structured Save Archive (format #1)
 *
 * Documented little-endian layout for demo + test harness.
 * Magic: "RFSA" | Version: 1 | Fields at fixed offsets | XOR checksum tail.
 *
 * Layout (36 bytes minimum):
 *   0..3   magic "RFSA"
 *   4..7   version uint32 = 1
 *   8..11  flags uint32
 *   12..15 reserved
 *   16..19 gold int32
 *   20..23 hp float32
 *   24..27 stamina int32
 *   28..31 reserved2
 *   32..35 checksum uint32 (xor of bytes 0..31)
 */

export const RFSA_MAGIC = [0x52, 0x46, 0x53, 0x41] as const;
export const RFSA_VERSION = 1;
export const RFSA_MIN_BYTES = 36;

export interface RfsaFields {
  gold: number;
  hp: number;
  stamina: number;
  flags: number;
}

function xorChecksum(bytes: Uint8Array): number {
  let acc = 0;
  for (let i = 0; i < 32; i++) acc ^= bytes[i] ?? 0;
  return acc >>> 0;
}

export function validateRfsaHeader(bytes: Uint8Array): boolean {
  if (bytes.length < RFSA_MIN_BYTES) return false;
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== RFSA_MAGIC[i]) return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== RFSA_VERSION) return false;
  const expected = view.getUint32(32, true);
  return expected === xorChecksum(bytes);
}

export function readRfsaFields(bytes: Uint8Array): RfsaFields {
  if (!validateRfsaHeader(bytes)) {
    throw new Error('invalid_rfsa_header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    flags: view.getUint32(8, true),
    gold: view.getInt32(16, true),
    hp: view.getFloat32(20, true),
    stamina: view.getInt32(24, true),
  };
}

export function writeRfsaFields(current: Uint8Array, patch: Partial<RfsaFields>): Uint8Array {
  const out = new Uint8Array(Math.max(current.length, RFSA_MIN_BYTES));
  out.set(current.subarray(0, Math.min(current.length, out.length)));

  for (let i = 0; i < 4; i++) out[i] = RFSA_MAGIC[i];
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(4, RFSA_VERSION, true);

  let base: RfsaFields = { gold: 0, hp: 100, stamina: 100, flags: 0 };
  if (current.length >= RFSA_MIN_BYTES && validateRfsaHeader(current)) {
    base = readRfsaFields(current);
  }

  view.setUint32(8, patch.flags ?? base.flags, true);
  view.setInt32(16, patch.gold ?? base.gold, true);
  view.setFloat32(20, patch.hp ?? base.hp, true);
  view.setInt32(24, patch.stamina ?? base.stamina, true);
  view.setUint32(32, xorChecksum(out), true);
  return out;
}

export function createDefaultRfsaBuffer(): Uint8Array {
  return writeRfsaFields(new Uint8Array(RFSA_MIN_BYTES), { gold: 500, hp: 100, stamina: 100, flags: 0 });
}
