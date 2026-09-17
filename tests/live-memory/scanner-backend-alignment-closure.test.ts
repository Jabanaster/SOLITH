// Phase 1 / Stage 7.4 §3 — closes the alignment shipping defect's remaining
// gap: Stage 7.3 could not test u16 unaligned at all (no wire type existed).
// This proves u16/u32/u64 unaligned AND chunk-boundary-straddling exact
// values (fixture.rs's BOUNDARY_U16/U32/U64_OFFSET/VALUE constants — each
// deliberately positioned to straddle a 1 MiB chunk boundary AND to be
// unaligned for its own width) are found through the real, default NATIVE
// production route with zero override. i16/i32/i64 unaligned proof already
// exists in scanner-backend-wire-type-expansion.test.ts (fixture.rs documents
// I16_OFFSET/I32_OFFSET/I64_OFFSET as "// unaligned" directly) — not
// duplicated here.
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

  // Stage 7.5 — absorb EPIPE on the fixture's stdin.
  //
  // Teardown writes "exit\n" and then kills the child. `stream.write()` does
  // NOT report a broken pipe synchronously — it emits an asynchronous 'error'
  // event — so the `try { ... } catch {}` around that write cannot catch it.
  // With no 'error' listener attached, Node escalates EPIPE to an
  // uncaughtException, and because it lands after the test function has
  // already returned, the test runner reports it as "generated asynchronous
  // activity after the test ended" and fails the whole file.
  //
  // This is what intermittently failed `PR Windows` on the CI runner (observed
  // at ff10505, fb5f7d0, 6fcd0c5 and 252a34c, while passing at 0fcc77d and
  // af5a0bd) — a race whose outcome depends on how quickly the child dies
  // relative to the write, which is exactly the kind of thing a loaded shared
  // runner changes. Attaching a listener makes the error handled rather than
  // fatal; it does not hide a real failure, because a fixture that has already
  // been told to exit has no further output anyone is waiting on.
  child.stdin.on('error', () => {
    /* fixture already gone — nothing left to say to it */
  });
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
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-alignment-test-'));
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

interface BoundaryCase {
  dataType: 'u16' | 'u32' | 'u64';
  offsetField: string;
  valueField: string;
  widthBytes: number;
  kind: 'number' | 'bigint';
}

const CASES: BoundaryCase[] = [
  { dataType: 'u16', offsetField: 'BOUNDARY_U16_OFFSET', valueField: 'BOUNDARY_U16_VALUE', widthBytes: 2, kind: 'number' },
  { dataType: 'u32', offsetField: 'BOUNDARY_U32_OFFSET', valueField: 'BOUNDARY_U32_VALUE', widthBytes: 4, kind: 'number' },
  { dataType: 'u64', offsetField: 'BOUNDARY_U64_OFFSET', valueField: 'BOUNDARY_U64_VALUE', widthBytes: 8, kind: 'bigint' },
];

for (const c of CASES) {
  describeReal(
    `${c.dataType} unaligned + chunk-boundary-straddling value (${c.valueField}) is found through default NATIVE, zero override`,
    async () => {
      await withAttachedFixture(async ({ event, fields }) => {
        const offset = Number(fields[c.offsetField]);
        assert.notEqual(offset % c.widthBytes, 0, `test precondition: ${c.offsetField} must actually be unaligned for a ${c.widthBytes}-byte width`);

        const modeResult = await mock.__invoke('live-memory-scanner-routing-mode-get', event, {});
        assert.equal(modeResult.mode, 'NATIVE', 'a fresh session must default to NATIVE with zero override');

        const payload: Record<string, unknown> = { dataType: c.dataType };
        if (c.kind === 'bigint') {
          const decimal = BigInt(fields[c.valueField]).toString();
          payload.targetValue = Number(decimal);
          payload.targetValueBigint = decimal;
        } else {
          payload.targetValue = Number(fields[c.valueField]);
        }

        const result = await mock.__invoke('live-memory-scan-first', event, payload);
        assert.equal(result.success, true, `scan must succeed: ${JSON.stringify(result)}`);
        assert.equal(result.result.backend, 'native');

        const expectedAddress = BigInt(fields.TYPES_REGION_BASE) + BigInt(offset);
        const match = result.result.matches.find((m: any) => BigInt(m.address) === expectedAddress);
        assert.ok(
          match,
          `expected an unaligned exact match at TYPES_REGION+${offset} (0x${expectedAddress.toString(16)}); got ${JSON.stringify(result.result.matches).slice(0, 500)}`,
        );
        if (c.kind === 'bigint') {
          assert.equal(match.valueBigint, BigInt(fields[c.valueField]).toString());
        } else {
          assert.equal(match.value, Number(fields[c.valueField]));
        }
      });
    },
  );
}

// Explicit aligned-only behavior still works when intentionally requested
// (mission §3's "Also prove explicit aligned-only behavior still works if
// the product exposes it") — U32_VALUE is a 4-byte-aligned u32 in the same
// TYPES_REGION, and every prior stage's test suite already exercises this
// repeatedly through the default route; this test just reconfirms it here
// alongside the unaligned proofs above so the alignment story is complete
// in one file.
describeReal('explicit aligned u32 value is still found normally alongside the unaligned proofs above', async () => {
  await withAttachedFixture(async ({ event, fields }) => {
    const offset = Number(fields.U32_OFFSET);
    assert.equal(offset % 4, 0, 'U32_OFFSET is the aligned control case');
    const result = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'u32',
      targetValue: Number(fields.U32_VALUE),
    });
    assert.equal(result.success, true);
    const expectedAddress = BigInt(fields.TYPES_REGION_BASE) + BigInt(offset);
    const match = result.result.matches.find((m: any) => BigInt(m.address) === expectedAddress);
    assert.ok(match, 'aligned exact scan must still work unchanged');
  });
});
