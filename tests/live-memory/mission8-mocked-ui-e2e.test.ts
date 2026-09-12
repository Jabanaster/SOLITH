import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { authorizeTrainerDeckRead, type TrainerDeckGameDetailLike } from '../../src/core/live-memory/trainer-deck-read.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';
import type { CtZipCatalogEntry } from '../../src/core/registry/compile-ct-zip.js';
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

function pointerCheat(id: string, name: string, dataType: 'byte' | 'int32', moduleName: string, baseOffset: string, pointerChain: number[]): CtZipCatalogEntry['cheats'][number] {
  return {
    id,
    name,
    kind: 'pointer',
    executable: false,
    certificationLevel: 'L0',
    metadata: {
      dataType,
      moduleName,
      rawAddress: `"${moduleName}"+${baseOffset.replace(/^0x/i, '')}`,
      baseOffset,
      pointerChain,
      liveResolution: 'resolvable',
      showAsHex: false,
    },
  };
}

function gameDetailFor(displayName: string, tableName: string, archivePath: string, sourceSha256: string, cheat: CtZipCatalogEntry['cheats'][number]): TrainerDeckGameDetailLike {
  return {
    available: true,
    game: { displayName },
    tables: [{ tableName, archivePath, sourceSha256, cheats: [cheat] }],
  };
}

/** Seeds a pointer chain matching resolvePointerPath's exact traversal (one dereference per offset). */
function seedChain(driver: FakeMemoryDriver, moduleBase: bigint, baseOffset: bigint, offsets: number[], finalValue: number): bigint {
  let address = moduleBase + baseOffset;
  for (let i = 0; i < offsets.length; i++) {
    const pointerValue = 0x200000000n + BigInt(i) * 0x10000n;
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(pointerValue);
    driver.addRegion(address, buf);
    address = pointerValue + BigInt(offsets[i]);
  }
  driver.setValue(address, finalValue);
  return address;
}

describe('Mission 8 — mocked UI E2E: CT Library -> Trainer Deck -> preload -> IPC -> production read bridge -> value', () => {
  test('A. Half-Life 2 — Current HP: server.dll+0x00633AFC, chain [224], int32 -> synthetic 100', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('server.dll', 0x180000000n, 0x1000000);
    driver.setProcessExecutableName(7001, 'hl2.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 7001, executableName: 'hl2.exe' }, true);

    const cheat = pointerCheat('ptr-current-hp', 'Current HP', 'int32', 'server.dll', '0x00633AFC', [224]);
    const detail = gameDetailFor('Half-Life 2', '2 hl2', 'Games/Half-Life 2/2_hl2.CT', 'hl2sha', cheat);
    const finalAddress = seedChain(driver, 0x180000000n, 0x00633afcn, [224], 100);

    const result = authorizeTrainerDeckRead('half-life-2:hl2sha:ptr-current-hp', 'half-life-2', detail, session);
    assert.equal(result.status, 'value');
    if (result.status === 'value') {
      assert.equal(result.value, 100);
      assert.equal(result.address, `0x${finalAddress.toString(16)}`);
    }
  });

  test('B. Tactics Ogre Reborn — Gold: "Tactics Ogre Reborn.exe"+0xEEE5C0, chain [], int32 -> synthetic 123456', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Tactics Ogre Reborn.exe', 0x140000000n, 0x2000000);
    driver.setProcessExecutableName(7002, 'Tactics Ogre Reborn.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 7002, executableName: 'Tactics Ogre Reborn.exe' }, true);

    const cheat = pointerCheat('ptr-gold', 'Gold', 'int32', 'Tactics Ogre Reborn.exe', '0xEEE5C0', []);
    const detail = gameDetailFor('Tactics Ogre Reborn', '0 Tactics Ogre Reborn', 'Games/Tactics Ogre Reborn/0_Tactics Ogre Reborn.CT', 'togsha', cheat);

    // Zero-hop chain: the "final address" IS moduleBase + baseOffset directly,
    // no dereference at all (resolvePointerPath's loop runs zero iterations).
    const finalAddress = 0x140000000n + 0xeee5c0n;
    driver.setValue(finalAddress, 123456);

    const result = authorizeTrainerDeckRead('tactics-ogre-reborn:togsha:ptr-gold', 'tactics-ogre-reborn', detail, session);
    assert.equal(result.status, 'value');
    if (result.status === 'value') {
      assert.equal(result.value, 123456);
      assert.equal(result.address, `0x${finalAddress.toString(16)}`);
    }
  });

  test('C. Subnautica — survival: Subnautica.exe+0x0142B908, chain [112,40,424,992,384], byte -> synthetic 1', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x2000000);
    driver.setProcessExecutableName(7003, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 7003, executableName: 'Subnautica.exe' }, true);

    const cheat = pointerCheat('ptr-survival', 'survival', 'byte', 'Subnautica.exe', '0x0142B908', [112, 40, 424, 992, 384]);
    const detail = gameDetailFor('Subnautica', '0 Subnautica', 'Games/Subnautica/0_Subnautica.CT', 'subsha', cheat);
    const finalAddress = seedChain(driver, 0x140000000n, 0x0142b908n, [112, 40, 424, 992, 384], 1);

    const result = authorizeTrainerDeckRead('subnautica:subsha:ptr-survival', 'subnautica', detail, session);
    assert.equal(result.status, 'value');
    if (result.status === 'value') {
      assert.equal(result.value, 1);
      assert.equal(result.address, `0x${finalAddress.toString(16)}`);
    }
  });
});
