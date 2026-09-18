/**
 * Phase 9 — bounded typed memory inspection (RPM read-only).
 * Inject MemoryDriver + LiveProcessHandle; never opens processes by pid alone.
 */
import type { LiveProcessHandle, LiveValueType, MemoryDriver } from '../types.js';

export type ResearchDataType = LiveValueType | 'string';

export interface MemoryViewEntry {
  address: string;
  type: ResearchDataType;
  value: number | string | null;
  readable: boolean;
}

export interface MemoryRegionSummary {
  baseAddress: string;
  size: number;
  writable: boolean;
  /** P2-8 memory map — real Win32 protection/type detail, undefined when the driver doesn't report it (never fabricated). */
  readable?: boolean;
  executable?: boolean;
  guarded?: boolean;
  rawProtect?: number;
  regionType?: 'image' | 'mapped' | 'private' | 'unknown';
  /** The real module this region's base address falls inside, or null when it genuinely isn't part of any known module. */
  moduleName: string | null;
}

export interface MemoryRegionList {
  regions: MemoryRegionSummary[];
  truncated: boolean;
  totalAvailable: number;
}

export interface MemoryModuleSummary {
  name: string;
  baseAddress: string;
  size: number;
  path: string | null;
}

export interface MemoryModuleList {
  modules: MemoryModuleSummary[];
  truncated: boolean;
  totalAvailable: number;
}

const STRING_BYTES = 32;
const DEFAULT_MAX_REGIONS = 256;
const DEFAULT_MAX_MODULES = 256;

function sizeOf(type: ResearchDataType): number {
  switch (type) {
    case 'byte':
      return 1;
    case 'int32':
    case 'uint32':
    case 'float':
      return 4;
    case 'double':
    case 'int64':
      return 8;
    case 'string':
      return STRING_BYTES;
  }
}

export function parseResearchAddress(address: string | number | bigint): bigint {
  if (typeof address === 'bigint') return address;
  if (typeof address === 'number') {
    if (!Number.isFinite(address) || address < 0) throw new Error('Invalid address');
    return BigInt(Math.trunc(address));
  }
  const s = address.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(s)) return BigInt(s);
  if (/^[0-9]+$/.test(s)) return BigInt(s);
  throw new Error(`Invalid address: ${address}`);
}

export class MemoryViewer {
  private readonly maxBudgetBytes: number;
  private readonly maxRegions: number;
  private readonly maxModules: number;

  constructor(
    private readonly driver: MemoryDriver,
    maxBudgetBytes = 4096,
    maxRegions = DEFAULT_MAX_REGIONS,
    maxModules = DEFAULT_MAX_MODULES,
  ) {
    this.maxBudgetBytes = Math.max(16, maxBudgetBytes);
    this.maxRegions = Math.max(1, maxRegions);
    this.maxModules = Math.max(1, maxModules);
  }

  /** Bounded committed-region listing (metadata only — no bulk dump). */
  listRegions(
    handle: LiveProcessHandle,
    options: { writableOnly?: boolean; maxRegions?: number } = {},
  ): MemoryRegionList {
    const cap = Math.min(options.maxRegions ?? this.maxRegions, this.maxRegions);
    let regions = this.driver.getRegions(handle);
    if (options.writableOnly) regions = regions.filter((r) => r.writable);
    const totalAvailable = regions.length;
    const truncated = totalAvailable > cap;
    // Real module association, spec §7 — never guessed, only when the region's base genuinely falls inside a known module's [base, base+size) span.
    let modules: import('../types.js').MemoryModule[] = [];
    try {
      modules = this.driver.getModules(handle);
    } catch {
      /* module enumeration can fail independently of a successful region read — degrade to no known modules, matching structure-discovery.ts's precedent. */
    }
    const moduleNameFor = (base: bigint): string | null => {
      for (const mod of modules) {
        if (base >= mod.baseAddress && base < mod.baseAddress + BigInt(mod.size)) return mod.name;
      }
      return null;
    };
    const sliced = regions.slice(0, cap).map((r) => ({
      baseAddress: `0x${r.baseAddress.toString(16)}`,
      size: r.size,
      writable: r.writable,
      readable: r.readable,
      executable: r.executable,
      guarded: r.guarded,
      rawProtect: r.rawProtect,
      regionType: r.regionType,
      moduleName: moduleNameFor(r.baseAddress),
    }));
    return { regions: sliced, truncated, totalAvailable };
  }

  /** Bounded module listing (metadata only — real name/base/size/on-disk path). */
  listModules(handle: LiveProcessHandle, options: { maxModules?: number } = {}): MemoryModuleList {
    const cap = Math.min(options.maxModules ?? this.maxModules, this.maxModules);
    const modules = this.driver.getModules(handle);
    const totalAvailable = modules.length;
    const truncated = totalAvailable > cap;
    const sliced = modules.slice(0, cap).map((m) => ({
      name: m.name,
      baseAddress: `0x${m.baseAddress.toString(16)}`,
      size: m.size,
      path: m.path ?? null,
    }));
    return { modules: sliced, truncated, totalAvailable };
  }

  /** Read one or more typed interpretations at the same address (read-only). */
  readTypedValues(
    handle: LiveProcessHandle,
    address: string | number | bigint,
    types: ResearchDataType[],
  ): MemoryViewEntry[] {
    const addr = parseResearchAddress(address);
    const results: MemoryViewEntry[] = [];
    let spent = 0;

    for (const type of types) {
      const size = sizeOf(type);
      if (spent + size > this.maxBudgetBytes) {
        results.push({
          address: `0x${addr.toString(16)}`,
          type,
          value: null,
          readable: false,
        });
        continue;
      }
      spent += size;

      try {
        if (type === 'string') {
          const buf = this.driver.readBuffer(handle, addr, STRING_BYTES);
          const nul = buf.indexOf(0);
          const slice = nul >= 0 ? buf.subarray(0, nul) : buf;
          results.push({
            address: `0x${addr.toString(16)}`,
            type,
            value: slice.toString('utf8'),
            readable: true,
          });
        } else {
          const value = this.driver.readMemory(handle, addr, type);
          results.push({
            address: `0x${addr.toString(16)}`,
            type,
            value,
            readable: true,
          });
        }
      } catch {
        results.push({
          address: `0x${addr.toString(16)}`,
          type,
          value: null,
          readable: false,
        });
      }
    }

    return results;
  }
}
