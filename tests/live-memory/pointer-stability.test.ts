// Phase 2 P2-4 — pointer stability classification.
//
// resolvePointerMap (P2-1) only proves a chain traverses without error; it
// never reads the destination value, so "resolved" and "correct" are not
// the same claim. validateNodeAfterRestart adds the missing ground-truth
// verification step and classifies the result into the mission's own
// mutually-exclusive vocabulary (mission §2), reusing resolvePointerPath
// rather than re-deriving pointer-chain semantics.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import {
  validateNodeAfterRestart,
  summarizeNodeStability,
  type StabilityGroundTruth,
  type StabilityBaseline,
  type StabilityObservation,
} from '../../src/core/live-memory/pointer-stability.js';
import type { LivePointerPath } from '../../src/core/live-memory/pointer-resolver.js';

const HANDLE = { pid: 4711, opaque: { fake: true } };
const MODULE_BASE = 0x400000n;
const MODULE_SIZE = 0x100000;
const STATIC_SLOT = 0x2000;

/** Plants module -> node -> value(+16), matching the shape existing pointer tests already use. */
function buildChain(sentinelValue: number, moduleBase = MODULE_BASE, nodeAddress = 0x10000000n) {
  const driver = new FakeMemoryDriver();
  const moduleRegion = Buffer.alloc(0x3000, 0);
  moduleRegion.writeBigUInt64LE(nodeAddress, STATIC_SLOT);
  driver.addRegion(moduleBase, moduleRegion, true);
  driver.addModule('game.exe', moduleBase, MODULE_SIZE);

  const nodeRegion = Buffer.alloc(64, 0);
  nodeRegion.writeUInt32LE(sentinelValue, 16);
  driver.addRegion(nodeAddress, nodeRegion, true);

  const path: LivePointerPath = { moduleName: 'game.exe', moduleOffset: STATIC_SLOT, offsets: [16] };
  return { driver, path };
}

const SENTINEL = 0x5a5a1234;
const GROUND_TRUTH: StabilityGroundTruth = {
  readSize: 4,
  verify: (bytes) => bytes.readUInt32LE(0) === SENTINEL,
  description: `sentinel 0x${SENTINEL.toString(16)}`,
};

