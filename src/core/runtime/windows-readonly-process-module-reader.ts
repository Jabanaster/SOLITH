import type { LiveProcessHandle, MemoryModule } from '../live-memory/types.js';
import { nativeMemoryDriver } from '../live-memory/native-memory-driver.js';
import type { ReadOnlyMemoryReader } from './memory-reader.js';
import type { RuntimeModuleInfo } from './module-inspection.js';
import { assertModuleBounds } from './module-inspection.js';
import type { RuntimeProcessSummary } from './process-discovery.js';
import { assertExplicitProcessSelection } from './process-discovery.js';
import { assessProtectedTarget } from './protected-target-guard.js';

export type WindowsReadOnlyAdapterErrorCode =
  | 'unsupported_platform'
  | 'ambiguous_process'
  | 'access_denied'
  | 'process_exited'
  | 'module_missing'
  | 'partial_read'
  | 'invalid_address_range'
  | 'protected_target';

export class WindowsReadOnlyAdapterError extends Error {
  constructor(
    public readonly code: WindowsReadOnlyAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WindowsReadOnlyAdapterError';
  }
}

export interface WindowsReadOnlyProcessSession extends ReadOnlyMemoryReader {
  readonly process: RuntimeProcessSummary;
  getModules(): RuntimeModuleInfo[];
  close(): void;
}

export interface ReadOnlyProcessModuleDriver {
  openProcess(pid: number): LiveProcessHandle;
  closeProcess(handle: LiveProcessHandle): void;
  getProcessExecutableName(handle: LiveProcessHandle): string | null;
  getModules(handle: LiveProcessHandle): MemoryModule[];
  readBuffer(handle: LiveProcessHandle, address: bigint, size: number): Buffer;
}

export interface WindowsReadOnlyAdapterOptions {
  driver?: ReadOnlyProcessModuleDriver;
  platform?: NodeJS.Platform;
  maxReadBytes?: number;
}

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;

const nativeReadOnlyProcessModuleDriver: ReadOnlyProcessModuleDriver = {
  openProcess: nativeMemoryDriver.openProcess.bind(nativeMemoryDriver),
  closeProcess: nativeMemoryDriver.closeProcess.bind(nativeMemoryDriver),
  getProcessExecutableName: nativeMemoryDriver.getProcessExecutableName.bind(nativeMemoryDriver),
  getModules: nativeMemoryDriver.getModules.bind(nativeMemoryDriver),
  readBuffer: nativeMemoryDriver.readBuffer.bind(nativeMemoryDriver),
};

function toAdapterError(error: unknown): WindowsReadOnlyAdapterError {
  const message = error instanceof Error ? error.message : String(error);
  if (/access is denied|access_denied|permission/i.test(message)) {
    return new WindowsReadOnlyAdapterError('access_denied', message);
  }
  if (/exited|invalid handle|not found/i.test(message)) {
    return new WindowsReadOnlyAdapterError('process_exited', message);
  }
  return new WindowsReadOnlyAdapterError('process_exited', message);
}

function assertNoOverflow(address: bigint, size: number): void {
  if (size < 0 || !Number.isSafeInteger(size)) {
    throw new WindowsReadOnlyAdapterError('invalid_address_range', `Invalid read size: ${size}`);
  }
  const end = address + BigInt(size);
  if (end < address || end > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new WindowsReadOnlyAdapterError('invalid_address_range', 'Read address range overflows supported native address range.');
  }
}

class WindowsReadOnlyProcessModuleSession implements WindowsReadOnlyProcessSession {
  private closed = false;

  constructor(
    public readonly process: RuntimeProcessSummary,
    private readonly handle: LiveProcessHandle,
    private readonly modules: RuntimeModuleInfo[],
    private readonly driver: ReadOnlyProcessModuleDriver,
    private readonly maxReadBytes: number,
  ) {}

  getModules(): RuntimeModuleInfo[] {
    return this.modules.map((module) => ({ ...module }));
  }

  async readModuleBytes(module: RuntimeModuleInfo, offset: number, length: number): Promise<Uint8Array> {
    if (this.closed) throw new WindowsReadOnlyAdapterError('process_exited', 'Process session is closed.');
    if (length > this.maxReadBytes) {
      throw new WindowsReadOnlyAdapterError('invalid_address_range', `Read size ${length} exceeds cap ${this.maxReadBytes}.`);
    }
    const knownModule = this.modules.find((candidate) => candidate.name.toLowerCase() === module.name.toLowerCase());
    if (!knownModule) throw new WindowsReadOnlyAdapterError('module_missing', `Module ${module.name} is not loaded.`);
    try {
      assertModuleBounds(knownModule, offset, length);
      const address = knownModule.baseAddress + BigInt(offset);
      assertNoOverflow(address, length);
      const buffer = this.driver.readBuffer(this.handle, address, length);
      if (buffer.length !== length) {
        throw new WindowsReadOnlyAdapterError('partial_read', `Expected ${length} bytes, read ${buffer.length}.`);
      }
      return new Uint8Array(buffer);
    } catch (error) {
      if (error instanceof WindowsReadOnlyAdapterError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/bounds|range|size|address/i.test(message)) {
        throw new WindowsReadOnlyAdapterError('invalid_address_range', message);
      }
      throw new WindowsReadOnlyAdapterError('partial_read', message);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.driver.closeProcess(this.handle);
  }
}

export function openWindowsReadOnlyProcessSession(
  process: RuntimeProcessSummary,
  options: WindowsReadOnlyAdapterOptions = {},
): WindowsReadOnlyProcessSession {
  const platform = options.platform ?? process.platform ?? globalThis.process.platform;
  if (platform !== 'win32') {
    throw new WindowsReadOnlyAdapterError('unsupported_platform', `Windows read-only adapter does not support ${platform}.`);
  }
  assertExplicitProcessSelection(process);

  const driver = options.driver ?? nativeReadOnlyProcessModuleDriver;
  let handle: LiveProcessHandle | null = null;
  try {
    handle = driver.openProcess(process.pid);
    const executableName = driver.getProcessExecutableName(handle);
    if (!executableName) {
      throw new WindowsReadOnlyAdapterError('process_exited', `Process ${process.pid} exited or could not be queried.`);
    }
    if (executableName.toLowerCase() !== process.executableName.toLowerCase()) {
      throw new WindowsReadOnlyAdapterError(
        'ambiguous_process',
        `Selected PID ${process.pid} is ${executableName}, expected ${process.executableName}.`,
      );
    }
    const modules = driver.getModules(handle).map((module) => ({
      name: module.name,
      baseAddress: module.baseAddress,
      size: module.size,
    }));
    const protectedTarget = assessProtectedTarget({
      process: { ...process, executableName },
      modules,
    });
    if (!protectedTarget.allowed) {
      throw new WindowsReadOnlyAdapterError('protected_target', protectedTarget.reason);
    }
    return new WindowsReadOnlyProcessModuleSession(
      { ...process, executableName },
      handle,
      modules,
      driver,
      options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    );
  } catch (error) {
    if (handle) {
      try {
        driver.closeProcess(handle);
      } catch {
        // best-effort cleanup after failed open
      }
    }
    if (error instanceof WindowsReadOnlyAdapterError) throw error;
    throw toAdapterError(error);
  }
}
