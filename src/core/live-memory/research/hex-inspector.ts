/**
 * Phase 9 — hex/ASCII window inspector (RPM read-only).
 */
import type { LiveProcessHandle, MemoryDriver } from '../types.js';
import { parseResearchAddress } from './memory-viewer.js';

export interface HexRow {
  offset: number;
  hex: string;
  ascii: string;
}

export interface HexWindow {
  address: string;
  size: number;
  hexRows: HexRow[];
  truncated: boolean;
  readable: boolean;
  error?: string;
}

const DEFAULT_MAX_WINDOW = 4096;
const MIN_WINDOW = 16;

export class HexInspector {
  private readonly maxWindowSize: number;

  constructor(
    private readonly driver: MemoryDriver,
    maxWindowSize = DEFAULT_MAX_WINDOW,
  ) {
    this.maxWindowSize = Math.max(MIN_WINDOW, maxWindowSize);
  }

  inspect(
    handle: LiveProcessHandle,
    address: string | number | bigint,
    requestedSize: number,
  ): HexWindow {
    const addr = parseResearchAddress(address);
    const clamped = Math.min(Math.max(Math.trunc(requestedSize) || MIN_WINDOW, MIN_WINDOW), this.maxWindowSize);
    const truncated = requestedSize > this.maxWindowSize;

    try {
      const buffer = this.driver.readBuffer(handle, addr, clamped);
      const hexRows: HexRow[] = [];
      for (let i = 0; i < buffer.length; i += 16) {
        const chunk = buffer.subarray(i, Math.min(i + 16, buffer.length));
        const hex = Array.from(chunk)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ');
        const ascii = Array.from(chunk)
          .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
          .join('');
        hexRows.push({ offset: i, hex, ascii });
      }
      return {
        address: `0x${addr.toString(16)}`,
        size: buffer.length,
        hexRows,
        truncated,
        readable: true,
      };
    } catch (err) {
      return {
        address: `0x${addr.toString(16)}`,
        size: 0,
        hexRows: [],
        truncated,
        readable: false,
        error: String(err),
      };
    }
  }
}
