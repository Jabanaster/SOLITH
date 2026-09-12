import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { createLiveMemorySessionProbe } from '../../src/core/live-memory/read-preflight-production-adapter.js';
import { readTrainerDeckCard } from '../../src/core/live-memory/trainer-deck-read.js';
import { runReadPreflight } from '../../src/core/live-memory/read-preflight.js';
import { promoteCandidateFromCtEntry, buildLiveToggleCards } from '../../src/core/live-memory/ct-promote.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';
import type { CtImportEntry } from '../../src/core/definitions/ct-import.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';

beforeEach(() => {
  _clearActiveFreezesForTests();
});

const CLEAN_EVIDENCE: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 0,
  observedAt: '2026-09-10T00:00:00.000Z',
};

function makeSession(driver: FakeMemoryDriver): LiveMemorySession {
  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => CLEAN_EVIDENCE);
  return session;
}

/**
 * Seeds a real pointer chain into the fake driver so resolvePointerPath's
 * PRODUCTION traversal loop (moduleBase -> +baseOffset -> N real
 * dereferences via readPointer) walks through genuine fake-region memory,
 * not a shortcut. Returns the exact final address the chain resolves to.
 */
function seedRealisticPointerChain(
  driver: FakeMemoryDriver,
  moduleBase: bigint,
  baseOffset: bigint,
  offsets: number[],
  finalValue: number,
): bigint {
  // Mirrors resolvePointerPath's own loop exactly (pointer-resolver.ts):
  // one dereference PER offset, address = readPointer(address) + offset,
  // for every offset including the last (whose result IS the value address,
  // never dereferenced again).
  let address = moduleBase + baseOffset;
  for (let i = 0; i < offsets.length; i++) {
    const pointerValue = 0x200000000n + BigInt(i) * 0x10000n; // arbitrary distinct fake pointer value
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(pointerValue);
    driver.addRegion(address, buf);
    address = pointerValue + BigInt(offsets[i]);
  }
  // `address` now equals the exact final address resolvePointerPath will produce.
  driver.setValue(address, finalValue);
  return address;
}

function candidateFromRealCorpusEntry(entry: {
  id: string;
  name: string;
  dataType: CtImportEntry['dataType'];
  moduleName: string;
  baseOffset: string;
  pointerChain: number[];
}) {
  const importEntry: CtImportEntry = {
    id: entry.id,
    name: entry.name,
    category: 'CT Library',
    dataType: entry.dataType,
    moduleName: entry.moduleName,
    rawAddress: `"${entry.moduleName}"+${entry.baseOffset.replace(/^0x/i, '')}`,
    baseOffset: entry.baseOffset,
    pointerChain: entry.pointerChain,
    showAsHex: false,
    liveResolution: 'resolvable',
  };
  const promoted = promoteCandidateFromCtEntry(importEntry);
  const [card] = buildLiveToggleCards([promoted]);
  return card;
}

