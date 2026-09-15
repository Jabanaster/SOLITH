/**
 * Phase 1 / Stage 7.5 §6 — real-process fuzzy AOB proof.
 *
 * A real spawned Windows process (`solith-scanner-fixture.exe`), a real
 * read-only attach, a real drift-tolerant signature resolution through the
 * production `LiveMemorySession` surface, against ground-truth addresses the
 * fixture itself reports on stdout. No fake driver, no injected backend, no
 * routing override on the default path.
 *
 * The third test is the one that closes D01/D03 for the fuzzy path against a
 * real OS process rather than a scripted fixture: a 16-byte signature is
 * planted 6 MiB into the fixture's 8 MiB PATTERN_REGION, far past
 * `native-memory-driver.ts`'s hard 1 MiB `readBuffer` ceiling. Under NATIVE the
 * region is read in chunks and the drifted signature is found at its true
 * address. Under explicit LEGACY rollback the same read fails outright — and
 * the result is now reported as *uncovered* rather than as a confident "not
 * found", which is precisely the false-negative that Stage 7.4 could only close
 * for exact AOB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';

import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.ts';

const testRequire = createRequire(import.meta.url);

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'native',
  'solith-scanner-core',
  'target',
  'release',
  'solith-scanner-fixture.exe',
);

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}

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
  /** Writes into REFINE_REGION (64 KiB — legacy-reachable). */
  writeBytes: (offset: number, leHex: string) => Promise<void>;
  /** Writes into PATTERN_REGION (8 MiB — reaches past the legacy 1 MiB ceiling). */
  writeFarBytes: (offset: number, leHex: string) => Promise<void>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    const pendingWrites: Array<{ offset: number; resolve: () => void; reject: (e: Error) => void }> = [];

    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          child.stdout.on('data', onWriteAckData);
          resolve({ child, fields, writeBytes, writeFarBytes });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }

    let ackBuffered = '';
    function onWriteAckData(chunk: Buffer) {
      ackBuffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = ackBuffered.indexOf('\n')) !== -1) {
        const line = ackBuffered.slice(0, idx).trim();
        ackBuffered = ackBuffered.slice(idx + 1);
        const wroteMatch = /^WROTE (\d+)$/.exec(line);
        const pending = pendingWrites.shift();
        if (!pending) continue;
        if (wroteMatch && Number(wroteMatch[1]) === pending.offset) pending.resolve();
        else pending.reject(new Error(`unexpected fixture response to write: ${line}`));
      }
    }

    function writeBytes(offset: number, leHex: string): Promise<void> {
      return new Promise((res, rej) => {
        pendingWrites.push({ offset, resolve: res, reject: rej });
        child.stdin.write(`write ${offset} ${leHex}\n`);
      });
    }

    function writeFarBytes(offset: number, leHex: string): Promise<void> {
      return new Promise((res, rej) => {
        pendingWrites.push({ offset, resolve: res, reject: rej });
        child.stdin.write(`writefar ${offset} ${leHex}\n`);
      });
    }

    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

async function attachSession(child: FixtureHandle) {
  const { LiveMemorySession } = await import('../../src/core/live-memory/live-memory-session.ts');
  const session = new LiveMemorySession(nativeMemoryDriver);
  let attachResult: Awaited<ReturnType<typeof session.attach>> | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    attachResult = await session.attach(
      { pid: child.child.pid!, executableName: 'solith-scanner-fixture.exe' },
      true,
    );
    if (attachResult.success) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(attachResult!.success, true, `session attach must succeed: ${JSON.stringify(attachResult)}`);
  return session;
}

