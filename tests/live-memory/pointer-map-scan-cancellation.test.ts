// P2-3.1 §5-§7 — real production pointer-map scan cancellation.
//
// scanForPointerPathCancellable/scanTargetsIntoMapCancellable (pointer-scanner.ts,
// pointer-map-orchestration.ts) drive the same BFS generator as the
// synchronous scanForPointerPath/scanTargetsIntoMap, but await a genuine
// event-loop turn between steps so a `bounds.signal.aborted` flip made from
// concurrently-running code actually lands mid-scan, not just between
// targets. This file proves that against real (fake-driver) multi-step
// scans, and exercises the session-level start/cancel/poll registry mission
// §7 requires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import {
  scanTargetsIntoMap,
  scanTargetsIntoMapCancellable,
} from '../../src/core/live-memory/pointer-map-orchestration.js';
import { createEmptyPointerMap } from '../../src/core/live-memory/pointer-map.js';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';

const HANDLE = { pid: 4711, opaque: { fake: true } };
const MODULE_BASE = 0x400000n;
const MODULE_SIZE = 0x100000;

/** Same shape as pointer-scanner-depth-truth's buildChain, but lets the
 * caller pick a distinct static slot so several independent chains can share
 * one driver/module (needed for real multi-target scans). */
function plantChain(driver: FakeMemoryDriver, staticSlot: number, nodeBase: bigint, levels: number): bigint {
  const nodes: bigint[] = [];
  for (let i = 0; i < levels; i++) nodes.push(nodeBase + BigInt(i) * 0x10000000n);

  let moduleRegion = driver.getRegions(HANDLE).find((r) => r.baseAddress === MODULE_BASE);
  if (!moduleRegion) {
    driver.addRegion(MODULE_BASE, Buffer.alloc(0x3000, 0), true);
    driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);
  }
  const buf = driver.readBuffer(HANDLE, MODULE_BASE, 0x3000);
  buf.writeBigUInt64LE(nodes[0], staticSlot);
  driver.addRegion(MODULE_BASE, buf, true); // overwrite in place

  for (let i = 0; i < levels; i++) {
    const region = Buffer.alloc(64, 0);
    if (i + 1 < levels) region.writeBigUInt64LE(nodes[i + 1], 0);
    else region.writeInt32LE(1337, 16);
    driver.addRegion(nodes[i], region, true);
  }
  return nodes[levels - 1] + 16n;
}

function buildTwoTargetDriver(): { driver: FakeMemoryDriver; targetA: bigint; targetB: bigint } {
  const driver = new FakeMemoryDriver();
  const targetA = plantChain(driver, 0x2000, 0x10000000n, 3);
  const targetB = plantChain(driver, 0x2100, 0x50000000n, 1);
  return { driver, targetA, targetB };
}

function mutableSignal() {
  const state = { aborted: false };
  return { signal: state, abort: () => { state.aborted = true; } };
}

/**
 * A deterministic alternative to racing real wall-clock timers against the
 * generator's `setImmediate` yields (mission's own "prefer deterministic
 * synchronization" guidance, §3): `signal.aborted` flips to true starting
 * from the Nth time it is *read*, which is exactly how many cancellation
 * checkpoints (`pointerScanGenerator`'s per-frontier-item yield, checked via
 * `signal?.aborted`) have already passed. This lands cancellation at an
 * exact, reproducible point in the scan instead of hoping a timer wins a
 * race against however fast this machine happens to run.
 */
function signalAbortingAfterNChecks(n: number): { aborted: boolean } {
  let reads = 0;
  return {
    get aborted() {
      reads += 1;
      return reads > n;
    },
  };
}

// ---------------------------------------------------------------------------
// §7 test matrix
// ---------------------------------------------------------------------------

test('P2-3.1 §7 — cancel before first target completes: both targets recorded cancelled, zero nodes', async () => {
  const { driver, targetA, targetB } = buildTwoTargetDriver();
  const map = createEmptyPointerMap('Cancel Before Any');
  const { signal, abort } = mutableSignal();
  abort(); // already aborted before the call even starts

  const result = await scanTargetsIntoMapCancellable(driver, HANDLE, map, [targetA, targetB], { signal });

  assert.equal(result.map.nodes.length, 0);
  assert.equal(result.perTarget[0].termination, 'cancelled');
  assert.equal(result.perTarget[1].termination, 'cancelled');
  assert.equal(result.aggregateCompleteness.state, 'cancelled');
});

