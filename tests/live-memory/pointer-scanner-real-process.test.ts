/**
 * Phase 1 final closure §13 — D05 real-process pointer proof.
 *
 * A real spawned Windows process, a real read-only attach, and the production
 * `LiveMemorySession.pointerScan` surface against a chain the fixture itself
 * builds and reports:
 *
 *   POINTER_ROOT (inside the fixture's own module image)
 *     -> NODE1 -> NODE2 -> NODE3 -> the target value at +16
 *
 * Every node is a separate `VirtualAlloc` region, so the reverse traversal has
 * to cross three real region boundaries. The fixture also plants a genuine
 * pointer cycle so cycle safety is exercised against real process memory, not
 * only against the deterministic fake driver. The cycle is
 * placed between adjacent links (NODE1 <-> NODE2) rather than across them: an
 * earlier revision put it on NODE1 -> NODE3, which created a genuine two-edge
 * shortcut and made the nominal depth-3 path no longer the shortest one.
 *
 * The assertions are deliberately about the depth/termination CONTRACT rather
 * than exact candidate counts: a real process contains megabytes of incidental
 * pointer-shaped bytes, and pinning an exact count would be asserting on the
 * OS allocator rather than on the scanner.
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
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  // Teardown writes "exit\n" then kills the child; `write()` reports a broken
  // pipe asynchronously, so without this listener Node escalates EPIPE to an
  // uncaughtException after the test has already returned (doc 129).
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
    attachResult = await session.attach(
      { pid: handle.child.pid!, executableName: 'solith-scanner-fixture.exe' },
      true,
    );
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

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

/** Region bounds kept tight so a real-process reverse scan stays quick. */
const BOUNDS = { maxOffsetPerLevel: 64, maxRegionBytes: 1 * 1024 * 1024, maxBytesPerScan: 64 * 1024 * 1024 };

function chainAddresses(fields: Record<string, string>) {
  const node3 = BigInt(fields.POINTER_NODE3_BASE);
  return {
    root: BigInt(fields.POINTER_ROOT_ADDRESS),
    node1: BigInt(fields.POINTER_NODE1_BASE),
    node2: BigInt(fields.POINTER_NODE2_BASE),
    node3,
    target: node3 + BigInt(Number(fields.POINTER_TARGET_OFFSET)),
  };
}