describe('Mission 4 — mocked E2E through PRODUCTION code (only the OS/native boundary mocked)', () => {
  test('Subnautica survival (real corpus record): resolves through LiveMemorySession + resolvePointerPath and reads a byte', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x2000000);
    driver.setProcessExecutableName(5001, 'Subnautica.exe');
    const session = makeSession(driver);
    const attachResult = await session.attach({ pid: 5001, executableName: 'Subnautica.exe' }, true);
    assert.equal(attachResult.success, true, JSON.stringify(attachResult));

    const card = candidateFromRealCorpusEntry({
      id: 'ptr-survival',
      name: 'survival',
      dataType: 'byte',
      moduleName: 'Subnautica.exe',
      baseOffset: '0x0142B908',
      pointerChain: [112, 40, 424, 992, 384],
    });
    assert.equal(card.freezeEligible, true);

    const finalAddress = seedRealisticPointerChain(driver, 0x140000000n, 0x0142b908n, card.pointerChain, 1);

    const state = readTrainerDeckCard(card, session);
    assert.equal(state.status, 'value');
    if (state.status === 'value') {
      assert.equal(state.value, 1);
      assert.equal(state.address, `0x${finalAddress.toString(16)}`);
    }
  });

  test('Half-Life 2 Current HP (real corpus record): 1-hop chain resolves and reads an int32', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('server.dll', 0x180000000n, 0x1000000);
    driver.setProcessExecutableName(5002, 'hl2.exe');
    const session = makeSession(driver);
    const attachResult = await session.attach({ pid: 5002, executableName: 'hl2.exe' }, true);
    assert.equal(attachResult.success, true);

    const card = candidateFromRealCorpusEntry({
      id: 'ptr-current-hp',
      name: 'Current HP',
      dataType: 'int32',
      moduleName: 'server.dll',
      baseOffset: '0x00633AFC',
      pointerChain: [224],
    });

    const finalAddress = seedRealisticPointerChain(driver, 0x180000000n, 0x00633afcn, card.pointerChain, 100);

    const state = readTrainerDeckCard(card, session);
    assert.equal(state.status, 'value');
    if (state.status === 'value') {
      assert.equal(state.value, 100);
      assert.equal(state.address, `0x${finalAddress.toString(16)}`);
    }
  });

  test('no session attached -> not_attached (never attempts a read)', () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver);
    const card = candidateFromRealCorpusEntry({
      id: 'ptr-x', name: 'X', dataType: 'int32', moduleName: 'Game.exe', baseOffset: '0x1000', pointerChain: [],
    });
    const state = readTrainerDeckCard(card, session);
    assert.equal(state.status, 'not_attached');
  });

  test('wrong game session -> BLOCKED(MODULE_NOT_LOADED), card module absent from attached process', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('StardewValley.exe', 0x140000000n, 0x1000000); // wrong game's module
    driver.setProcessExecutableName(5003, 'StardewValley.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 5003, executableName: 'StardewValley.exe' }, true);

    const card = candidateFromRealCorpusEntry({
      id: 'ptr-survival', name: 'survival', dataType: 'byte', moduleName: 'Subnautica.exe',
      baseOffset: '0x0142B908', pointerChain: [112],
    });
    const state = readTrainerDeckCard(card, session);
    assert.equal(state.status, 'blocked');
    if (state.status === 'blocked') assert.equal(state.code, 'MODULE_NOT_LOADED');
  });

  test('stale PID reused by a different executable -> BLOCKED(IDENTITY_MISMATCH)', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(5004, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 5004, executableName: 'Subnautica.exe' }, true);

    // Simulate PID reuse: the OS now reports a different executable at the same PID.
    driver.setProcessExecutableName(5004, 'totally-different.exe');

    const card = candidateFromRealCorpusEntry({
      id: 'ptr-survival', name: 'survival', dataType: 'byte', moduleName: 'Subnautica.exe',
      baseOffset: '0x0142B908', pointerChain: [112],
    });
    const state = readTrainerDeckCard(card, session);
    assert.equal(state.status, 'blocked');
    if (state.status === 'blocked') assert.equal(state.code, 'IDENTITY_MISMATCH');
  });

  test('pointer resolution failure (dereference hits an unmapped fake region) -> BLOCKED(FINAL_ADDRESS_UNRESOLVED)', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(5005, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 5005, executableName: 'Subnautica.exe' }, true);
    // Deliberately do NOT seed any region — the very first dereference throws.

    const card = candidateFromRealCorpusEntry({
      id: 'ptr-survival', name: 'survival', dataType: 'byte', moduleName: 'Subnautica.exe',
      baseOffset: '0x0142B908', pointerChain: [112, 40],
    });
    const state = readTrainerDeckCard(card, session);
    assert.equal(state.status, 'blocked');
    if (state.status === 'blocked') assert.equal(state.code, 'FINAL_ADDRESS_UNRESOLVED');
  });

  test('unsupported data type -> BLOCKED(UNSUPPORTED_DATA_TYPE), never attempts module lookup', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Game.exe', 0x140000000n, 0x1000);
    driver.setProcessExecutableName(5006, 'Game.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 5006, executableName: 'Game.exe' }, true);

    const probe = createLiveMemorySessionProbe(session);
    const result = runReadPreflight(
      { moduleName: 'Game.exe', baseOffset: '0x1000', pointerChain: [], dataType: 'string' as never },
      { pid: 5006, executableName: 'Game.exe' },
      probe,
    );
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') assert.equal(result.code, 'UNSUPPORTED_DATA_TYPE');
  });

  test('cleanup: production probe detach() is a no-op and does not close the session', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(5007, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 5007, executableName: 'Subnautica.exe' }, true);

    const card = candidateFromRealCorpusEntry({
      id: 'ptr-survival', name: 'survival', dataType: 'byte', moduleName: 'Subnautica.exe',
      baseOffset: '0x0142B908', pointerChain: [112],
    });
    seedRealisticPointerChain(driver, 0x140000000n, 0x0142b908n, card.pointerChain, 1);

    readTrainerDeckCard(card, session); // success path
    assert.equal(session.isAttached(), true, 'reading a card must never detach the shared session');
    assert.equal(driver.closeCallCount, 0);

    // failure path too
    driver.setProcessExecutableName(5007, 'wrong.exe');
    readTrainerDeckCard(card, session);
    assert.equal(session.isAttached(), true, 'a BLOCKED read must also never detach the session');
    assert.equal(driver.closeCallCount, 0);
  });

  test('no write or freeze primitive is ever invoked by a read (writeMemory/writeBuffer call counts stay zero)', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(5008, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 5008, executableName: 'Subnautica.exe' }, true);

    const card = candidateFromRealCorpusEntry({
      id: 'ptr-survival', name: 'survival', dataType: 'byte', moduleName: 'Subnautica.exe',
      baseOffset: '0x0142B908', pointerChain: [112],
    });
    seedRealisticPointerChain(driver, 0x140000000n, 0x0142b908n, card.pointerChain, 1);

    const originalWriteMemory = driver.writeMemory.bind(driver);
    const originalWriteBuffer = driver.writeBuffer.bind(driver);
    let writeMemoryCalls = 0;
    let writeBufferCalls = 0;
    driver.writeMemory = (...args) => {
      writeMemoryCalls += 1;
      return originalWriteMemory(...args);
    };
    driver.writeBuffer = (...args) => {
      writeBufferCalls += 1;
      return originalWriteBuffer(...args);
    };

    readTrainerDeckCard(card, session);
    assert.equal(writeMemoryCalls, 0);
    assert.equal(writeBufferCalls, 0);
  });
});
