import type { RuntimeModuleInfo } from './module-inspection.js';
import type { ReadOnlyMemoryReader } from './memory-reader.js';

export interface MemoryViewRow {
  offset: number;
  address: string;
  hex: string;
  ascii: string;
}

export async function readMemoryView(input: {
  module: RuntimeModuleInfo;
  reader: ReadOnlyMemoryReader;
  offset: number;
  length: number;
  bytesPerRow?: number;
}): Promise<MemoryViewRow[]> {
  const bytesPerRow = input.bytesPerRow ?? 16;
  const bytes = await input.reader.readModuleBytes(input.module, input.offset, input.length);
  const rows: MemoryViewRow[] = [];
  for (let i = 0; i < bytes.length; i += bytesPerRow) {
    const chunk = bytes.slice(i, i + bytesPerRow);
    rows.push({
      offset: input.offset + i,
      address: `0x${(input.module.baseAddress + BigInt(input.offset + i)).toString(16)}`,
      hex: [...chunk].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '),
      ascii: [...chunk].map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join(''),
    });
  }
  return rows;
}
