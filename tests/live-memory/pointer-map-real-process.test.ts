/**
 * Phase 2 P2-2 (mission §15) — real-process, two-target pointer-map proof.
 *
 * A real spawned Windows fixture process plants two wholly independent
 * module-rooted pointer chains (see native/solith-scanner-core/src/bin/
 * fixture.rs — Target A is the Phase 1 depth-3/cycle chain, Target B is a
 * separate depth-1 chain added for this stage). This exercises the
 * production path scanTargetsIntoMap must not finish on FakeMemoryDriver
 * alone:
 *
 *   both real targets populate real map nodes in one operation, grouped
 *   correctly and not merged; resolution against the real process matches
 *   ground truth; and saving the map, killing the fixture, spawning a FRESH
 *   instance (new ASLR/allocator layout) and loading + re-resolving proves
 *   restart-stability through the real save/load path, not just in-memory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';

import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.ts';
import { resetForTesting } from '../../src/core/database/index.ts';

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
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {
    /* fixture already gone */
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

async function attachSession(handle: FixtureHandle) {
  const { LiveMemorySession } = await import('../../src/core/live-memory/live-memory-session.ts');
  const session = new LiveMemorySession(nativeMemoryDriver);
  let attachResult: Awaited<ReturnType<typeof session.attach>> | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    attachResult = await session.attach({ pid: handle.child.pid!, executableName: 'solith-scanner-fixture.exe' }, true);
    if (attachResult.success) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(attachResult!.success, true, `session attach must succeed: ${JSON.stringify(attachResult)}`);
  return session;
}

function killFixture(handle: FixtureHandle): void {
  try {
    handle.child.stdin.write('exit\n');
  } catch {
    /* already gone */
  }
  handle.child.kill();
}

