import { createRequire as nodeCreateRequire } from 'node:module';
import type { LiveProcessHandle } from '../live-memory/types.js';

const nodeRequire = nodeCreateRequire(import.meta.url);

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;
const PAGE_EXECUTE_READWRITE = 0x40;

interface MemoryjsBridge {
  virtualAllocEx(
    handle: unknown,
    address: number,
    size: number,
    allocationType: number,
    protection: number,
  ): number;
  writeBuffer(handle: unknown, address: number | bigint, buffer: Buffer): boolean;
  readBuffer(handle: unknown, address: number | bigint, size: number): Buffer;
}

let cached: MemoryjsBridge | null = null;

function loadBridge(): MemoryjsBridge {
  if (cached) return cached;
  cached = nodeRequire('memoryjs') as MemoryjsBridge;
  return cached;
}

function nativeHandle(handle: LiveProcessHandle): unknown {
  return (handle.opaque as { handle: unknown }).handle;
}

function toNativeAddress(address: bigint): number {
  if (address > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Address 0x${address.toString(16)} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(address);
}

export function allocateCodeCave(handle: LiveProcessHandle, size: number): bigint {
  const mem = loadBridge();
  const allocated = mem.virtualAllocEx(
    nativeHandle(handle),
    0,
    size,
    MEM_COMMIT | MEM_RESERVE,
    PAGE_EXECUTE_READWRITE,
  );
  if (!allocated) {
    throw new Error('VirtualAllocEx failed for code cave');
  }
  return BigInt(allocated);
}

export function writeProcessBuffer(handle: LiveProcessHandle, address: bigint, buffer: Buffer): void {
  const mem = loadBridge();
  const ok = mem.writeBuffer(nativeHandle(handle), toNativeAddress(address), buffer);
  if (!ok) {
    throw new Error(`writeBuffer failed at 0x${address.toString(16)}`);
  }
}

export function readProcessBuffer(handle: LiveProcessHandle, address: bigint, size: number): Buffer {
  const mem = loadBridge();
  return mem.readBuffer(nativeHandle(handle), toNativeAddress(address), size);
}
