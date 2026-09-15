// Phase 1 / Stage 7.4 §5-§6/§12 — closes the last link in the compositional
// AOB migration proof for `feature-resolver.ts`: `LiveMemorySession.resolveMemoryFeature`
// resolves a real AOB-signature-based feature against a real spawned fixture
// process, with the default (zero-override) NATIVE backend, and it is the
// router (not `scanAobInProcess`) that actually performs the scan.
// `createAobResolver()` itself is a thin, unconditional pass-through to the
// already-exhaustively-proven `scanAobViaBackend` (rollback matrix,
// cancellation, wire-type-expansion, real-game canary all cover it
// directly) — this test is the one remaining empirical link: that
// `resolveMemoryFeature` really is wired to call it, not merely that the
// wiring compiles.
//
// The rollback-regression test below deliberately plants its AOB pattern
// inside REFINE_REGION (64 KiB), NOT fixture.rs's PATTERN_REGION (8 MiB) —
// an earlier draft of this test used PATTERN_REGION's own AOB_EXACT_PATTERN
// and failed for a real, structural reason: PATTERN_REGION exceeds
// `native-memory-driver.ts`'s 1 MiB `readBuffer` ceiling, so
// `aob-resolver.ts`'s `scanAobInProcess` throws and silently skips it under
// LEGACY (the exact 1 MiB defect mechanism, applied to AOB) — legacy then
// reports whatever OTHER real coincidental match it finds elsewhere in the
// process's mapped memory instead. That is legacy honestly exhibiting its
// own known, already-documented limit, not a bug in this migration; using a
// legacy-reachable region for the "legacy rollback still works" proof is
// the same fix Stage 7.3's rollback-matrix tests already applied to the
// exact-scan case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.ts';
import type { MemoryFeatureV1 } from '../../src/core/definitions/schema.v1.ts';

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
  writeBytes: (offset: number, leHex: string) => Promise<void>;
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
          resolve({ child, fields, writeBytes });
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
        if (wroteMatch && Number(wroteMatch[1]) === pending.offset) {
          pending.resolve();
        } else {
          pending.reject(new Error(`unexpected fixture response to write: ${line}`));
        }
      }
    }

    function writeBytes(offset: number, leHex: string): Promise<void> {
      return new Promise((res, rej) => {
        pendingWrites.push({ offset, resolve: res, reject: rej });
        child.stdin.write(`write ${offset} ${leHex}\n`);
      });
    }

    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