describe('P2-4 pointer stability classification', () => {
  test('first observation with no baseline establishes stable_exact', () => {
    const { driver, path } = buildChain(SENTINEL);
    const obs = validateNodeAfterRestart(driver, HANDLE, path, null, GROUND_TRUTH, 1, 100);
    assert.equal(obs.status, 'stable_exact');
    assert.equal(obs.pid, 100);
    assert.equal(obs.launchNumber, 1);
    assert.notEqual(obs.resolvedAddress, null);
    assert.notEqual(obs.moduleBase, null);
  });

  test('identical module base and resolved address vs baseline -> stable_exact', () => {
    const { driver, path } = buildChain(SENTINEL);
    const baseline: StabilityBaseline = {
      pid: 100,
      moduleBase: `0x${MODULE_BASE.toString(16)}`,
      resolvedAddress: `0x${(0x10000000n + 16n).toString(16)}`,
      recordedAt: new Date().toISOString(),
    };
    const obs = validateNodeAfterRestart(driver, HANDLE, path, baseline, GROUND_TRUTH, 2, 100);
    assert.equal(obs.status, 'stable_exact');
  });

  test('module base changed, target correct -> stable_relocated (real ASLR case)', () => {
    const relocatedBase = 0x77770000n;
    const { driver, path } = buildChain(SENTINEL, relocatedBase);
    const baseline: StabilityBaseline = {
      pid: 100,
      moduleBase: `0x${MODULE_BASE.toString(16)}`, // the ORIGINAL launch's base — different from this run's
      resolvedAddress: `0x${(0x10000000n + 16n).toString(16)}`,
      recordedAt: new Date().toISOString(),
    };
    const obs = validateNodeAfterRestart(driver, HANDLE, path, baseline, GROUND_TRUTH, 2, 200);
    assert.equal(obs.status, 'stable_relocated');
    assert.equal(obs.moduleBase, `0x${relocatedBase.toString(16)}`);
  });

  test('module base unchanged, final address moved (heap relocation), target correct -> target_moved_chain_valid', () => {
    const relocatedNode = 0x99990000n;
    const { driver, path } = buildChain(SENTINEL, MODULE_BASE, relocatedNode);
    const baseline: StabilityBaseline = {
      pid: 100,
      moduleBase: `0x${MODULE_BASE.toString(16)}`,
      resolvedAddress: `0x${(0x10000000n + 16n).toString(16)}`, // the OLD heap address
      recordedAt: new Date().toISOString(),
    };
    const obs = validateNodeAfterRestart(driver, HANDLE, path, baseline, GROUND_TRUTH, 2, 200);
    assert.equal(obs.status, 'target_moved_chain_valid');
    assert.equal(obs.resolvedAddress, `0x${(relocatedNode + 16n).toString(16)}`);
  });

  test('resolved and readable but wrong value -> false_positive (readable != correct)', () => {
    const { driver, path } = buildChain(0xdeadbeef); // NOT the expected sentinel
    const obs = validateNodeAfterRestart(driver, HANDLE, path, null, GROUND_TRUTH, 1, 100);
    assert.equal(obs.status, 'false_positive');
    assert.match(obs.failureReason ?? '', /did not match ground truth/);
  });

  test('module missing -> module_missing, never silently treated as broken/stale', () => {
    const { driver } = buildChain(SENTINEL);
    const path: LivePointerPath = { moduleName: 'nonexistent.exe', moduleOffset: STATIC_SLOT, offsets: [16] };
    const obs = validateNodeAfterRestart(driver, HANDLE, path, null, GROUND_TRUTH, 1, 100);
    assert.equal(obs.status, 'module_missing');
    assert.equal(obs.resolvedAddress, null);
  });

  test('intermediate dereference fails -> chain_broken, distinct from a final read_failed', () => {
    // A genuine two-level chain: module -> node1 -> (garbage, no region) -> value.
    // resolvePointerPath's loop dereferences offsets[0] against node1 (a real
    // region) to get the NEXT address, then must dereference THAT for
    // offsets[1] — this is the intermediate step that fails here, distinct
    // from the single-offset case where the "final" address is never
    // actually read by resolvePointerPath itself (only by the ground-truth
    // check afterward, which produces read_failed instead — see the next test).
    const driver = new FakeMemoryDriver();
    const moduleRegion = Buffer.alloc(0x3000, 0);
    const node1 = 0x10000000n;
    moduleRegion.writeBigUInt64LE(node1, STATIC_SLOT);
    driver.addRegion(MODULE_BASE, moduleRegion, true);
    driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);
    driver.addRegion(node1, Buffer.alloc(64, 0), true);
    // resolvePointerPath's loop: iter1 reads the module's static slot (a
    // real region) to reach node1, landing at node1+0x9999 for the second
    // offset — an address well outside node1's 64-byte region, so iter2's
    // readPointer() throws inside resolvePointerPath's own loop, before any
    // ground-truth read is ever attempted. The resolvePointerPath contract
    // never dereferences the LAST computed address itself (see the next
    // test), so this needs a genuine second, out-of-bounds intermediate
    // step to actually exercise the loop's own failure path.
    const path: LivePointerPath = { moduleName: 'game.exe', moduleOffset: STATIC_SLOT, offsets: [0x9999, 16] };

    const obs = validateNodeAfterRestart(driver, HANDLE, path, null, GROUND_TRUTH, 1, 100);
    assert.equal(obs.status, 'chain_broken');
  });

  test('chain resolves but the final ground-truth read fails -> read_failed, distinct from chain_broken', () => {
    const driver = new FakeMemoryDriver();
    const moduleRegion = Buffer.alloc(0x3000, 0);
    const nodeAddress = 0x10000000n;
    moduleRegion.writeBigUInt64LE(nodeAddress, STATIC_SLOT);
    driver.addRegion(MODULE_BASE, moduleRegion, true);
    driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);
    // The node address itself resolves (readPointer succeeds against it via
    // the module region's planted value), but nothing is registered at
    // nodeAddress+16 for a readBuffer of the ground-truth bytes to find.
    const path: LivePointerPath = { moduleName: 'game.exe', moduleOffset: STATIC_SLOT, offsets: [16] };

    const obs = validateNodeAfterRestart(driver, HANDLE, path, null, GROUND_TRUTH, 1, 100);
    assert.equal(obs.status, 'read_failed');
  });

  test('process exited mid-validation -> process_exited, never silently stable', () => {
    const { driver, path } = buildChain(SENTINEL);
    driver.getModules = (() => {
      throw new Error('process exited');
    }) as typeof driver.getModules;
    const obs = validateNodeAfterRestart(driver, HANDLE, path, null, GROUND_TRUTH, 1, 100);
    assert.equal(obs.status, 'process_exited');
  });

  test('summarizeNodeStability: raw counts and rate, denominator never hidden', () => {
    const observations: StabilityObservation[] = [
      { launchNumber: 1, pid: 1, moduleBase: '0x1', resolvedAddress: '0x2', status: 'stable_exact', failureReason: null, observedAt: 'x' },
      { launchNumber: 2, pid: 1, moduleBase: '0x1', resolvedAddress: '0x3', status: 'stable_relocated', failureReason: null, observedAt: 'x' },
      { launchNumber: 3, pid: 1, moduleBase: '0x1', resolvedAddress: '0x4', status: 'target_moved_chain_valid', failureReason: null, observedAt: 'x' },
      { launchNumber: 4, pid: 1, moduleBase: null, resolvedAddress: null, status: 'chain_broken', failureReason: 'x', observedAt: 'x' },
      { launchNumber: 5, pid: 1, moduleBase: '0x1', resolvedAddress: '0x5', status: 'false_positive', failureReason: 'x', observedAt: 'x' },
    ];
    const summary = summarizeNodeStability(observations);
    assert.equal(summary.attempts, 5);
    assert.equal(summary.correct, 3);
    assert.equal(summary.broken, 1);
    assert.equal(summary.falsePositive, 1);
    assert.equal(summary.stabilityRate, 3 / 5);
  });

  test('summarizeNodeStability: zero attempts never divides by zero, denominator stays visible', () => {
    const summary = summarizeNodeStability([]);
    assert.equal(summary.attempts, 0);
    assert.equal(summary.stabilityRate, 0);
  });
});
