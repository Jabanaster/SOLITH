// Phase 2 P2-6/P2-9 mission §3 — cross-cutting native lifecycle defect audit.
//
// P2-5 disclosed that `readBuffer()` against a `VirtualAlloc`'d region can
// remain non-deterministically successful for an unbounded time after the
// target process is confirmed terminated (probed to 60s+), even though
// `getModules()`/`getRegions()` correctly detect the exit in the same
// session. Root cause (this stage): `readMemory`/`readBuffer`/`readPointer`/
// `writeMemory`/`writeBuffer` in `native-memory-driver.ts` never re-validated
// process liveness before delegating to memoryjs's `ReadProcessMemory`/
// `WriteProcessMemory`, which Windows will happily satisfy against an
// already-open HANDLE for as long as that HANDLE keeps the target's kernel
// process object (and its mapped memory) alive — independent of whether the
// process has actually exited. `getModules`/`getRegions` never showed the
// symptom because memoryjs backs them with a different, OS-process-table-
// backed API.
//
// Fix: a cheap `process.kill(pid, 0)` liveness probe (queries the live OS
// process table directly, not the stale HANDLE) is now the first check in
// every raw read/write primitive. This test proves it closes the gap: a
// real spawned process, killed for real, must make every subsequent raw
// read/write fail promptly and truthfully (`PROCESS_EXITED:` prefix), never
// silently succeed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.ts';

const FIXTURE_PATH = path.resolve(
  import.meta.dirname, '..', '..', 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe',
);

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}

const testRequire = createRequire(import.meta.url);
function memoryjsAvailable(): boolean {
  try {
    testRequire('memoryjs');
    return true;
  } catch {
    try {
      testRequire(path.resolve(import.meta.dirname, '..', '..', 'vendor', 'memoryjs-3.5.1-patched', 'index.js'));
      return true;
    } catch {
      return false;
    }
  }
}

interface SpawnedFixture {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

function spawnFixture(): Promise<SpawnedFixture> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let buffer = '';
    const fields: Record<string, string> = {};
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          resolve({ child, fields });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    };
    child.stdout.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`fixture exited early with code ${code}`)));
  });
}

function killFixture(fixture: SpawnedFixture): Promise<void> {
  return new Promise((resolve) => {
    if (fixture.child.exitCode !== null || fixture.child.killed) {
      resolve();
      return;
    }
    fixture.child.once('exit', () => resolve());
    try {
      fixture.child.stdin.write('die\n');
    } catch {
      /* absorbed — see spawnFixture's stdin error handler */
    }
    fixture.child.kill('SIGKILL');
  });
}

test(
  'readBuffer/readMemory/readPointer/writeMemory/writeBuffer all fail promptly and truthfully after real process death (spec §3 cross-cutting fix)',
  { skip: !fixtureAvailable() || !memoryjsAvailable() ? 'native fixture or memoryjs addon not available in this environment' : false },
  async () => {
    const fixture = await spawnFixture();
    const structBase = BigInt(fixture.fields.STRUCT_REGION_BASE);
    const pid = fixture.child.pid!;

    const handle = nativeMemoryDriver.openProcess(pid);

    // Sanity: the process is genuinely alive and readable before death.
    const before = nativeMemoryDriver.readBuffer(handle, structBase, 16);
    assert.equal(before.length, 16, 'must read real bytes while the process is alive');

    await killFixture(fixture);
    // Give the OS a moment to fully retire the process table entry; the
    // liveness probe is what must make this deterministic, not this wait.
    await new Promise((r) => setTimeout(r, 250));

    assert.throws(
      () => nativeMemoryDriver.readBuffer(handle, structBase, 16),
      /PROCESS_EXITED:/,
      'readBuffer must never claim live success after the process is confirmed dead',
    );
    assert.throws(
      () => nativeMemoryDriver.readMemory(handle, structBase, 'int32'),
      /PROCESS_EXITED:/,
      'readMemory must never claim live success after the process is confirmed dead',
    );
    assert.throws(
      () => nativeMemoryDriver.readPointer(handle, structBase),
      /PROCESS_EXITED:/,
      'readPointer must never claim live success after the process is confirmed dead',
    );
    assert.throws(
      () => nativeMemoryDriver.writeMemory(handle, structBase, 'int32', 1),
      /PROCESS_EXITED:/,
      'writeMemory must never claim live success after the process is confirmed dead',
    );
    assert.throws(
      () => nativeMemoryDriver.writeBuffer(handle, structBase, Buffer.alloc(4)),
      /PROCESS_EXITED:/,
      'writeBuffer must never claim live success after the process is confirmed dead',
    );
  },
);