describeReal('LiveMemorySession.resolveMemoryFeature routes its AOB step through NATIVE by default, zero override', async () => {
  const { LiveMemorySession } = await import('../../src/core/live-memory/live-memory-session.ts');
  const child = await spawnFixture();
  try {
    const session = new LiveMemorySession(nativeMemoryDriver);
    let attachResult: Awaited<ReturnType<typeof session.attach>> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      attachResult = await session.attach({ pid: child.child.pid!, executableName: 'solith-scanner-fixture.exe' }, true);
      if (attachResult.success) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(attachResult!.success, true, `session attach must succeed: ${JSON.stringify(attachResult)}`);
    try {
      const modeResult = session.getScannerRoutingMode();
      assert.equal(modeResult, 'NATIVE', 'a fresh session must default to NATIVE with zero override');

      // fixture.rs's real, always-planted AOB_EXACT_PATTERN inside PATTERN_REGION.
      // NATIVE has no 1 MiB region cap, so this 8 MiB region is fully reachable.
      const feature: MemoryFeatureV1 = {
        id: 'aob-migration-probe',
        name: 'AOB migration probe',
        category: 'Player',
        type: 'freeze',
        dataType: 'int32',
        defaultValue: 0,
        resolution: {
          signature: '48 8B 05 11 22 33 44 89',
          baseOffset: '0x0',
          pointerChain: [],
        },
      };

      const resolved = await session.resolveMemoryFeature(feature);
      const expectedAddress = BigInt(child.fields.PATTERN_REGION_BASE) + BigInt(child.fields.AOB_EXACT_OFFSET);
      assert.equal(resolved.address, expectedAddress, 'must resolve to the real planted AOB match address');

      const diagnostics = session.getScannerBackendDiagnostics();
      assert.equal(diagnostics?.lastOperation?.operation, 'aobScan');
      assert.equal(
        diagnostics?.lastOperation?.effectiveBackend,
        'native',
        `feature resolution's AOB step must have run on NATIVE with zero override; diagnostics: ${JSON.stringify(diagnostics)}`,
      );
      assert.equal(diagnostics?.lastOperation?.fellBackToLegacy, false);
    } finally {
      await session.detach();
    }
  } finally {
    try {
      child.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.child.kill();
  }
});

// Stage 7.4 §12 — rollback regression for the newly-migrated
// feature-resolver caller: explicit NATIVE -> LEGACY -> NATIVE must both
// still work for AOB-signature feature resolution, with no rebuild. Uses a
// pattern planted in REFINE_REGION (64 KiB, legacy-reachable) rather than
// PATTERN_REGION (8 MiB, beyond legacy's 1 MiB cap) — see file header.
describeReal('LiveMemorySession.resolveMemoryFeature: explicit rollback to LEGACY and back to NATIVE both work for AOB resolution', async () => {
  const { LiveMemorySession } = await import('../../src/core/live-memory/live-memory-session.ts');
  const child = await spawnFixture();
  try {
    const session = new LiveMemorySession(nativeMemoryDriver);
    let attachResult: Awaited<ReturnType<typeof session.attach>> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      attachResult = await session.attach({ pid: child.child.pid!, executableName: 'solith-scanner-fixture.exe' }, true);
      if (attachResult.success) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(attachResult!.success, true, `session attach must succeed: ${JSON.stringify(attachResult)}`);
    try {
      // A distinctive 8-byte pattern, freshly planted at runtime — real,
      // legacy-reachable memory, not a value that happens to already exist
      // as a coincidental byte sequence elsewhere in the process.
      const patternOffset = 4096; // clear of plantLegacyReachableValue-style offset-0 usage elsewhere
      const patternHex = 'cafef00dfeedface'; // 8 bytes LE as written; AOB signature below matches the same byte order
      await child.writeBytes(patternOffset, patternHex);

      const feature: MemoryFeatureV1 = {
        id: 'aob-migration-rollback-probe',
        name: 'AOB migration rollback probe',
        category: 'Player',
        type: 'freeze',
        dataType: 'int32',
        defaultValue: 0,
        resolution: {
          signature: 'CA FE F0 0D FE ED FA CE',
          baseOffset: '0x0',
          pointerChain: [],
        },
      };
      const expectedAddress = BigInt(child.fields.REFINE_REGION_BASE) + BigInt(patternOffset);

      // Explicit rollback: LEGACY must still resolve the real, freshly-planted signature.
      session.setScannerRoutingMode('LEGACY');
      const legacyResolved = await session.resolveMemoryFeature(feature);
      assert.equal(legacyResolved.address, expectedAddress, 'legacy AOB rollback must find the real planted pattern in a legacy-reachable region');
      assert.equal(session.getScannerBackendDiagnostics()?.lastOperation?.effectiveBackend, 'legacy');

      // Toggle back: NATIVE must still resolve it too, same router instance, no rebuild.
      session.setScannerRoutingMode('NATIVE');
      session.getAddressCache().clear(); // avoid the session-level address cache masking a real re-resolve
      const nativeResolved = await session.resolveMemoryFeature(feature);
      assert.equal(nativeResolved.address, expectedAddress);
      assert.equal(session.getScannerBackendDiagnostics()?.lastOperation?.effectiveBackend, 'native');
    } finally {
      await session.detach();
    }
  } finally {
    try {
      child.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.child.kill();
  }
});
