import { buildRelativeJump } from '../code-cave.js';

/** Friendship cap logic from CrimsonDesert.CT — cmp/mov on [rax+0x20] before stolen bytes. */
export function buildFriendshipCapShellcode(
  caveBase: bigint,
  hookSite: bigint,
  originalBytes: Buffer,
): Buffer {
  const prefix = Buffer.from([
    0x48, 0x83, 0x78, 0x20, 0x40,
    0x73, 0x0b,
    0x48, 0xc7, 0x40, 0x20, 0x40, 0x00, 0x00, 0x00,
  ]);
  const returnAddr = hookSite + BigInt(originalBytes.length);
  const jmpFrom = caveBase + BigInt(prefix.length + originalBytes.length);
  const jmpBack = buildRelativeJump(jmpFrom, returnAddr);
  return Buffer.concat([prefix, originalBytes, jmpBack]);
}