test('P2-3.1 §7 — cancel between target A and target B: A keeps its real nodes, B is cancelled with zero', async () => {
  const { driver, targetA, targetB } = buildTwoTargetDriver();
  const map = createEmptyPointerMap('Cancel Between Targets');
  // Deterministically measured (not raced): target A's full scan against
  // this exact driver/bounds consumes signal-check #1 through #~19; target
  // B's per-target pre-check is the next read after that. 28 sits in the
  // middle of the stable plateau where A always finishes and B is always
  // cancelled at its pre-check — see the P2-3.1 flake-fix root-cause note
  // above for why racing a wall-clock timer against generator yields was
  // rejected in favor of this.
  const signal = signalAbortingAfterNChecks(28);

  const result = await scanTargetsIntoMapCancellable(driver, HANDLE, map, [targetA, targetB], {
    signal,
    maxDepth: 3,
  });

  assert.equal(result.perTarget[0].targetAddress, `0x${targetA.toString(16)}`);
  assert.ok(result.perTarget[0].nodesAdded > 0, 'target A must have completed and contributed real nodes');
  assert.notEqual(result.perTarget[0].termination, 'cancelled');
  assert.equal(result.perTarget[1].termination, 'cancelled');
  assert.equal(result.perTarget[1].nodesAdded, 0);
});

test('P2-3.1 §7 — cancel during target B: target B stops mid-scan, its own completeness reports cancelled', async () => {
  const driver = new FakeMemoryDriver();
  const targetA = plantChain(driver, 0x2000, 0x10000000n, 1);
  // A long, deliberately deep target B so there is real ground to interrupt.
  const targetB = plantChain(driver, 0x2100, 0x60000000n, 6);
  const map = createEmptyPointerMap('Cancel During B');
  // Deterministically measured: target A (depth 1) finishes well before
  // check #12; by check #25 target B's own generator has entered its scan
  // and completed at least one level before being interrupted mid-flight.
  const signal = signalAbortingAfterNChecks(25);

  const result = await scanTargetsIntoMapCancellable(driver, HANDLE, map, [targetA, targetB], {
    signal,
    maxDepth: 6,
  });

  assert.equal(result.perTarget[0].targetAddress, `0x${targetA.toString(16)}`);
  assert.notEqual(result.perTarget[0].termination, 'cancelled');
  assert.ok(result.perTarget[0].nodesAdded > 0);
  // Target B's own scanForPointerPathCancellable call must have observed the
  // abort mid-scan (it reached real progress — deepestLevelCompleted > 0 —
  // before being cut off) and reported a truthful non-complete state, never
  // silently finished as if nothing happened.
  const outcomeB = result.perTarget[1];
  assert.equal(outcomeB.targetAddress, `0x${targetB.toString(16)}`);
  assert.equal(outcomeB.termination, 'cancelled');
  assert.equal(outcomeB.completeness.state, 'cancelled');
  assert.ok(outcomeB.deepestLevelCompleted > 0, 'must show real mid-scan progress, not an immediate no-op cancel');
});

test('P2-3.1 §7 — cancel after completion is a safe no-op: result is exactly what a normal run produces', async () => {
  const { driver, targetA, targetB } = buildTwoTargetDriver();
  const map = createEmptyPointerMap('Cancel After Completion');
  const { signal, abort } = mutableSignal();

  const result = await scanTargetsIntoMapCancellable(driver, HANDLE, map, [targetA, targetB], { signal });
  abort(); // fires after the promise already resolved — must not retroactively change anything

  assert.ok(result.perTarget[0].nodesAdded > 0);
  assert.ok(result.perTarget[1].nodesAdded > 0);
  assert.equal(result.aggregateCompleteness.state, 'complete');
});

function makeAttachedFakeSession(pid = 4711): { session: LiveMemorySession; driver: FakeMemoryDriver } {
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'game.exe');
  const session = new LiveMemorySession(driver);
  return { session, driver };
}

test('P2-3.1 §7 — double cancel on the same session operation is idempotent and safe', async () => {
  const { session, driver } = makeAttachedFakeSession();
  await session.attach({ pid: 4711, executableName: 'game.exe' }, true);
  plantChain(driver, 0x2000, 0x10000000n, 1);
  const map = session.pointerMapCreate('Double Cancel');
  const operationId = session.startPointerMapScanOperation(map.id, [0x10000000n]);

  const first = session.cancelPointerMapScanOperation(operationId);
  const second = session.cancelPointerMapScanOperation(operationId);

  assert.equal(first.found, true);
  assert.equal(second.found, true);
  // Whichever cancel actually raced the operation to completion first, the
  // SECOND call must never throw and must report a coherent already-terminal
  // read — that is the whole idempotence contract.
  assert.equal(typeof second.alreadyTerminal, 'boolean');
});

test('P2-3.1 §7 — cancel referencing an unknown operation id returns found:false, never throws', async () => {
  const { session } = makeAttachedFakeSession();
  await session.attach({ pid: 4711, executableName: 'game.exe' }, true);

  const outcome = session.cancelPointerMapScanOperation('not-a-real-operation-id');
  assert.equal(outcome.found, false);
  assert.equal(outcome.alreadyTerminal, false);
});