function targetAddresses(fields: Record<string, string>) {
  const node3 = BigInt(fields.POINTER_NODE3_BASE);
  const nodeB1 = BigInt(fields.POINTER_NODE_B1_BASE);
  const offset = BigInt(Number(fields.POINTER_TARGET_OFFSET));
  return { targetA: node3 + offset, targetB: nodeB1 + offset };
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

/**
 * Same reasoning and same values as pointer-scanner-real-process.test.ts's
 * depth-3 discovery case: a real process has megabytes of incidental
 * pointer-shaped bytes, so the default maxCandidatesPerLevel (3) and
 * maxResults (20) can crowd the real module-rooted path out of the kept
 * set before it's ever found. maxTotalScans is bumped past the default 25
 * for the same documented reason — close enough to what a depth-3 chain
 * needs (~7 scans) that allocator layout alone can flake it.
 */
const BOUNDS = {
  maxOffsetPerLevel: 64,
  maxRegionBytes: 1 * 1024 * 1024,
  maxBytesPerScan: 64 * 1024 * 1024,
  maxDepth: 3,
  maxCandidatesPerLevel: 16,
  maxResults: 64,
  maxTotalScans: 500,
};

describeReal('P2-2 real process — scanTargetsIntoMap populates both independent targets correctly', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { targetA, targetB } = targetAddresses(handle.fields);

    const map = session.pointerMapCreate('Real Two-Target Map');
    const result = session.pointerMapScanTargets(map.id, [targetA, targetB], BOUNDS);

    assert.equal(result.targetsScanned, 2);
    const outcomeA = result.perTarget.find((t) => t.targetAddress === `0x${targetA.toString(16)}`)!;
    const outcomeB = result.perTarget.find((t) => t.targetAddress === `0x${targetB.toString(16)}`)!;
    assert.ok(outcomeA, 'target A outcome must be present');
    assert.ok(outcomeB, 'target B outcome must be present');
    assert.ok(outcomeA.candidateCount > 0, 'target A (depth 3, module-rooted) must find at least one candidate');
    assert.ok(outcomeB.candidateCount > 0, 'target B (depth 1, module-rooted) must find at least one candidate');

    // A module-rooted candidate must actually exist for both, at the depth
    // the fixture's real layout implies — this is the D05 "did we actually
    // reach the module root" check, applied per-target this time.
    assert.ok(result.map.nodes.some((n) => n.targetAddress === `0x${targetA.toString(16)}` && n.depth === 3));
    assert.ok(result.map.nodes.some((n) => n.targetAddress === `0x${targetB.toString(16)}` && n.depth === 1));

    // Grouping must not blur: no node may be attributed to the wrong target.
    for (const node of result.map.nodes) {
      assert.ok(node.targetAddress === `0x${targetA.toString(16)}` || node.targetAddress === `0x${targetB.toString(16)}`);
    }

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('P2-2 real process — resolve matches real ground-truth addresses for both targets', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { targetA, targetB } = targetAddresses(handle.fields);

    const map = session.pointerMapCreate('Real Resolve Map');
    session.pointerMapScanTargets(map.id, [targetA, targetB], BOUNDS);
    const resolved = session.pointerMapResolve(map.id);

    assert.equal(resolved.failedCount, 0);
    const nodeA = resolved.map.nodes.find((n) => n.targetAddress === `0x${targetA.toString(16)}`)!;
    const nodeB = resolved.map.nodes.find((n) => n.targetAddress === `0x${targetB.toString(16)}`)!;
    assert.equal(nodeA.status, 'resolved');
    assert.equal(nodeB.status, 'resolved');
    // The module + offset chain must resolve back to the exact real address
    // the fixture reported as this target — not merely "some address".
    assert.equal(nodeA.lastResolvedAddress, `0x${targetA.toString(16)}`);
    assert.equal(nodeB.lastResolvedAddress, `0x${targetB.toString(16)}`);

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('P2-2 real process — save, kill, respawn, load, re-resolve proves restart stability through the real persistence path', async () => {
  await resetForTesting();
  const handleGen1 = await spawnFixture();
  let mapId = '';
  try {
    const session1 = await attachSession(handleGen1);
    const gen1 = targetAddresses(handleGen1.fields);

    const map = session1.pointerMapCreate('Restart Stability Map');
    mapId = map.id;
    session1.pointerMapScanTargets(map.id, [gen1.targetA, gen1.targetB], BOUNDS);
    const resolvedGen1 = session1.pointerMapResolve(map.id);
    assert.equal(resolvedGen1.failedCount, 0);

    const saveResult = session1.pointerMapSave(map.id, { executableIdentity: 'solith-scanner-fixture.exe' });
    assert.deepEqual(saveResult, { ok: true });

    session1.destroy?.();
  } finally {
    killFixture(handleGen1);
  }

  // A fresh process instance — VirtualAlloc gives it a different heap
  // layout than generation 1, so if the saved module+offset chain resolves
  // to the SAME concrete addresses as generation 1, the test itself is
  // broken (proving nothing); it must resolve to DIFFERENT, but still
  // internally consistent, addresses.
  const handleGen2 = await spawnFixture();
  try {
    const session2 = await attachSession(handleGen2);
    const gen2 = targetAddresses(handleGen2.fields);

    const loaded = session2.pointerMapLoad(mapId);
    assert.ok(loaded.nodes.every((n) => n.status === 'unresolved'), 'a freshly loaded map must not trust the old resolved addresses');

    const reResolved = session2.pointerMapResolve(mapId);
    assert.equal(reResolved.failedCount, 0);
    const nodeA = reResolved.map.nodes.find((n) => n.targetAddress?.startsWith('0x') && n.depth === 3)!;
    const nodeB = reResolved.map.nodes.find((n) => n.depth === 1)!;
    assert.equal(nodeA.lastResolvedAddress, `0x${gen2.targetA.toString(16)}`);
    assert.equal(nodeB.lastResolvedAddress, `0x${gen2.targetB.toString(16)}`);
    assert.notEqual(gen2.targetA.toString(16), targetAddresses(handleGen1.fields).targetA.toString(16));

    session2.destroy?.();
  } finally {
    killFixture(handleGen2);
    await resetForTesting();
  }
});
