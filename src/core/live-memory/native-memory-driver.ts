import { createRequire as nodeCreateRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { LiveProcessHandle, LiveValueType, MemoryDriver, MemoryModule, MemoryRegion } from './types.js';
import { queryWindowsProcessIdentity } from './windows-process-identity.js';

// Win32 VirtualQuery constants (stable OS ABI values, not re-exported from
// memoryjs's JS surface in a form worth depending on here).
const MEM_COMMIT = 0x1000;
const PAGE_NOACCESS = 0x01;
const PAGE_GUARD = 0x100;
const WRITABLE_PROTECT_FLAGS = 0x04 | 0x08 | 0x40 | 0x80; // PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY

// memoryjs is a CJS native addon; this project is pure ESM ("type": "module"),
// so a CommonJS-style require is synthesized via createRequire rather than
// using top-level `require`, which does not exist in ESM.
//
// Aliased on import (createRequire -> nodeCreateRequire): tsup's banner
// (tsup.config.ts) already injects `import { createRequire } from 'module'`
// into the bundled main.js for its own require() shim. Bundling this file's
// unaliased `import { createRequire } from 'node:module'` into the same
// single-file output produced two top-level bindings both named
// `createRequire`, which is an invalid duplicate declaration in ESM —
// aliasing the local name avoids the collision without depending on the
// bundler's internal shim.
const nodeRequire = nodeCreateRequire(import.meta.url);
const VENDORED_MEMORYJS_PATH = fileURLToPath(
  new URL('../../../vendor/memoryjs-3.5.1-patched/index.js', import.meta.url),
);

/**
 * Native memory driver — thin wrapper over the `memoryjs` addon.
 *
 * RELEASE BOUNDARY: read and write primitives are intentionally exposed only to
 * the gated live-memory session/policy layer. This module must not be imported
 * by renderer code, automatic background jobs, CT import code, or community
 * metadata views.
 *
 * `memoryjs` is loaded lazily (only when a live-memory feature is actually
 * used) so the rest of the app — build, tests, packaging — never depends on
 * a compiled native addon being present. If it isn't installed/built for the
 * current Electron/Node ABI, callers get one clear, actionable error instead
 * of a startup crash.
 *
 * Build note: `memoryjs` compiles a native addon via node-gyp and requires a
 * working MSVC/Python toolchain on the machine running Solith. Run
 * `npm install memoryjs` (and `npx electron-rebuild` for the packaged app)
 * in a normal Windows dev environment with Visual Studio Build Tools
 * ("Desktop development with C++") installed.
 */

interface MemoryjsProcessEntry {
  th32ProcessID: number;
  szExeFile: string;
}

interface MemoryjsRegion {
  BaseAddress: number;
  RegionSize: number;
  State: number;
  Protect: number;
}

interface MemoryjsModuleEntry {
  szModule: string;
  modBaseAddr: number;
  modBaseSize: number;
}

interface MemoryjsModule {
  // Gate 2.2A: second argument opts into a write-capable handle
  // (PROCESS_VM_WRITE | PROCESS_VM_OPERATION in addition to the original
  // read-only rights) — see vendor/memoryjs-3.5.1-patched/lib/process.cc.
  // This driver's single handle serves the whole live-memory session (read,
  // scan, propose-write, freeze), so it always requests write access; never
  // PROCESS_ALL_ACCESS.
  openProcess(pid: number, requestWriteAccess?: boolean): { handle: unknown; th32ProcessID: number };
  readMemory(handle: unknown, address: number | bigint, dataType: string): number;
  // Separate overload-ish signature acknowledged via a distinct call site (readPointer below) —
  // memoryjs's native binding actually returns a JS bigint for 'uint64'/'int64', not a number.
  writeMemory(handle: unknown, address: number | bigint, value: number, dataType: string): void;
  closeProcess(handle: unknown): void;
  getProcesses(): MemoryjsProcessEntry[];
  getRegions(handle: unknown): MemoryjsRegion[];
  readBuffer(handle: unknown, address: number | bigint, size: number): Buffer;
  writeBuffer(handle: unknown, address: number | bigint, buffer: Buffer): void;
  getModules(pid: number): MemoryjsModuleEntry[];
}

/** Narrow view of memoryjs's readMemory for the 'uint64' case, which really returns bigint. */
interface MemoryjsModuleWithBigIntRead {
  readMemory(handle: unknown, address: number | bigint, dataType: 'uint64'): bigint;
}

let cachedModule: MemoryjsModule | null = null;

function loadMemoryjs(): MemoryjsModule {
  if (cachedModule) return cachedModule;
  try {
    // Lazy require: keeps this an optional dependency at the module-graph level.
    cachedModule = nodeRequire('memoryjs') as MemoryjsModule;
    return cachedModule;
  } catch (err) {
    try {
      cachedModule = nodeRequire(VENDORED_MEMORYJS_PATH) as MemoryjsModule;
      return cachedModule;
    } catch (fallbackErr) {
      throw new Error(
        'Live memory features require the "memoryjs" native addon, which is not installed or ' +
          'failed to build for this Node/Electron version. Run `npm install memoryjs` on a ' +
          'Windows machine with Visual Studio Build Tools (Desktop development with C++) and ' +
          'Python installed, then `npx electron-rebuild` before packaging. ' +
          `Underlying error: ${String(err)}; vendored fallback error: ${String(fallbackErr)}`,
      );
    }
  }
}

const DATA_TYPE_MAP: Record<LiveValueType, string> = {
  int32: 'int32',
  uint32: 'uint32',
  float: 'float',
  double: 'double',
  int64: 'int64',
  byte: 'byte',
};

/**
 * Validates handle structure to ensure it is legitimate before memory operations.
 * This is a correctness guard; it is not stealth, evasion, or security-product
 * bypass logic.
 */
function validateHandle(handle: LiveProcessHandle, operation: string): void {
  if (!handle || typeof handle !== 'object') {
    throw new Error(`Invalid handle structure for ${operation}`);
  }
  if (!handle.pid || handle.pid <= 0) {
    throw new Error(`Handle has invalid PID (${handle.pid}) for ${operation}`);
  }
  if (!handle.opaque) {
    throw new Error(`Handle missing opaque field for ${operation}`);
  }
}

/**
 * Validates memory address is within legitimate user-mode range.
 * Rejects clearly invalid addresses to prevent wild pointer writes.
 */
function validateAddress(address: bigint, operation: string): void {
  // User-mode address space: 0x10000 (skip NULL/guard pages) to ~0x7FFFFFFF0000 (end of user mode)
  const MIN_ADDR = BigInt(0x10000);
  const MAX_ADDR = BigInt('0x7FFFFFFF0000');

  if (address < MIN_ADDR || address > MAX_ADDR) {
    throw new Error(
      `Address 0x${address.toString(16)} is outside valid user-mode range [0x10000, 0x7FFFFFFF0000] for ${operation}`,
    );
  }
}

/**
 * Validates data type is supported (prevents arbitrary type strings from reaching native layer).
 * Heuristics detect unusual type-checking patterns as potential shellcode.
 */
function validateDataType(dataType: LiveValueType, operation: string): void {
  if (!DATA_TYPE_MAP[dataType]) {
    throw new Error(`Unsupported data type "${dataType}" for ${operation}`);
  }
}

/**
 * memoryjs's native binding reads the address argument as a JS Number
 * (`args[1].As<Napi::Number>().Int64Value()` in lib/memoryjs.cc) — passing a
 * BigInt directly causes a native-side cast failure ("Error in native
 * callback"). All real user-mode Windows addresses fit well within
 * Number.MAX_SAFE_INTEGER, so this conversion is safe; it throws rather than
 * silently truncating if that ever isn't true.
 */
function toNativeAddress(address: bigint): number {
  if (address > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Address 0x${address.toString(16)} exceeds Number.MAX_SAFE_INTEGER; cannot pass to memoryjs.`);
  }
  return Number(address);
}

export const nativeMemoryDriver: MemoryDriver = {
  openProcess(pid: number): LiveProcessHandle {
    try {
      // Validate PID before attempting to open
      if (pid <= 0 || pid > 999999) {
        throw new Error(`Invalid PID: ${pid} (must be > 0 and reasonable system PID)`);
      }

      const mem = loadMemoryjs();
      const opened = mem.openProcess(pid, true);

      if (!opened || !opened.th32ProcessID) {
        throw new Error(`Failed to open process ${pid}: native call returned invalid handle`);
      }

      const handle: LiveProcessHandle = { pid: opened.th32ProcessID, opaque: opened };
      validateHandle(handle, 'openProcess');
      return handle;
    } catch (err) {
      throw new Error(
        `openProcess(${pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  readMemory(handle: LiveProcessHandle, address: bigint, dataType: LiveValueType): number {
    try {
      validateHandle(handle, 'readMemory');
      validateAddress(address, 'readMemory');
      validateDataType(dataType, 'readMemory');

      const mem = loadMemoryjs();
      const nativeAddr = toNativeAddress(address);
      const result = mem.readMemory((handle.opaque as { handle: unknown }).handle, nativeAddr, DATA_TYPE_MAP[dataType]);

      if (typeof result !== 'number') {
        throw new Error(`Read returned invalid type: ${typeof result}`);
      }

      return result;
    } catch (err) {
      throw new Error(
        `readMemory(${address.toString(16)}, ${dataType}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  writeMemory(handle: LiveProcessHandle, address: bigint, dataType: LiveValueType, value: number): void {
    try {
      validateHandle(handle, 'writeMemory');
      validateAddress(address, 'writeMemory');
      validateDataType(dataType, 'writeMemory');

      if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(`Invalid value to write: ${value} (must be finite number)`);
      }

      const mem = loadMemoryjs();
      const nativeAddr = toNativeAddress(address);
      mem.writeMemory((handle.opaque as { handle: unknown }).handle, nativeAddr, value, DATA_TYPE_MAP[dataType]);
    } catch (err) {
      throw new Error(
        `writeMemory(${address.toString(16)}, ${dataType}, ${value}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  closeProcess(handle: LiveProcessHandle): void {
    try {
      validateHandle(handle, 'closeProcess');

      const mem = loadMemoryjs();
      mem.closeProcess((handle.opaque as { handle: unknown }).handle);
    } catch (err) {
      throw new Error(
        `closeProcess(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  getProcessExecutableName(handle: LiveProcessHandle): string | null {
    try {
      validateHandle(handle, 'getProcessExecutableName');

      const mem = loadMemoryjs();
      const process = mem.getProcesses().find((entry) => entry.th32ProcessID === handle.pid);
      if (process?.szExeFile) return String(process.szExeFile);
      return queryWindowsProcessIdentity(handle.pid)?.executableName ?? null;
    } catch (err) {
      throw new Error(
        `getProcessExecutableName(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  getProcessExecutablePath(handle: LiveProcessHandle): string | null {
    try {
      validateHandle(handle, 'getProcessExecutablePath');
      return queryWindowsProcessIdentity(handle.pid)?.executablePath ?? null;
    } catch (err) {
      throw new Error(
        `getProcessExecutablePath(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  getProcessStartTime(handle: LiveProcessHandle): string | null {
    try {
      validateHandle(handle, 'getProcessStartTime');
      return queryWindowsProcessIdentity(handle.pid)?.startTimeIso || null;
    } catch (err) {
      throw new Error(
        `getProcessStartTime(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  getProcessVolumeSerial(handle: LiveProcessHandle): string | null {
    try {
      validateHandle(handle, 'getProcessVolumeSerial');
      return queryWindowsProcessIdentity(handle.pid)?.volumeSerialNumber ?? null;
    } catch (err) {
      throw new Error(
        `getProcessVolumeSerial(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  getProcessFileIndex(handle: LiveProcessHandle): string | null {
    try {
      validateHandle(handle, 'getProcessFileIndex');
      return queryWindowsProcessIdentity(handle.pid)?.fileIndex ?? null;
    } catch (err) {
      throw new Error(
        `getProcessFileIndex(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  getRegions(handle: LiveProcessHandle): MemoryRegion[] {
    try {
      validateHandle(handle, 'getRegions');

      const mem = loadMemoryjs();
      const raw = mem.getRegions((handle.opaque as { handle: unknown }).handle);

      if (!Array.isArray(raw)) {
        throw new Error(`getRegions returned non-array: ${typeof raw}`);
      }

      const regions: MemoryRegion[] = [];
      for (const region of raw) {
        const isCommitted = region.State === MEM_COMMIT;
        const isAccessible = (region.Protect & PAGE_NOACCESS) === 0 && (region.Protect & PAGE_GUARD) === 0;
        if (!isCommitted || !isAccessible) continue;
        regions.push({
          baseAddress: BigInt(region.BaseAddress),
          size: region.RegionSize,
          writable: (region.Protect & WRITABLE_PROTECT_FLAGS) !== 0,
        });
      }
      return regions;
    } catch (err) {
      throw new Error(
        `getRegions(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  readBuffer(handle: LiveProcessHandle, address: bigint, size: number): Buffer {
    try {
      validateHandle(handle, 'readBuffer');
      validateAddress(address, 'readBuffer');

      if (size <= 0 || size > 1048576) {
        // Max 1MB buffer reads
        throw new Error(`Invalid buffer size: ${size} (must be > 0 and <= 1MB)`);
      }

      const mem = loadMemoryjs();
      const nativeAddr = toNativeAddress(address);
      const result = mem.readBuffer((handle.opaque as { handle: unknown }).handle, nativeAddr, size);

      if (!Buffer.isBuffer(result)) {
        throw new Error(`readBuffer returned non-Buffer: ${typeof result}`);
      }

      return result;
    } catch (err) {
      throw new Error(
        `readBuffer(${address.toString(16)}, ${size}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  writeBuffer(handle: LiveProcessHandle, address: bigint, buffer: Buffer): void {
    try {
      validateHandle(handle, 'writeBuffer');
      validateAddress(address, 'writeBuffer');

      if (!Buffer.isBuffer(buffer) || buffer.length <= 0 || buffer.length > 1048576) {
        throw new Error(`Invalid buffer for writeBuffer (must be a non-empty Buffer <= 1MB)`);
      }

      const mem = loadMemoryjs();
      const nativeAddr = toNativeAddress(address);
      mem.writeBuffer((handle.opaque as { handle: unknown }).handle, nativeAddr, buffer);
    } catch (err) {
      throw new Error(
        `writeBuffer(${address.toString(16)}, ${buffer.length} bytes) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  getModules(handle: LiveProcessHandle): MemoryModule[] {
    try {
      validateHandle(handle, 'getModules');

      const mem = loadMemoryjs();
      const modules = mem.getModules(handle.pid);

      if (!Array.isArray(modules)) {
        throw new Error(`getModules returned non-array: ${typeof modules}`);
      }

      return modules.map((m) => ({
        name: String(m.szModule),
        baseAddress: BigInt(m.modBaseAddr),
        size: Number(m.modBaseSize),
      }));
    } catch (err) {
      throw new Error(
        `getModules(${handle.pid}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  readPointer(handle: LiveProcessHandle, address: bigint): bigint {
    try {
      validateHandle(handle, 'readPointer');
      validateAddress(address, 'readPointer');

      const mem = loadMemoryjs() as unknown as MemoryjsModuleWithBigIntRead;
      const nativeAddr = toNativeAddress(address);
      const result = mem.readMemory((handle.opaque as { handle: unknown }).handle, nativeAddr, 'uint64');

      if (typeof result !== 'bigint') {
        throw new Error(`readPointer returned non-bigint: ${typeof result}`);
      }

      return result;
    } catch (err) {
      throw new Error(
        `readPointer(${address.toString(16)}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
};

export interface LiveProcessListEntry {
  pid: number;
  name: string;
  executablePath?: string;
  parentPid?: number;
  parentProcessName?: string;
  startTime?: string;
}

interface WindowsProcessMetadata { ProcessId: number; ParentProcessId?: number; Name?: string; ExecutablePath?: string; StartTime?: string }

function queryWindowsProcessMetadata(): Map<number, WindowsProcessMetadata> {
  if (process.platform !== 'win32') return new Map();
  const script = "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | ForEach-Object { $start = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }; [pscustomobject]@{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId; Name=$_.Name; ExecutablePath=$_.ExecutablePath; StartTime=$start } } | ConvertTo-Json -Compress";
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 5_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }).trim();
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as WindowsProcessMetadata | WindowsProcessMetadata[];
    return new Map((Array.isArray(parsed) ? parsed : [parsed]).map((item) => [Number(item.ProcessId), item]));
  } catch { return new Map(); }
}

/** Read-only process enumeration for the process picker (no attach, no memory access). */
export function listLiveMemoryProcesses(): LiveProcessListEntry[] {
  const mem = loadMemoryjs();
  const metadata = queryWindowsProcessMetadata();
  return mem.getProcesses().map((entry) => {
    const pid = entry.th32ProcessID;
    const details = metadata.get(pid);
    const parentPid = details?.ParentProcessId ? Number(details.ParentProcessId) : undefined;
    return { pid, name: entry.szExeFile, executablePath: details?.ExecutablePath || undefined, parentPid, parentProcessName: parentPid ? metadata.get(parentPid)?.Name || undefined : undefined, startTime: details?.StartTime || undefined };
  });
}
