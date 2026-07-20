import type { RuntimeModuleInfo } from './module-inspection.js';
import { assertModuleBounds } from './module-inspection.js';

export interface ReadOnlyMemoryReader {
  readModuleBytes(module: RuntimeModuleInfo, offset: number, length: number): Promise<Uint8Array>;
}

export class BufferMemoryReader implements ReadOnlyMemoryReader {
  constructor(private readonly buffers: Record<string, Uint8Array>) {}

  async readModuleBytes(module: RuntimeModuleInfo, offset: number, length: number): Promise<Uint8Array> {
    assertModuleBounds(module, offset, length);
    const buffer = this.buffers[module.name];
    if (!buffer) throw new Error(`No read-only byte buffer available for ${module.name}.`);
    return buffer.slice(offset, offset + length);
  }
}
