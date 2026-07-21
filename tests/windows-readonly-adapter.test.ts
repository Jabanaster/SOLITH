import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openWindowsReadOnlyProcessSession,
  type ReadOnlyProcessModuleDriver,
  WindowsReadOnlyAdapterError,
} from '../src/core/runtime/windows-readonly-process-module-reader.ts';
import type { LiveProcessHandle, MemoryModule } from '../src/core/live-memory/types.ts';

class FakeReadOnlyProcessModuleDriver implements ReadOnlyProcessModuleDriver {
  opened = false;
  closed = false;
  executableName: string | null = 'Game.exe';
  modules: MemoryModule[] = [{ name: 'Game.exe', baseAddress: 0x1000n, size: 8 }];
  bytes = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0x11, 0x22, 0x33, 0x44]);
  partialRead = false;
  throwOnOpen: Error | null = null;

  openProcess(pid: number): LiveProcessHandle {
    if (this.throwOnOpen) throw this.throwOnOpen;
    this.opened = true;
    return { pid, opaque: { handle: 'fake' } };
  }

  closeProcess(): void {
    this.closed = true;
  }

  getProcessExecutableName(): string | null {
    return this.executableName;
  }

  getModules(): MemoryModule[] {
    return this.modules;
  }

  readBuffer(_handle: LiveProcessHandle, address: bigint, size: number): Buffer {
    const offset = Number(address - 0x1000n);
    const result = this.bytes.subarray(offset, offset + size);
    return this.partialRead ? result.subarray(0, Math.max(0, result.length - 1)) : result;
  }

}

describe('Windows read-only process module adapter', () => {
  test('opens explicitly selected Windows process, verifies executable, reads module bytes, and closes', async () => {
    const driver = new FakeReadOnlyProcessModuleDriver();
    const session = openWindowsReadOnlyProcessSession(
      { pid: 123, executableName: 'Game.exe', selectedByUser: true },
      { driver, platform: 'win32' },
    );

    assert.equal(driver.opened, true);
    assert.equal(session.getModules()[0]?.name, 'Game.exe');
    assert.deepEqual([...await session.readModuleBytes(session.getModules()[0]!, 1, 3)], [0xbb, 0xcc, 0xdd]);
    session.close();
    assert.equal(driver.closed, true);
  });

  test('rejects unsupported platforms and non-explicit process selection', () => {
    assert.throws(
      () => openWindowsReadOnlyProcessSession({ pid: 1, executableName: 'Game.exe', selectedByUser: true }, { driver: new FakeReadOnlyProcessModuleDriver(), platform: 'linux' }),
      /does not support linux/,
    );
    assert.throws(
      () => openWindowsReadOnlyProcessSession({ pid: 1, executableName: 'Game.exe', selectedByUser: false }, { driver: new FakeReadOnlyProcessModuleDriver(), platform: 'win32' }),
      /explicitly selected/,
    );
  });

  test('cleans up handle when executable identity verification fails', () => {
    const driver = new FakeReadOnlyProcessModuleDriver();
    driver.executableName = 'Other.exe';

    assert.throws(
      () => openWindowsReadOnlyProcessSession({ pid: 123, executableName: 'Game.exe', selectedByUser: true }, { driver, platform: 'win32' }),
      /expected Game\.exe/,
    );
    assert.equal(driver.closed, true);
  });

  test('returns structured errors for access denial, missing modules, invalid ranges, and partial reads', async () => {
    const denied = new FakeReadOnlyProcessModuleDriver();
    denied.throwOnOpen = new Error('Access is denied');
    assert.throws(
      () => openWindowsReadOnlyProcessSession({ pid: 123, executableName: 'Game.exe', selectedByUser: true }, { driver: denied, platform: 'win32' }),
      (error) => error instanceof WindowsReadOnlyAdapterError && error.code === 'access_denied',
    );

    const driver = new FakeReadOnlyProcessModuleDriver();
    const session = openWindowsReadOnlyProcessSession(
      { pid: 123, executableName: 'Game.exe', selectedByUser: true },
      { driver, platform: 'win32', maxReadBytes: 4 },
    );

    await assert.rejects(
      () => session.readModuleBytes({ name: 'Missing.exe', baseAddress: 0n, size: 1 }, 0, 1),
      (error) => error instanceof WindowsReadOnlyAdapterError && error.code === 'module_missing',
    );
    await assert.rejects(
      () => session.readModuleBytes(session.getModules()[0]!, 0, 5),
      (error) => error instanceof WindowsReadOnlyAdapterError && error.code === 'invalid_address_range',
    );
    await assert.rejects(
      () => session.readModuleBytes(session.getModules()[0]!, 7, 2),
      (error) => error instanceof WindowsReadOnlyAdapterError && error.code === 'invalid_address_range',
    );

    driver.partialRead = true;
    await assert.rejects(
      () => session.readModuleBytes(session.getModules()[0]!, 0, 3),
      (error) => error instanceof WindowsReadOnlyAdapterError && error.code === 'partial_read',
    );
  });

  test('exposes no write-capable driver surface to the adapter', () => {
    const driver = new FakeReadOnlyProcessModuleDriver();
    assert.equal('writeMemory' in driver, false);
    assert.equal('readPointer' in driver, false);
    assert.equal('getRegions' in driver, false);
  });
});
