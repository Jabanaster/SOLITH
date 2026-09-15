// Phase 1 / Stage 7.4 §1 — proves the wire actually carries the 4 canonical
// short type names the legacy vocabulary had no name for at all (i8, i16,
// u16, u64), plus the 6 already-existing canonical names that happen to
// overlap a legacy name 1:1 (u8/i32/u32/i64/f32/f64), through the REAL
// registered `live-memory-scan-first` IPC handler against a real spawned
// fixture process, with the default (zero-override) NATIVE backend. Same
// harness as scanner-backend-ipc-real-path.test.ts. Every value here is one
// of the fixture's own pre-planted TYPES_REGION constants (fixture.rs) — no
// runtime writes needed for this file.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

register(new URL('./fixtures/electron-loader.mjs', import.meta.url));

const mock = await import('./fixtures/electron-ipc-mock.mjs');
const { registerTrustedWindow, _clearTrustedWindowsForTests } = await import(
  '../../src/core/security/trusted-sender-registry.ts'
);
const ipcModule = await import('../../electron/live-memory-ipc.ts');
const { initDatabase } = await import('../../src/core/database/index.ts');

const FIXTURE_PATH = path.resolve(
  import.meta.dirname, '..', '..', 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe',
);

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}

const testRequire = createRequire(import.meta.url);
function nativeAddonAvailable(): boolean {
  try {
    testRequire('solith-scanner-napi');
    return true;
  } catch {
    return false;
  }
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          resolve({ child, fields });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

let nextSenderId = 1;
function makeTrustedEvent() {
  const id = nextSenderId++;
  registerTrustedWindow({ webContentsId: id, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
  const mainFrame = { url: 'file:///app/dist/index.html#/trainer' };
  const sender = {
    id,
    isDestroyed: () => false,
    mainFrame,
    once: (_event: string, _listener: () => void) => {},
    on: (_event: string, _listener: (...args: unknown[]) => void) => {},
  };
  return { sender, senderFrame: mainFrame } as any;
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

async function withAttachedFixture<T>(fn: (ctx: { event: unknown; fields: Record<string, string> }) => Promise<T>): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-wiretype-test-'));
  mock.__setUserDataDir(userDataDir);
  await initDatabase();
  ipcModule.registerLiveMemoryIpc();
  const child = await spawnFixture();
  try {
    const event = makeTrustedEvent();
    const attachResult = await mock.__invoke('live-memory-attach', event, {
      pid: child.child.pid!,
      executableName: 'solith-scanner-fixture.exe',
      userConfirmedOffline: true,
    });
    assert.equal(attachResult.success, true, `attach must succeed: ${JSON.stringify(attachResult)}`);
    return await fn({ event, fields: child.fields });
  } finally {
    try {
      child.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.child.kill();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

interface WireTypeCase {
  dataType: string;
  offsetField: string;
  valueField: string;
  /**
   * How to compare the fixture's raw KEY=VALUE string to the IPC response's
   * `value`/`valueBigint`. 'float' widens the fixture's own f32 constant via
   * `Math.fround` before comparing — the fixture declares its constant
   * directly as an `f32` literal, but this test's `targetValue` and the raw
   * KEY=VALUE string both round-trip through a full f64 JS `Number` first,
   * so comparing against the un-rounded f64 parse would spuriously fail on
   * the low mantissa bits despite the scan itself being exactly correct.
   */
  kind: 'number' | 'bigint' | 'float';
}

// Every case below is a fixture.rs TYPES_REGION constant. i16/i32/i64 are
// individually documented in fixture.rs as deliberately unaligned offsets
// ("// unaligned"), so these cases are simultaneously the first proof this
// stage has that the WIRE can even name these types at all (i8/i16/u16/u64
// have no legacy wire name) and, for the unaligned ones, real evidence
// toward the alignment defect (scanner-backend-alignment-closure.test.ts
// carries the dedicated boundary-straddling proof).
const CASES: WireTypeCase[] = [
  { dataType: 'i8', offsetField: 'I8_OFFSET', valueField: 'I8_VALUE', kind: 'number' },
  { dataType: 'u8', offsetField: 'U8_OFFSET', valueField: 'U8_VALUE', kind: 'number' },
  { dataType: 'i16', offsetField: 'I16_OFFSET', valueField: 'I16_VALUE', kind: 'number' },
  { dataType: 'u16', offsetField: 'U16_OFFSET', valueField: 'U16_VALUE', kind: 'number' },
  { dataType: 'i32', offsetField: 'I32_OFFSET', valueField: 'I32_VALUE', kind: 'number' },
  { dataType: 'u32', offsetField: 'U32_OFFSET', valueField: 'U32_VALUE', kind: 'number' },
  { dataType: 'i64', offsetField: 'I64_OFFSET', valueField: 'I64_VALUE', kind: 'bigint' },
  { dataType: 'u64', offsetField: 'U64_OFFSET', valueField: 'U64_VALUE', kind: 'bigint' },
  { dataType: 'u64', offsetField: 'U64_HUGE_OFFSET', valueField: 'U64_HUGE_VALUE', kind: 'bigint' },
  { dataType: 'f32', offsetField: 'F32_OFFSET', valueField: 'F32_VALUE', kind: 'float' },
  { dataType: 'f64', offsetField: 'F64_OFFSET', valueField: 'F64_VALUE', kind: 'number' },
];

for (const c of CASES) {
  describeReal(
    `wire type "${c.dataType}" (${c.valueField}) round-trips exactly through live-memory-scan-first, default NATIVE, zero override`,
    async () => {
      await withAttachedFixture(async ({ event, fields }) => {
        const modeResult = await mock.__invoke('live-memory-scanner-routing-mode-get', event, {});
        assert.equal(modeResult.mode, 'NATIVE', 'a fresh session must default to NATIVE with zero override');

        const payload: Record<string, unknown> = { dataType: c.dataType };
        if (c.kind === 'bigint') {
          const decimal = BigInt(fields[c.valueField]).toString();
          payload.targetValue = Number(decimal); // best-effort display value, ignored for exactness
          payload.targetValueBigint = decimal;
        } else {
          payload.targetValue = Number(fields[c.valueField]);
        }
        const expectedNumber = c.kind === 'float' ? Math.fround(Number(fields[c.valueField])) : Number(fields[c.valueField]);
        const result = await mock.__invoke('live-memory-scan-first', event, payload);
        assert.equal(result.success, true, `scan must succeed: ${JSON.stringify(result)}`);
        assert.equal(result.result.backend, 'native', 'must run on the default NATIVE backend with zero override');

        const expectedAddress = BigInt(fields.TYPES_REGION_BASE) + BigInt(fields[c.offsetField]);
        const match = result.result.matches.find((m: any) => BigInt(m.address) === expectedAddress);
        assert.ok(
          match,
          `expected a match at TYPES_REGION+${fields[c.offsetField]} (0x${expectedAddress.toString(16)}); got ${JSON.stringify(result.result.matches).slice(0, 500)}`,
        );
        if (c.kind === 'bigint') {
          assert.equal(match.valueBigint, BigInt(fields[c.valueField]).toString(), 'exact BigInt value must round-trip with no precision loss');
        } else {
          assert.equal(match.value, expectedNumber, 'exact value must round-trip');
        }
      });
    },
  );
}
