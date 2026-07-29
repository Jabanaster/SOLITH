// Gate 2.2 Phase 3 — manual verification script (not wired into npm test;
// requires the compiled Gate2_2Fixture.exe, which is a build artifact, not a
// committed file). Run directly via the trusted Node 22 runtime:
//
//   node --experimental-strip-types verify-fixture-real-memory-driver.mts
//
// Proves the project's REAL nativeMemoryDriver (src/core/live-memory/native-memory-driver.ts,
// the same object the packaged app uses) can open the fixture process, read
// its pinned sentinel at the address the fixture itself reports, write a new
// value through the driver, and observe that write reflected back out via
// the fixture's own independent status-file loop — i.e. the write really
// landed in the target process's real memory, not just in some mock.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'os';
import { nativeMemoryDriver } from '../../../../../src/core/live-memory/native-memory-driver.ts';

const ROOT = path.resolve(import.meta.dirname, '../../../../../');
const FIXTURE_EXE = path.join(
  ROOT,
  'tests/fixtures/gate2-2-memory-fixture/bin/Release/net9.0/Gate2_2Fixture.exe',
);

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const statusPath = path.join(os.tmpdir(), `gate2-2-fixture-status-${runId}.json`);
const stopPath = path.join(os.tmpdir(), `gate2-2-fixture-stop-${runId}.stop`);

function readStatus(): { pid: number; addressHex: string; value: number; updatedAtIso: string } {
  return JSON.parse(readFileSync(statusPath, 'utf8'));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!existsSync(FIXTURE_EXE)) {
    console.error(`FAIL: fixture exe not found at ${FIXTURE_EXE} — build it first (dotnet build -c Release).`);
    process.exitCode = 1;
    return;
  }

  const child = spawn(FIXTURE_EXE, [statusPath, stopPath], { stdio: 'ignore', windowsHide: true });
  try {
    await sleep(500);
    const before = readStatus();
    console.log('fixture status before write:', before);

    const handle = nativeMemoryDriver.openProcess(before.pid);
    const address = BigInt(before.addressHex);

    const readBack = nativeMemoryDriver.readMemory(handle, address, 'int32');
    console.log(`driver.readMemory -> ${readBack} (expected ${before.value})`);
    if (readBack !== before.value) {
      throw new Error(`readMemory mismatch: driver saw ${readBack}, fixture reported ${before.value}`);
    }

    const NEW_VALUE = 777001;
    nativeMemoryDriver.writeMemory(handle, address, 'int32', NEW_VALUE);
    console.log(`driver.writeMemory -> wrote ${NEW_VALUE}`);

    await sleep(400);
    const after = readStatus();
    console.log('fixture status after write:', after);
    if (after.value !== NEW_VALUE) {
      throw new Error(`fixture did not observe the driver's write: expected ${NEW_VALUE}, saw ${after.value}`);
    }

    console.log('PASS: real nativeMemoryDriver read + write verified against the Gate 2.2 fixture process.');
  } finally {
    writeFileSync(stopPath, '');
    await sleep(500);
    try { unlinkSync(statusPath); } catch { /* fixture already deleted it */ }
    try { unlinkSync(stopPath); } catch { /* best-effort */ }
    if (child.pid && !child.killed) {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
