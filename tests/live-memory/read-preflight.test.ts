import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runReadPreflight,
  isCardStructurallyReadable,
  type ReadPreflightCardInput,
  type ReadPreflightExpectedTarget,
  type ReadPreflightSessionProbe,
} from '../../src/core/live-memory/read-preflight.js';

/**
 * Deterministic fake probe — NO real process, NO memoryjs, NO OS calls.
 * Every method is a plain function over in-memory state so behavior is
 * fully controllable per test (module missing, traversal failing halfway,
 * identity drifting, etc).
 */
function createFakeProbe(overrides: Partial<ReadPreflightSessionProbe> = {}) {
  const calls = {
    getProcessIdentity: 0,
    verifyIdentityStillMatches: 0,
    isModuleLoaded: 0,
    resolveModuleBase: 0,
    traversePointerChain: 0,
    readValue: 0,
    detach: 0,
  };
  const traversedOffsets: number[][] = [];

  const probe: ReadPreflightSessionProbe = {
    getProcessIdentity() {
      calls.getProcessIdentity += 1;
      return overrides.getProcessIdentity ? overrides.getProcessIdentity() : { pid: 4242, executableName: 'Subnautica.exe' };
    },
    verifyIdentityStillMatches(expected) {
      calls.verifyIdentityStillMatches += 1;
      return overrides.verifyIdentityStillMatches ? overrides.verifyIdentityStillMatches(expected) : true;
    },
    isModuleLoaded(moduleName) {
      calls.isModuleLoaded += 1;
      return overrides.isModuleLoaded ? overrides.isModuleLoaded(moduleName) : true;
    },
    resolveModuleBase(moduleName) {
      calls.resolveModuleBase += 1;
      return overrides.resolveModuleBase ? overrides.resolveModuleBase(moduleName) : 0x140000000n;
    },
    traversePointerChain(moduleBase, baseOffset, pointerChain) {
      calls.traversePointerChain += 1;
      traversedOffsets.push([...pointerChain]);
      if (overrides.traversePointerChain) return overrides.traversePointerChain(moduleBase, baseOffset, pointerChain);
      // Synthetic deterministic math — proves orchestration wiring (base + offset,
      // then every chain hop reaches the driver), NOT real pointer-dereference
      // arithmetic (that lives in native-memory-driver.ts / pointer-resolver.ts
      // and requires a live process to exercise meaningfully).
      const sumOffsets = pointerChain.reduce((sum, o) => sum + BigInt(o), 0n);
      return moduleBase + baseOffset + sumOffsets;
    },
    readValue(address, dataType) {
      calls.readValue += 1;
      return overrides.readValue ? overrides.readValue(address, dataType) : { ok: true, value: 7 };
    },
    detach() {
      calls.detach += 1;
      if (overrides.detach) overrides.detach();
    },
  };

  return { probe, calls, traversedOffsets };
}

const SUBNAUTICA_SURVIVAL_CARD: ReadPreflightCardInput = {
  moduleName: 'Subnautica.exe',
  baseOffset: '0x0142B908',
  pointerChain: [112, 40, 424, 992, 384],
  dataType: 'byte',
};

const SUBNAUTICA_TARGET: ReadPreflightExpectedTarget = { pid: 4242, executableName: 'Subnautica.exe' };

describe('Mission C — Subnautica synthetic harness (no real process)', () => {
  test('1-4: resolves mocked module base, applies offset, traverses all 5 pointer hops, reaches expected synthetic address', () => {
    const { probe, traversedOffsets } = createFakeProbe();
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);

    assert.equal(traversedOffsets.length, 1);
    assert.deepEqual(traversedOffsets[0], [112, 40, 424, 992, 384]);
    assert.equal(traversedOffsets[0].length, 5);

    const expectedModuleBase = 0x140000000n;
    const expectedBaseOffset = 0x0142b908n;
    const expectedSum = BigInt(112 + 40 + 424 + 992 + 384);
    const expectedFinal = expectedModuleBase + expectedBaseOffset + expectedSum;

    assert.equal(result.status, 'READY_FOR_READ');
    if (result.status === 'READY_FOR_READ') {
      assert.equal(result.address, `0x${expectedFinal.toString(16)}`);
    }
  });

  test('5-6: reads a byte and returns it through the same runtime-facing API (ReadPreflightResult)', () => {
    const { probe } = createFakeProbe({ readValue: () => ({ ok: true, value: 1 }) });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'READY_FOR_READ');
    if (result.status === 'READY_FOR_READ') {
      assert.equal(result.value, 1);
    }
  });

  test('7: detach/cleanup is always invoked exactly once', () => {
    const { probe, calls } = createFakeProbe();
    runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(calls.detach, 1);
  });

  test('detach is invoked exactly once even when preflight is BLOCKED early', () => {
    const { probe, calls } = createFakeProbe({ isModuleLoaded: () => false });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(calls.detach, 1);
  });

  test('this harness does NOT claim to prove the current real Subnautica build', () => {
    // Documentation-as-test: the synthetic math above is orchestration-only.
    // Real pointer dereferencing happens in native-memory-driver.ts and is
    // untestable without a live process — this harness proves wiring, not
    // game-build correctness.
    assert.ok(true);
  });
});

