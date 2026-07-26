import type { LiveProcessHandle, LiveValueType, MemoryDriver, MemoryModule, MemoryRegion } from '../../src/core/live-memory/types.js';

interface FakeRegion {
  baseAddress: bigint;
  buffer: Buffer;
  writable: boolean;
}

function sizeOf(dataType: LiveValueType): number {
  switch (dataType) {
    case 'byte':
      return 1;
    case 'int32':
    case 'uint32':
    case 'float':
      return 4;
    case 'double':
    case 'int64':
      return 8;
  }
}

function readTyped(buffer: Buffer, offset: number, dataType: LiveValueType): number {
  switch (dataType) {
    case 'byte':
      return buffer.readUInt8(offset);
    case 'int32':
      return buffer.readInt32LE(offset);
    case 'uint32':
      return buffer.readUInt32LE(offset);
    case 'float':
      return buffer.readFloatLE(offset);
    case 'double':
      return buffer.readDoubleLE(offset);
    case 'int64':
      // Narrowed to number for API consistency with the rest of this fake —
      // real int64 handling would need bigint end-to-end; out of scope here.
      return Number(buffer.readBigInt64LE(offset));
  }
}

function writeTyped(buffer: Buffer, offset: number, dataType: LiveValueType, value: number): void {
  switch (dataType) {
    case 'byte':
      buffer.writeUInt8(value, offset);
      return;
    case 'int32':
      buffer.writeInt32LE(value, offset);
      return;
    case 'uint32':
      buffer.writeUInt32LE(value, offset);
      return;
    case 'float':
      buffer.writeFloatLE(value, offset);
      return;
    case 'double':
      buffer.writeDoubleLE(value, offset);
      return;
    case 'int64':
      buffer.writeBigInt64LE(BigInt(value), offset);
      return;
  }
}

/**
 * In-memory fake for MemoryDriver. Simulates a target process's memory as a
 * plain Map keyed by address, so LiveMemorySession orchestration logic
 * (guard checks, propose/confirm/rollback) can be unit tested without a real
 * OS process or a compiled native addon.
 *
 * Also supports simulated memory regions (addRegion) for testing the memory
 * scanner (getRegions/readBuffer) without a real process. readMemory falls
 * back to decoding from a region buffer when the address isn't in the
 * explicit `memory` map, so scanner-found addresses are readable the same
 * way a real attach would behave — existing Map-only tests are unaffected
 * since they never populate regions.
 */
export class FakeMemoryDriver implements MemoryDriver {
  private memory = new Map<string, number>();
  private regions: FakeRegion[] = [];
  private unreadableRegions: { baseAddress: bigint; size: number; writable: boolean }[] = [];
  private modules: MemoryModule[] = [];
  private processNames = new Map<number, string>();
  private processPaths = new Map<number, string>();
  private processStartTimes = new Map<number, string>();
  private opened = false;
  public closeCallCount = 0;

  constructor(initialValues: Record<string, number> = {}) {
    for (const [addr, value] of Object.entries(initialValues)) {
      this.memory.set(addr, value);
    }
  }

  setValue(address: bigint, value: number): void {
    this.memory.set(address.toString(), value);
  }

  getValue(address: bigint): number | undefined {
    return this.memory.get(address.toString());
  }

  /** Seed a simulated memory region for scanner tests. */
  addRegion(baseAddress: bigint, buffer: Buffer, writable = true): void {
    this.regions.push({ baseAddress, buffer, writable });
  }

  /**
   * Seed a region that appears in getRegions() but always throws on
   * readBuffer — simulates a region that was freed/protection-changed
   * between enumeration and read, which scanFirst must skip without
   * aborting the whole scan.
   */
  addUnreadableRegion(baseAddress: bigint, size: number, writable = true): void {
    this.unreadableRegions.push({ baseAddress, size, writable });
  }

  /** Seed a simulated loaded module for pointer-path tests. */
  addModule(name: string, baseAddress: bigint, size: number): void {
    this.modules.push({ name, baseAddress, size });
  }

  setProcessExecutableName(pid: number, name: string): void {
    this.processNames.set(pid, name);
  }

  setProcessExecutablePath(pid: number, exePath: string): void {
    this.processPaths.set(pid, exePath);
  }

  setProcessStartTime(pid: number, startTimeIso: string): void {
    this.processStartTimes.set(pid, startTimeIso);
  }

  getModules(_handle: LiveProcessHandle): MemoryModule[] {
    return [...this.modules];
  }

  getProcessExecutableName(handle: LiveProcessHandle): string | null {
    return this.processNames.get(handle.pid) ?? null;
  }

  getProcessExecutablePath(handle: LiveProcessHandle): string | null {
    return this.processPaths.get(handle.pid) ?? null;
  }

  getProcessStartTime(handle: LiveProcessHandle): string | null {
    return this.processStartTimes.get(handle.pid) ?? null;
  }

  readPointer(_handle: LiveProcessHandle, address: bigint): bigint {
    const region = this.findRegion(address);
    if (!region) throw new Error(`No fake region contains address ${address}`);
    const offset = Number(address - region.baseAddress);
    return region.buffer.readBigUInt64LE(offset);
  }

  private findRegion(address: bigint): FakeRegion | undefined {
    return this.regions.find(
      (r) => address >= r.baseAddress && address < r.baseAddress + BigInt(r.buffer.length),
    );
  }

  openProcess(pid: number): LiveProcessHandle {
    this.opened = true;
    return { pid, opaque: { fake: true } };
  }

  readMemory(_handle: LiveProcessHandle, address: bigint, dataType: LiveValueType): number {
    const explicit = this.memory.get(address.toString());
    if (explicit !== undefined) return explicit;

    const region = this.findRegion(address);
    if (region) {
      const offset = Number(address - region.baseAddress);
      return readTyped(region.buffer, offset, dataType);
    }

    throw new Error(`No fake value set for address ${address}`);
  }

  writeMemory(_handle: LiveProcessHandle, address: bigint, dataType: LiveValueType, value: number): void {
    this.memory.set(address.toString(), value);

    const region = this.findRegion(address);
    if (region) {
      const offset = Number(address - region.baseAddress);
      writeTyped(region.buffer, offset, dataType, value);
    }
  }

  closeProcess(_handle: LiveProcessHandle): void {
    this.opened = false;
    this.closeCallCount += 1;
  }

  isOpen(): boolean {
    return this.opened;
  }

  getRegions(_handle: LiveProcessHandle): MemoryRegion[] {
    const readable = this.regions.map((r) => ({ baseAddress: r.baseAddress, size: r.buffer.length, writable: r.writable }));
    const unreadable = this.unreadableRegions.map((r) => ({ baseAddress: r.baseAddress, size: r.size, writable: r.writable }));
    return [...readable, ...unreadable];
  }

  readBuffer(_handle: LiveProcessHandle, address: bigint, size: number): Buffer {
    const isSimulatedUnreadable = this.unreadableRegions.some((r) => r.baseAddress === address);
    if (isSimulatedUnreadable) {
      throw new Error(`Simulated unreadable region at ${address}`);
    }

    const region = this.findRegion(address);
    if (!region) throw new Error(`No fake region contains address ${address}`);
    const offset = Number(address - region.baseAddress);
    if (offset + size > region.buffer.length) {
      throw new Error(`readBuffer out of bounds for fake region at ${address}, size ${size}`);
    }
    return region.buffer.subarray(offset, offset + size);
  }
}
