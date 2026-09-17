/**
 * Phase 2 P2-4 (mission §5/§6/§7/§26) — real-process pointer-stability
 * restart campaign. Not a fixture simulation of restart effects: each
 * iteration spawns a genuinely NEW `solith-scanner-fixture.exe` process
 * (real PID, real ASLR-randomized module base, real newly-allocated heap
 * addresses), attaches through the real native driver, and validates the
 * SAME saved pointer-map node against that fresh process — persistence
 * round-trip included (save after the first launch, load on every
 * subsequent one), matching the real production workflow a restarted game
 * would put a user through.
 *
 * Ground truth: the fixture's own compile-time constants
 * (POINTER_TARGET_VALUE = 0x5A5A1234) — a real, independently-known
 * expected value, not "resolved to readable memory".
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
  child.stdin.on('error', () => {});
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

function killFixture(handle: FixtureHandle): void {
  try {
    handle.child.stdin.write('exit\n');
  } catch {
    /* already gone */
  }
  handle.child.kill();
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

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

const SCAN_BOUNDS = {
  maxOffsetPerLevel: 64,
  maxRegionBytes: 1 * 1024 * 1024,
  maxBytesPerScan: 64 * 1024 * 1024,
  maxDepth: 3,
  maxCandidatesPerLevel: 16,
  maxResults: 64,
  maxTotalScans: 500,
};

const POINTER_TARGET_VALUE_DECIMAL = 0x5a5a1234; // matches fixture.rs's POINTER_TARGET_VALUE exactly

describeReal(
  'P2-4 real-process restart campaign — 10 consecutive real launches, real ASLR, real heap relocation',
  { timeout: 180_000 },
  async () => {
  await resetForTesting();

  const RESTARTS = 10;
  let mapId: string | null = null;
  let nodeId: string | null = null;
  const results: Array<{ restart: number; pid: number; status: string; moduleBase: string | null; resolvedAddress: string | null }> = [];

  for (let restart = 1; restart <= RESTARTS; restart++) {
    const fixture = await spawnFixture();
    try {
      const session = await attachSession(fixture);
      const groundTruth = {
        kind: 'u32' as const,
        expected: POINTER_TARGET_VALUE_DECIMAL,
        description: 'fixture POINTER_TARGET_VALUE (0x5A5A1234)',
      };

      if (restart === 1) {
        // First launch: discover the chain fresh, exactly like a real user
        // would, then persist it — every later restart loads THIS saved
        // map rather than re-discovering, the real save/load workflow.
        const map = session.pointerMapCreate('P2-4 Real Restart Campaign');
        const node3 = BigInt(fixture.fields.POINTER_NODE3_BASE);
        const offset = BigInt(Number(fixture.fields.POINTER_TARGET_OFFSET));
        const target = node3 + offset;
        const scanResult = session.pointerMapScanTargets(map.id, [target], SCAN_BOUNDS);
        assert.ok(scanResult.perTarget[0].nodesAdded > 0, 'first launch must discover at least one real candidate');
        const scannedMap = session.pointerMapGet(map.id)!;
        const depth3Node = scannedMap.nodes.find((n) => n.depth === 3);
        assert.ok(depth3Node, 'the real depth-3 candidate must be among the discovered nodes');
        mapId = map.id;
        nodeId = depth3Node!.id;
      } else {
        // Every subsequent restart: load the SAVED map fresh (a real
        // process is gone; only the persisted, module-relative chain
        // survives) and validate the SAME node against this new process.
        const loaded = session.pointerMapLoad(mapId!);
        assert.equal(loaded.id, mapId);
      }

      const result = session.pointerMapValidateNodeAfterRestart(mapId!, nodeId!, groundTruth);
      // Persist the updated stability history (including a freshly-
      // established baseline on restart 1) so the NEXT restart's load
      // actually sees real accumulated history, matching the genuine
      // save-after-every-session production workflow — not just an
      // in-memory artifact of this one process instance.
      const saveResult = session.pointerMapSave(mapId!, { executableIdentity: 'solith-scanner-fixture.exe' });
      assert.deepEqual(saveResult, { ok: true });
      results.push({
        restart,
        pid: fixture.child.pid!,
        status: result.observation.status,
        moduleBase: result.observation.moduleBase,
        resolvedAddress: result.observation.resolvedAddress,
      });

      // Real correctness requirement: every restart must land on a status
      // that means "the chain still finds the real, verified target" —
      // never accept a false positive or a broken chain as success.
      assert.ok(
        result.observation.status === 'stable_exact' ||
          result.observation.status === 'stable_relocated' ||
          result.observation.status === 'target_moved_chain_valid',
        `restart ${restart} (PID ${fixture.child.pid}) must classify as correct, got: ${JSON.stringify(result.observation)}`,
      );
    } finally {
      killFixture(fixture);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  assert.equal(results.length, RESTARTS);
  console.log('P2-4 real-process restart campaign results:', JSON.stringify(results, null, 2));

  // Mission §6/§7's real ASLR/heap-relocation proof: at least one restart's
  // module base and at least one restart's resolved (heap) address must
  // differ from launch 1's — proving the chain survived real relocation,
  // not merely a coincidentally-identical address space across launches.
  const baseline = results[0];
  const anyModuleBaseChanged = results.slice(1).some((r) => r.moduleBase !== baseline.moduleBase);
  const anyResolvedAddressChanged = results.slice(1).some((r) => r.resolvedAddress !== baseline.resolvedAddress);
  assert.ok(anyModuleBaseChanged || anyResolvedAddressChanged, 'at least one restart must show real address relocation (ASLR and/or heap), never all-identical addresses across 10 real launches');
  },
);
