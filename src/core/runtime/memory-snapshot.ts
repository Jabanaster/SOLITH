import type { RuntimeModuleInfo } from './module-inspection.js';
import type { ReadOnlyMemoryReader } from './memory-reader.js';

export interface MemorySnapshot {
  id: string;
  module: string;
  offset: number;
  bytes: number[];
  capturedAt: string;
}

export interface MemoryDiff {
  offset: number;
  before: number;
  after: number;
}

export async function captureMemorySnapshot(input: {
  id: string;
  module: RuntimeModuleInfo;
  reader: ReadOnlyMemoryReader;
  offset: number;
  length: number;
  capturedAt?: string;
}): Promise<MemorySnapshot> {
  const bytes = await input.reader.readModuleBytes(input.module, input.offset, input.length);
  return {
    id: input.id,
    module: input.module.name,
    offset: input.offset,
    bytes: [...bytes],
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export function diffMemorySnapshots(before: MemorySnapshot, after: MemorySnapshot): MemoryDiff[] {
  if (before.module !== after.module || before.offset !== after.offset) {
    throw new Error('Snapshots must target the same module and offset.');
  }
  const length = Math.min(before.bytes.length, after.bytes.length);
  const diffs: MemoryDiff[] = [];
  for (let i = 0; i < length; i += 1) {
    if (before.bytes[i] !== after.bytes[i]) {
      diffs.push({ offset: before.offset + i, before: before.bytes[i], after: after.bytes[i] });
    }
  }
  return diffs;
}