describe('Mission D — stale PID / session safety (fail-closed matrix)', () => {
  test('PID disappears before read (no session)', () => {
    const { probe, calls } = createFakeProbe({ getProcessIdentity: () => null });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'NO_SESSION');
    assert.equal(calls.readValue, 0, 'must never reach the read call');
    assert.equal(calls.detach, 1);
  });

  test('PID reused by a different executable', () => {
    const { probe, calls } = createFakeProbe({
      getProcessIdentity: () => ({ pid: 4242, executableName: 'totally-different.exe' }),
    });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'EXECUTABLE_MISMATCH');
    assert.equal(calls.readValue, 0);
  });

  test('PID mismatch against expected target', () => {
    const { probe } = createFakeProbe({ getProcessIdentity: () => ({ pid: 9999, executableName: 'Subnautica.exe' }) });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'IDENTITY_MISMATCH');
  });

  test('game exits during pointer traversal (module disappears mid-chain)', () => {
    const { probe, calls } = createFakeProbe({ traversePointerChain: () => null });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'FINAL_ADDRESS_UNRESOLVED');
    assert.equal(calls.readValue, 0);
  });

  test('module disappears (unloaded) before traversal', () => {
    const { probe, calls } = createFakeProbe({ isModuleLoaded: () => false });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'MODULE_NOT_LOADED');
    assert.equal(calls.resolveModuleBase, 0, 'must not attempt base resolution on an unloaded module');
  });

  test('module base fails to resolve', () => {
    const { probe } = createFakeProbe({ resolveModuleBase: () => null });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'MODULE_BASE_UNRESOLVED');
  });

  test('session/identity changes underneath us (drift detected)', () => {
    const { probe } = createFakeProbe({ verifyIdentityStillMatches: () => false });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'IDENTITY_MISMATCH');
  });

  test('canonical game changes (card module no longer matches target executable)', () => {
    const wrongGameCard: ReadPreflightCardInput = { ...SUBNAUTICA_SURVIVAL_CARD, moduleName: 'StardewValley.exe' };
    const { probe, calls } = createFakeProbe({ isModuleLoaded: (m) => m === 'Subnautica.exe' });
    const result = runReadPreflight(wrongGameCard, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'MODULE_NOT_LOADED');
    assert.equal(calls.resolveModuleBase, 0);
  });

  test('pointer dereference fails halfway through the chain', () => {
    const { probe } = createFakeProbe({ traversePointerChain: () => null });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'FINAL_ADDRESS_UNRESOLVED');
  });

  test('final read fails', () => {
    const { probe } = createFakeProbe({ readValue: () => ({ ok: false, reason: 'access violation' }) });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.code, 'READ_FAILED');
      assert.equal(result.reason, 'access violation');
    }
  });

  test('detach occurs twice — second call must not throw', () => {
    const { probe } = createFakeProbe();
    runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.doesNotThrow(() => probe.detach());
  });

  test('SOLITH "shuts down" mid-session — probe throws — becomes BLOCKED, never an uncaught exception', () => {
    const { probe, calls } = createFakeProbe({
      traversePointerChain: () => {
        throw new Error('session torn down mid-call');
      },
    });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.code, 'PROBE_ERROR');
      assert.match(result.reason, /torn down/);
    }
    assert.equal(calls.detach, 1, 'detach must still run even when a probe call throws');
  });

  test('detach is called even when getProcessIdentity throws immediately', () => {
    const { probe, calls } = createFakeProbe({
      getProcessIdentity: () => {
        throw new Error('driver unavailable');
      },
    });
    const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(calls.detach, 1);
  });

  test('no stale PID ever reaches a read call against the wrong process (invariant across the whole matrix)', () => {
    const scenarios: Array<Partial<ReadPreflightSessionProbe>> = [
      { getProcessIdentity: () => null },
      { getProcessIdentity: () => ({ pid: 1, executableName: 'other.exe' }) },
      { verifyIdentityStillMatches: () => false },
      { isModuleLoaded: () => false },
      { resolveModuleBase: () => null },
      { traversePointerChain: () => null },
    ];
    for (const overrides of scenarios) {
      const { probe, calls } = createFakeProbe(overrides);
      const result = runReadPreflight(SUBNAUTICA_SURVIVAL_CARD, SUBNAUTICA_TARGET, probe);
      assert.equal(result.status, 'BLOCKED');
      assert.equal(calls.readValue, 0);
    }
  });
});

describe('isCardStructurallyReadable — no-session structural gate', () => {
  test('accepts a well-formed resolvable card', () => {
    assert.equal(isCardStructurallyReadable(SUBNAUTICA_SURVIVAL_CARD), true);
  });
  test('rejects missing module', () => {
    assert.equal(isCardStructurallyReadable({ ...SUBNAUTICA_SURVIVAL_CARD, moduleName: 'unknown-module.exe' }), false);
  });
  test('rejects malformed base offset', () => {
    assert.equal(isCardStructurallyReadable({ ...SUBNAUTICA_SURVIVAL_CARD, baseOffset: 'nope' }), false);
  });
  test('rejects malformed pointer chain', () => {
    assert.equal(
      isCardStructurallyReadable({ ...SUBNAUTICA_SURVIVAL_CARD, pointerChain: [NaN] }),
      false,
    );
  });
});