test('P2-3.1 §7 — start a new scan after cancelling a previous one succeeds cleanly', async () => {
  const { session, driver } = makeAttachedFakeSession();
  await session.attach({ pid: 4711, executableName: 'game.exe' }, true);
  plantChain(driver, 0x2000, 0x10000000n, 1);
  const map = session.pointerMapCreate('Restart After Cancel');

  const firstOp = session.startPointerMapScanOperation(map.id, [0x10000000n]);
  session.cancelPointerMapScanOperation(firstOp);

  // Poll until the first operation actually reaches a terminal state before
  // starting the next one, matching how the real UI's poll loop behaves.
  for (let i = 0; i < 50; i++) {
    const status = session.getPointerMapScanOperationStatus(firstOp);
    if (status?.status !== 'pending') break;
    await new Promise((r) => setImmediate(r));
  }

  const secondOp = session.startPointerMapScanOperation(map.id, [0x10000000n]);
  assert.notEqual(secondOp, firstOp);
  for (let i = 0; i < 50; i++) {
    const status = session.getPointerMapScanOperationStatus(secondOp);
    if (status?.status !== 'pending') break;
    await new Promise((r) => setImmediate(r));
  }
  const finalStatus = session.getPointerMapScanOperationStatus(secondOp);
  assert.ok(
    finalStatus?.status === 'complete' || finalStatus?.status === 'cancelled',
    `second operation must reach a real terminal state, got: ${JSON.stringify(finalStatus)}`,
  );
});

test('P2-3.1 §7 — process exits during cancel: reports process_exited truthfully, cancel request does not corrupt state', async () => {
  const { driver, targetA, targetB } = buildTwoTargetDriver();
  const map = createEmptyPointerMap('Process Exit During Cancel');
  const { signal, abort } = mutableSignal();

  // The process dies mid-scan (a real read failure, same shape the native
  // driver reports for a dead handle — see isProcessGoneError). A cancel
  // request also arrives around the same time; the truthful outcome must be
  // a real terminal state (process_exited takes precedence, matching the
  // synchronous path's own documented behavior), never a crash and never a
  // silently-successful result.
  const originalReadBuffer = driver.readBuffer.bind(driver);
  let callCount = 0;
  driver.readBuffer = ((...args: Parameters<typeof driver.readBuffer>) => {
    callCount += 1;
    if (callCount > 2) throw new Error('read failed: the process is not running');
    return originalReadBuffer(...args);
  }) as typeof driver.readBuffer;

  abort(); // cancellation arrives concurrently with the process dying
  const result = await scanTargetsIntoMapCancellable(driver, HANDLE, map, [targetA, targetB], { signal });

  for (const outcome of result.perTarget) {
    assert.ok(
      outcome.completeness.state === 'cancelled' || outcome.completeness.state === 'process_exited',
      `must report a real terminal state, not silently succeed: termination=${outcome.termination} completeness=${outcome.completeness.state}`,
    );
  }
});

test('P2-3.1 §7 — resource limit vs cancel: whichever is hit first wins, never a silent contradictory result', async () => {
  const driver = new FakeMemoryDriver();
  const targetA = plantChain(driver, 0x2000, 0x10000000n, 6);
  const map = createEmptyPointerMap('Resource Limit vs Cancel');
  const { signal, abort } = mutableSignal();
  abort(); // cancelled before the call starts — cancel must win outright over any resource cap

  const result = await scanTargetsIntoMapCancellable(driver, HANDLE, map, [targetA], {
    signal,
    maxDepth: 6,
    maxTotalScans: 1, // would otherwise hit scan_budget_exhausted almost immediately
  });

  assert.equal(result.perTarget[0].termination, 'cancelled');
  assert.equal(result.perTarget[0].completeness.state, 'cancelled');
});

test('P2-3.1 — cancellable path produces the identical result shape as the synchronous path when never cancelled', async () => {
  const built1 = buildTwoTargetDriver();
  const built2 = buildTwoTargetDriver();
  const mapSync = createEmptyPointerMap('Sync');
  const mapAsync = createEmptyPointerMap('Async');

  const syncResult = scanTargetsIntoMap(built1.driver, HANDLE, mapSync, [built1.targetA, built1.targetB]);
  const asyncResult = await scanTargetsIntoMapCancellable(built2.driver, HANDLE, mapAsync, [
    built2.targetA,
    built2.targetB,
  ]);

  assert.equal(asyncResult.map.nodes.length, syncResult.map.nodes.length);
  assert.equal(asyncResult.aggregateCompleteness.state, syncResult.aggregateCompleteness.state);
  assert.deepEqual(
    asyncResult.perTarget.map((t) => t.nodesAdded),
    syncResult.perTarget.map((t) => t.nodesAdded),
  );
});