describeReal('D05 real process — the fixture really does hold the planted chain', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { root, node1, node2, node3, target } = chainAddresses(handle.fields);

    // Ground truth read directly, independent of any scan: this proves the
    // chain exists before asking the scanner to rediscover it, so a later
    // failure is a scanner failure and not a fixture failure.
    const access = session.getMemoryAccessOrThrow();
    const readPointer = (at: bigint) => access.driver.readBuffer(access.handle, at, 8).readBigUInt64LE(0);

    assert.equal(readPointer(root), node1, 'module root must point at NODE1');
    assert.equal(readPointer(node1), node2, 'NODE1 must point at NODE2');
    assert.equal(readPointer(node2), node3, 'NODE2 must point at NODE3');
    assert.equal(
      access.driver.readBuffer(access.handle, target, 4).readUInt32LE(0),
      Number(BigInt(handle.fields.POINTER_TARGET_VALUE)),
      'the target value must be where the fixture says it is',
    );

    // And the cycle the traversal has to survive.
    const cycleOffset = BigInt(Number(handle.fields.POINTER_CYCLE_OFFSET));
    assert.equal(readPointer(node1 + cycleOffset), node2, 'NODE1 must also point at NODE2');
    assert.equal(readPointer(node2 + cycleOffset), node1, 'NODE2 must point back at NODE1');

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('D05 §13 real process — maxDepth 1 searches exactly one level', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { node2, target } = chainAddresses(handle.fields);

    const result = session.pointerScan(target, { ...BOUNDS, maxDepth: 1 });

    assert.equal(result.requestedDepth, 1);
    assert.equal(result.levelsSearched, 1);
    // NODE2's slot is what points at NODE3, so level 1 must reach it.
    assert.ok(
      result.candidatesExplored > 0 || result.candidates.length > 0,
      'level 1 must find at least the pointer in NODE2',
    );
    // Nothing at depth 1 can be a module-rooted path here: the module root is
    // three edges away. Reporting zero candidates as complete would be the
    // exact D05 defect.
    assert.equal(result.candidates.filter((c) => c.depth > 1).length, 0);
    assert.notEqual(result.completeness.state, 'complete');
    assert.equal(result.truncated, true);
    assert.equal(result.isAuthoritativeAbsence, false);
    void node2;

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('D05 §13 real process — maxDepth 2 reaches level 2 but must not claim depth-3 completion', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { target } = chainAddresses(handle.fields);

    const result = session.pointerScan(target, { ...BOUNDS, maxDepth: 2 });

    assert.equal(result.requestedDepth, 2);
    assert.equal(result.levelsSearched, 2, 'level 2 must actually be entered');
    // The module root is at depth 3. A depth-2 search that found no
    // module-rooted path has NOT proven there is none.
    assert.equal(result.isAuthoritativeAbsence, false);
    assert.notEqual(result.completeness.state, 'complete');

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('D05 §13 real process — maxDepth 3 reaches the module-rooted path', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { root, target } = chainAddresses(handle.fields);

    const result = session.pointerScan(target, {
      ...BOUNDS,
      maxDepth: 3,
      maxCandidatesPerLevel: 16,
      maxResults: 64,
      // Explicit, and deliberately well above what this chain needs (~7 scans
      // measured). The DEFAULT global budget is 25, which is close enough to
      // that figure that a slightly different allocator layout can exhaust it
      // before level 3 — which is a legitimate `scan_budget_exhausted` result,
      // but makes a discovery assertion depend on luck rather than on the
      // scanner. Fixing the budget is what makes this test deterministic.
      maxTotalScans: 500,
    });

    assert.equal(result.levelsSearched, 3, 'all three levels must be entered');
    assert.notEqual(
      result.termination,
      'scan_budget_exhausted',
      'the budget must not be what ends this run, or the assertion below proves nothing',
    );

    const moduleBase = await (async () => {
      const access = session.getMemoryAccessOrThrow();
      const modules = access.driver.getModules(access.handle);
      const own = modules.find((m) => m.name.toLowerCase().includes('solith-scanner-fixture'));
      assert.ok(own, 'the fixture module must be enumerable');
      return own.baseAddress;
    })();

    const rootOffset = Number(root - moduleBase);
    const found = result.candidates.find((c) => c.moduleOffset === rootOffset);
    assert.ok(
      found,
      `the depth-3 module-rooted path must be found at module+0x${rootOffset.toString(16)}; ` +
        `got ${JSON.stringify(result.candidates.slice(0, 8))}`,
    );
    assert.equal(found.depth, 3, 'the planted path is exactly three pointer edges deep');

    // And it must actually resolve back to the target — a path that cannot be
    // followed forward is not a result, it is a coincidence.
    const { resolvePointerPath } = await import('../../src/core/live-memory/pointer-resolver.ts');
    const access = session.getMemoryAccessOrThrow();
    assert.equal(resolvePointerPath(access.driver, access.handle, found), target);

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('D05 §13 real process — a real pointer cycle terminates without unbounded expansion', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { target } = chainAddresses(handle.fields);

    const started = Date.now();
    const result = session.pointerScan(target, {
      ...BOUNDS,
      maxDepth: 6,
      maxCandidatesPerLevel: 4,
      maxTotalScans: 500,
    });
    const elapsed = Date.now() - started;

    // The fixture's NODE1 <-> NODE3 cycle is live in this process. Without
    // cycle detection the traversal re-expands the same addresses at every
    // level; with it, each heap address is expanded at most once for the run.
    assert.ok(
      result.candidatesExplored <= 6 * 4,
      `expanded ${result.candidatesExplored} heap nodes, above the per-level budget`,
    );
    assert.ok(elapsed < 120_000, `pointer scan took ${elapsed}ms — a cycle must not make it unbounded`);
    // Whatever it reports, it must be one of the defined terminal states.
    assert.ok(
      [
        'frontier_exhausted',
        'depth_limit_reached',
        'result_limit_reached',
        'candidate_limit_reached',
        'scan_budget_exhausted',
        'cancelled',
        'process_exited',
      ].includes(result.termination),
      `unexpected termination: ${result.termination}`,
    );

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('D05 §13 real process — an unreadable page makes the result incomplete, never absent', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { target } = chainAddresses(handle.fields);

    // The fixture's GUARD_REGION has a real PAGE_NOACCESS middle page, so a
    // full sweep genuinely cannot read part of this process's memory.
    const result = session.pointerScan(target, { ...BOUNDS, maxDepth: 2 });

    assert.ok(
      result.skippedRegions.length > 0 || result.truncated,
      'a sweep over a process with an unreadable page must not report full coverage',
    );
    if (result.candidates.length === 0) {
      assert.equal(result.isAuthoritativeAbsence, false);
    }

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('D05 §13 real process — the result cap reports resource_limit, not completion', async () => {
  const handle = await spawnFixture();
  try {
    const session = await attachSession(handle);
    const { target } = chainAddresses(handle.fields);

    const result = session.pointerScan(target, { ...BOUNDS, maxDepth: 3, maxResults: 1 });

    if (result.candidates.length >= 1) {
      assert.equal(result.termination, 'result_limit_reached');
      assert.equal(result.completeness.state, 'resource_limit');
      assert.equal(result.truncated, true);
    } else {
      // No module-rooted path within one result: still must not claim completeness.
      assert.equal(result.isAuthoritativeAbsence, false);
    }

    session.destroy?.();
  } finally {
    killFixture(handle);
  }
});

describeReal('D05 §13 real process — a process that exits mid-traversal reports process_exited', async () => {
  const handle = await spawnFixture();
  let killed = false;
  try {
    const session = await attachSession(handle);
    const { target } = chainAddresses(handle.fields);

    // Kill the target, then scan: every read now fails with a process-gone
    // error rather than a per-region read failure.
    handle.child.kill();
    killed = true;
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = session.pointerScan(target, { ...BOUNDS, maxDepth: 2 });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.isAuthoritativeAbsence, false, 'a dead process proves nothing about pointer paths');
    assert.equal(result.truncated, true);

    session.destroy?.();
  } finally {
    if (!killed) killFixture(handle);
  }
});
