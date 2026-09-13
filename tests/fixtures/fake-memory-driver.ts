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
  /**
   * (Gate 2) Byte-precise shadow of `memory`, populated whenever a write goes
   * through `writeMemory`/`writeBuffer`. `readBuffer` and `readMemory` prefer
   * this when present so a propose→confirm→rollback flow round-trips exact
   * bytes, matching how a real process's memory has no separate "decoded
   * number" cache — it is just bytes, decoded at read time.
   */
  private rawBytes = new Map<string, Buffer>();
  /**
   * (Gate 2) Remembers the dataType last used by writeMemory/readMemory for
   * an address, purely so getValue() — an untyped test-introspection helper —
   * can still decode correctly after a byte-only writeBuffer restore (which
   * has no dataType to work with, matching memoryjs's real writeBuffer).
   */
  private lastDataType = new Map<string, LiveValueType>();
  private regions: FakeRegion[] = [];
  private unreadableRegions: { baseAddress: bigint; size: number; writable: boolean }[] = [];
  /**
   * Insertion-ordered record of every addRegion/addUnreadableRegion call, so
   * getRegions() can preserve the caller's intended scan order (readable and
   * unreadable regions interleaved as seeded) instead of always sorting all
   * unreadable regions after all readable ones regardless of call order.
   */
  private regionOrder: Array<{ kind: 'readable' | 'unreadable'; baseAddress: bigint }> = [];
  private modules: MemoryModule[] = [];
  private processNames = new Map<number, string>();
  private processPaths = new Map<number, string>();
  private processStartTimes = new Map<number, string>();
  private processVolumeSerials = new Map<number, string>();
  private processFileIndexes = new Map<number, string>();
  private opened = false;
  public closeCallCount = 0;

  constructor(initialValues: Record<string, number> = {}) {
    for (const [addr, value] of Object.entries(initialValues)) {
      this.memory.set(addr, value);
    }
  }

  setValue(address: bigint, value: number): void {
    this.memory.set(address.toString(), value);
    // (Gate 2) Invalidate any byte-precise snapshot for this address — tests
    // use setValue to simulate an out-of-band external change (game logic, a
    // concurrent freeze, another writer), which must be visible to readMemory
    // and readBuffer alike. Without this, a stale rawBytes entry from an
    // earlier writeMemory/writeBuffer would keep shadowing the new value.
    this.rawBytes.delete(address.toString());
  }

  getValue(address: bigint): number | undefined {
    const key = address.toString();
    const raw = this.rawBytes.get(key);
    const type = this.lastDataType.get(key);
    if (raw !== undefined && type !== undefined && raw.length >= sizeOf(type)) {
      return readTyped(raw, 0, type);
    }
    return this.memory.get(key);
  }

  /** Seed a simulated memory region for scanner tests. */
  addRegion(baseAddress: bigint, buffer: Buffer, writable = true): void {
    this.regions.push({ baseAddress, buffer, writable });
    this.regionOrder.push({ kind: 'readable', baseAddress });
  }

  /**
   * Seed a region that appears in getRegions() but always throws on
   * readBuffer — simulates a region that was freed/protection-changed
   * between enumeration and read, which scanFirst must skip without
   * aborting the whole scan.
   */
  addUnreadableRegion(baseAddress: bigint, size: number, writable = true): void {
    this.unreadableRegions.push({ baseAddress, size, writable });
    this.regionOrder.push({ kind: 'unreadable', baseAddress });
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

  setProcessVolumeSerial(pid: number, serial: string): void {
    this.processVolumeSerials.set(pid, serial);
  }

  setProcessFileIndex(pid: number, fileIndex: string): void {
    this.processFileIndexes.set(pid, fileIndex);
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

  getProcessVolumeSerial(handle: LiveProcessHandle): string | null {
    return this.processVolumeSerials.get(handle.pid) ?? null;
  }

  getProcessFileIndex(handle: LiveProcessHandle): string | null {
    return this.processFileIndexes.get(handle.pid) ?? null;
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
    if (!this.processNames.has(pid)) {
      this.processNames.set(pid, 'demo.exe');
    }
    if (!this.processPaths.has(pid)) {
      this.processPaths.set(pid, `C:\\FakeGames\\${this.processNames.get(pid)}`);
    }
    if (!this.processStartTimes.has(pid)) {
      this.processStartTimes.set(pid, '2020-01-01T00:00:00.000Z');
    }
    return { pid, opaque: { fake: true } };
  }

  readMemory(_handle: LiveProcessHandle, address: bigint, dataType: LiveValueType): number {
    const raw = this.rawBytes.get(address.toString());
    if (raw !== undefined && raw.length >= sizeOf(dataType)) {
      return readTyped(raw, 0, dataType);
    }

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
    this.lastDataType.set(address.toString(), dataType);

    const buf = Buffer.alloc(sizeOf(dataType));
    writeTyped(buf, 0, dataType, value);
    this.rawBytes.set(address.toString(), buf);

    const region = this.findRegion(address);
    if (region) {
      const offset = Number(address - region.baseAddress);
      writeTyped(region.buffer, offset, dataType, value);
    }
  }

  /**
   * (Gate 2) Raw-byte write, mirroring the real driver's writeBuffer. Only
   * updates the byte-precise store — it intentionally does NOT touch the
   * legacy numeric `memory` map (there is no dataType to decode with here,
   * matching memoryjs's real, genuinely type-less writeBuffer). Production
   * rollback restore calls writeMemory (typed, keeps `memory` and existing
   * getValue()-based assertions correct) immediately before writeBuffer
   * (raw, gives byte-exact fidelity for readMemory/readBuffer afterward) —
   * see live-memory-session.ts rollback().
   */
  writeBuffer(_handle: LiveProcessHandle, address: bigint, buffer: Buffer): void {
    const region = this.findRegion(address);
    if (region) {
      const offset = Number(address - region.baseAddress);
      buffer.copy(region.buffer, offset);
      return;
    }
    this.rawBytes.set(address.toString(), Buffer.from(buffer));
  }

  closeProcess(_handle: LiveProcessHandle): void {
    this.opened = false;
    this.closeCallCount += 1;
  }

  isOpen(): boolean {
    return this.opened;
  }

  getRegions(_handle: LiveProcessHandle): MemoryRegion[] {
    // Preserve the caller's seeding order (readable/unreadable interleaved as
    // addRegion/addUnreadableRegion were called) rather than grouping all
    // unreadable regions after all readable ones — production code must not
    // assume unreadable regions only ever appear last in a real scan.
    return this.regionOrder.map(({ kind, baseAddress }) => {
      if (kind === 'readable') {
        const r = this.regions.find((region) => region.baseAddress === baseAddress)!;
        return { baseAddress: r.baseAddress, size: r.buffer.length, writable: r.writable };
      }
      const r = this.unreadableRegions.find((region) => region.baseAddress === baseAddress)!;
      return { baseAddress: r.baseAddress, size: r.size, writable: r.writable };
    });
  }

  readBuffer(_handle: LiveProcessHandle, address: bigint, size: number): Buffer {
    const isSimulatedUnreadable = this.unreadableRegions.some((r) => r.baseAddress === address);
    if (isSimulatedUnreadable) {
      throw new Error(`Simulated unreadable region at ${address}`);
    }

    const region = this.findRegion(address);
    if (region) {
      const offset = Number(address - region.baseAddress);
      if (offset + size > region.buffer.length) {
        throw new Error(`readBuffer out of bounds for fake region at ${address}, size ${size}`);
      }
      return region.buffer.subarray(offset, offset + size);
    }

    const raw = this.rawBytes.get(address.toString());
    if (raw !== undefined && raw.length >= size) {
      return raw.subarray(0, size);
    }

    const explicit = this.memory.get(address.toString());
    if (explicit !== undefined) {
      // No prior byte-precise write recorded (address was seeded via setValue) —
      // best-effort encode by requested width, same heuristic as writeBuffer's decode.
      const buf = Buffer.alloc(size);
      encodeBySizeHeuristic(buf, explicit);
      return buf;
    }

    throw new Error(`No fake region contains address ${address}`);
  }
}

/**
 * (Gate 2 test-fixture only) Best-effort number<->bytes conversion for the
 * byte-level fake path when no dataType is available (mirrors memoryjs's
 * real writeBuffer, which is genuinely type-less). Not used by production
 * code — NativeMemoryDriver always has a concrete Buffer already in hand.
 */
function encodeBySizeHeuristic(buf: Buffer, value: number): void {
  switch (buf.length) {
    case 1:
      buf.writeUInt8(value & 0xff, 0);
      return;
    case 4:
      if (Number.isInteger(value)) buf.writeInt32LE(value | 0, 0);
      else buf.writeFloatLE(value, 0);
      return;
    case 8:
      if (Number.isSafeInteger(value)) buf.writeBigInt64LE(BigInt(value), 0);
      else buf.writeDoubleLE(value, 0);
      return;
    default:
      throw new Error(`decodeBySizeHeuristic: unsupported buffer size ${buf.length}`);
  }
}