function killFixture(child: FixtureHandle): void {
  try {
    child.child.stdin.write('exit\n');
  } catch {
    /* already gone */
  }
  child.child.kill();
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

// A freshly planted 8-byte sequence that differs from the searched signature
// in exactly one byte — a real, drift-tolerant (not exact) resolution.
const PLANTED_HEX = 'cafef00dfeedfacf';
const SEARCH_SIGNATURE = 'CA FE F0 0D FE ED FA CE';
const PLANT_OFFSET = 8192;

describeReal('real fuzzy AOB: NATIVE is the default backend with zero override and finds the drifted pattern', async () => {
  const child = await spawnFixture();
  try {
    const session = await attachSession(child);
    try {
      await child.writeBytes(PLANT_OFFSET, PLANTED_HEX);
      const expectedAddress = BigInt(child.fields.REFINE_REGION_BASE) + BigInt(PLANT_OFFSET);

      // Deliberately no setScannerRoutingMode call anywhere above.
      assert.equal(session.getScannerRoutingMode(), 'NATIVE', 'production default must be NATIVE with no override');

      const outcome = await session.scanFuzzyAobViaBackend(SEARCH_SIGNATURE, {
        moduleName: undefined,
        maxDistance: 1,
        maxEdits: 0,
      });

      assert.equal(outcome.backend, 'native', 'the fuzzy path must be served by the native backend by default');
      assert.equal(outcome.match?.address, expectedAddress, 'must resolve to the real planted address');
      assert.equal(outcome.match?.distance, 1, 'exactly one substituted byte');
      assert.equal(outcome.match?.mode, 'fuzzy');
      assert.equal(outcome.match?.driftKind, 'hamming');

      const diagnostics = session.getScannerBackendDiagnostics();
      assert.equal(diagnostics?.lastOperation?.operation, 'fuzzyAobScan');
      assert.equal(diagnostics?.lastOperation?.requestedMode, 'NATIVE');
      assert.equal(diagnostics?.lastOperation?.effectiveBackend, 'native');
      assert.equal(diagnostics?.lastOperation?.fellBackToLegacy, false, 'no hidden fallback');
      assert.equal(diagnostics?.fallbackCount, 0);
    } finally {
      await session.detach();
    }
  } finally {
    killFixture(child);
  }
});

describeReal('real fuzzy AOB: explicit LEGACY rollback resolves the same drifted pattern in a legacy-reachable region', async () => {
  const child = await spawnFixture();
  try {
    const session = await attachSession(child);
    try {
      await child.writeBytes(PLANT_OFFSET, PLANTED_HEX);
      const expectedAddress = BigInt(child.fields.REFINE_REGION_BASE) + BigInt(PLANT_OFFSET);

      // REFINE_REGION is 64 KiB — comfortably under the legacy 1 MiB readBuffer
      // ceiling, so this is a region legacy can genuinely still reach.
      session.setScannerRoutingMode('LEGACY');
      const legacy = await session.scanFuzzyAobViaBackend(SEARCH_SIGNATURE, { maxDistance: 1, maxEdits: 0 });
      assert.equal(legacy.backend, 'legacy');
      assert.equal(legacy.match?.address, expectedAddress);
      assert.equal(legacy.match?.distance, 1);
      assert.equal(session.getScannerBackendDiagnostics()?.lastOperation?.effectiveBackend, 'legacy');

      // Toggle back with no rebuild and no new session.
      session.setScannerRoutingMode('NATIVE');
      const native = await session.scanFuzzyAobViaBackend(SEARCH_SIGNATURE, { maxDistance: 1, maxEdits: 0 });
      assert.equal(native.backend, 'native');
      assert.equal(native.match?.address, expectedAddress, 'both backends agree on this legacy-reachable region');
      assert.equal(session.getScannerBackendDiagnostics()?.lastOperation?.effectiveBackend, 'native');
      assert.equal(session.getScannerBackendDiagnostics()?.fallbackCount, 0);
    } finally {
      await session.detach();
    }
  } finally {
    killFixture(child);
  }
});

describeReal('real fuzzy AOB: a drifted match 6 MiB deep is found under NATIVE and is not a false absence under LEGACY', async () => {
  const child = await spawnFixture();
  try {
    const session = await attachSession(child);
    try {
      // A 16-byte signature, planted 6 MiB into the fixture's 8 MiB
      // PATTERN_REGION. Length matters here: the fixture's own pre-planted
      // FAR_MARKER_PATTERN is 5 bytes, and a 5-byte pattern searched with a
      // one-substitution budget matches coincidentally elsewhere in a real
      // process — which is exactly the false-positive hazard that makes
      // unbounded drift tolerance dangerous, and exactly why module scoping is
      // preserved rather than widened on the native path. 16 bytes with a
      // one-substitution budget is unique in practice.
      const FAR_OFFSET = 6 * 1024 * 1024;
      const plantedHex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const searchSignature = 'A1 B2 C3 D4 E5 F6 07 18 29 3A 4B 5C 6D 7E 8F 91'; // last byte drifted
      await child.writeFarBytes(FAR_OFFSET, plantedHex);

      const expectedAddress = BigInt(child.fields.PATTERN_REGION_BASE) + BigInt(FAR_OFFSET);
      assert.ok(
        FAR_OFFSET > 1_048_576,
        'the planted signature must genuinely sit past the legacy 1 MiB readBuffer ceiling',
      );
      assert.ok(
        Number(child.fields.PATTERN_REGION_SIZE) > 1_048_576,
        'and its containing region must be one legacy cannot read at all',
      );

      const native = await session.scanFuzzyAobViaBackend(searchSignature, { maxDistance: 1, maxEdits: 0 });
      assert.equal(native.backend, 'native');
      assert.equal(
        native.match?.address,
        expectedAddress,
        'native must read past 1 MiB in chunks and find the drifted signature at its true address',
      );
      assert.equal(native.match?.distance, 1);
      assert.equal(native.match?.mode, 'fuzzy');

      session.setScannerRoutingMode('LEGACY');
      const legacy = await session.scanFuzzyAobViaBackend(searchSignature, { maxDistance: 1, maxEdits: 0 });
      assert.equal(legacy.backend, 'legacy');
      assert.equal(
        legacy.match,
        null,
        'legacy genuinely cannot read an 8 MiB region — the defect is preserved for honest rollback, not repaired',
      );
      assert.equal(
        legacy.isAuthoritativeAbsence,
        false,
        'D03 closure on the real fuzzy path: a capped legacy read must never be reported as a confident not-found',
      );
      assert.notEqual(
        legacy.completeness.state,
        'complete',
        'the uncovered region must be visible in the completeness, not silently dropped',
      );
    } finally {
      await session.detach();
    }
  } finally {
    killFixture(child);
  }
});

describeReal('real fuzzy AOB: cancellation is honored and never reported as an authoritative absence', async () => {
  const child = await spawnFixture();
  try {
    const session = await attachSession(child);
    try {
      await child.writeBytes(PLANT_OFFSET, PLANTED_HEX);

      const controller = new AbortController();
      controller.abort();
      const cancelled = await session.scanFuzzyAobViaBackend(
        SEARCH_SIGNATURE,
        { maxDistance: 1, maxEdits: 0 },
        { signal: controller.signal },
      );

      assert.equal(cancelled.match, null, 'a cancelled scan must not return a match');
      assert.equal(cancelled.completeness.state, 'cancelled');
      assert.equal(
        cancelled.isAuthoritativeAbsence,
        false,
        'a cancelled scan is never an authoritative absence',
      );
    } finally {
      await session.detach();
    }
  } finally {
    killFixture(child);
  }
});
