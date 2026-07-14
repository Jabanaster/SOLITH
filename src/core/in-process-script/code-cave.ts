/** 14-byte x64 indirect jump: FF 25 00 00 00 00 [imm64] */
export function buildAbsoluteJumpPatch(caveAddress: bigint): Buffer {
  const patch = Buffer.alloc(14);
  patch[0] = 0xff;
  patch[1] = 0x25;
  patch.writeUInt32LE(0, 2);
  patch.writeBigUInt64LE(caveAddress, 6);
  return patch;
}

/** E9 rel32 */
export function buildRelativeJump(from: bigint, to: bigint): Buffer {
  const buf = Buffer.alloc(5);
  buf[0] = 0xe9;
  const rel = to - (from + BigInt(5));
  const rel32 = Number(rel);
  if (!Number.isFinite(rel32) || rel32 < -2147483648 || rel32 > 2147483647) {
    throw new Error('Relative jump offset out of rel32 range');
  }
  buf.writeInt32LE(rel32, 1);
  return buf;
}
