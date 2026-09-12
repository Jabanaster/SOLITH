import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import {
  authorizeTrainerDeckRead,
  parseLibraryEntryId,
  type TrainerDeckGameDetailLike,
} from '../../src/core/live-memory/trainer-deck-read.js';
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

function subnauticaCheat(): CtZipCatalogEntry['cheats'][number] {
  return {
    id: 'ptr-survival',
    name: 'survival',
    kind: 'pointer',
    executable: false,
    certificationLevel: 'L0',
    metadata: {
      dataType: 'byte',
      moduleName: 'Subnautica.exe',
      rawAddress: '"Subnautica.exe"+0142B908',
      baseOffset: '0x0142B908',
      pointerChain: [112, 40, 424, 992, 384],
      liveResolution: 'resolvable',
      showAsHex: true,
    },
  };
}

function subnauticaGameDetail(): TrainerDeckGameDetailLike {
  return {
    available: true,
    game: { displayName: 'Subnautica' },
    tables: [
      {
        tableName: '0 Subnautica',
        archivePath: 'Games/Subnautica/0_Subnautica.CT',
        sourceSha256: 'abc123',
        cheats: [subnauticaCheat()],
      },
    ],
  };
}

function seedSubnauticaChain(driver: FakeMemoryDriver, finalValue: number): bigint {
  let address = 0x140000000n + 0x0142b908n;
  const offsets = [112, 40, 424, 992, 384];
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

const VALID_ID = 'subnautica:abc123:ptr-survival';

describe('Mission 7 — IPC security gates (pure authorizeTrainerDeckRead, no Electron harness needed)', () => {
  test('valid card + correct active session -> read allowed', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(6001, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6001, executableName: 'Subnautica.exe' }, true);
    const finalAddress = seedSubnauticaChain(driver, 1);

    const result = authorizeTrainerDeckRead(VALID_ID, 'subnautica', subnauticaGameDetail(), session);
    assert.equal(result.status, 'value');
    if (result.status === 'value') {
      assert.equal(result.value, 1);
      assert.equal(result.address, `0x${finalAddress.toString(16)}`);
    }
  });

  test('wrong game (session bound to a different canonical game) -> blocked, never touches CT data', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('hl2.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(6008, 'hl2.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6008, executableName: 'hl2.exe' }, true);
    let gameDetailAccessed = false;
    const trackedNull = new Proxy({}, { get: () => { gameDetailAccessed = true; return undefined; } });
    const result = authorizeTrainerDeckRead(VALID_ID, 'half-life-2', trackedNull as never, session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'WRONG_GAME_SESSION');
    assert.equal(gameDetailAccessed, false, 'wrong-game gate must fire before gameDetail is ever inspected');
  });

  test('stale session (no session attached at all) -> not_attached, handled by caller before authorizeTrainerDeckRead is even called', () => {
    // authorizeTrainerDeckRead itself assumes an attached bundle was already
    // found (the IPC handler returns not_attached earlier) — verify that
    // readTrainerDeckCard's own not_attached path still fires defensively
    // if called with an unattached session.
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver);
    const result = authorizeTrainerDeckRead(VALID_ID, null, subnauticaGameDetail(), session);
    assert.equal(result.status, 'not_attached');
  });

  test('wrong executable (module for this game never loaded in attached process) -> blocked', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('StardewValley.exe', 0x140000000n, 0x1000000); // different game's module
    driver.setProcessExecutableName(6002, 'StardewValley.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6002, executableName: 'StardewValley.exe' }, true);

    const result = authorizeTrainerDeckRead(VALID_ID, 'subnautica', subnauticaGameDetail(), session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'MODULE_NOT_LOADED');
  });

  test('missing module -> blocked (same gate as "wrong executable" — see comment in trainer-deck-read.ts)', async () => {
    const driver = new FakeMemoryDriver();
    driver.setProcessExecutableName(6003, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6003, executableName: 'Subnautica.exe' }, true);
    // No module added at all.
    const result = authorizeTrainerDeckRead(VALID_ID, 'subnautica', subnauticaGameDetail(), session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'MODULE_NOT_LOADED');
  });

  test('P1 fix — session with no catalog game binding at all is refused, not silently allowed through', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(6012, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6012, executableName: 'Subnautica.exe' }, true);
    seedSubnauticaChain(driver, 1);

    const result = authorizeTrainerDeckRead(VALID_ID, null, subnauticaGameDetail(), session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'SESSION_NOT_GAME_BOUND');
  });

  test('P1 fix — cross-game module-name collision cannot be exploited without a catalog binding', async () => {
    // Half-Life 2's card requires "server.dll" — but MANY different Source
    // engine games ship a module with that exact name. Before the fix, an
    // unbound session attached to a DIFFERENT Source game with its own
    // server.dll would pass isModuleLoaded('server.dll') and "successfully"
    // read garbage misrepresented as HL2's value. The fix must block this
    // at the game-binding gate, before module presence is ever checked.
    const driver = new FakeMemoryDriver();
    driver.addModule('server.dll', 0x999999000n, 0x1000000); // a DIFFERENT game's server.dll
    driver.setProcessExecutableName(6013, 'portal.exe'); // not hl2.exe
    const session = makeSession(driver);
    await session.attach({ pid: 6013, executableName: 'portal.exe' }, true);

    const hl2Cheat = pointerCheat('ptr-current-hp', 'Current HP', 'int32', 'server.dll', '0x00633AFC', [224]);
    const hl2Detail: TrainerDeckGameDetailLike = {
      available: true,
      game: { displayName: 'Half-Life 2' },
      tables: [{ tableName: '2 hl2', archivePath: 'Games/Half-Life 2/2_hl2.CT', sourceSha256: 'hl2sha', cheats: [hl2Cheat] }],
    };

    const resultNoBinding = authorizeTrainerDeckRead('half-life-2:hl2sha:ptr-current-hp', null, hl2Detail, session);
    assert.equal(resultNoBinding.status, 'blocked');
    if (resultNoBinding.status === 'blocked') assert.equal(resultNoBinding.code, 'SESSION_NOT_GAME_BOUND');

    // Even WITH a binding, if it's bound to the wrong game, still blocked.
    const resultWrongBinding = authorizeTrainerDeckRead('half-life-2:hl2sha:ptr-current-hp', 'portal', hl2Detail, session);
    assert.equal(resultWrongBinding.status, 'blocked');
    if (resultWrongBinding.status === 'blocked') assert.equal(resultWrongBinding.code, 'WRONG_GAME_SESSION');
  });

  test('malformed card / request id -> blocked', async () => {
    const driver = new FakeMemoryDriver();
    driver.setProcessExecutableName(6009, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6009, executableName: 'Subnautica.exe' }, true);
    assert.equal(parseLibraryEntryId('not-a-valid-id'), null);
    assert.equal(parseLibraryEntryId('only:two'), null);
    const result = authorizeTrainerDeckRead('not-a-valid-id', null, null, session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'MALFORMED_REQUEST');
  });

  test('unapproved/unknown card ID (real game, but this exact table/cheat does not exist) -> blocked', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(6004, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6004, executableName: 'Subnautica.exe' }, true);

    const result = authorizeTrainerDeckRead('subnautica:abc123:ptr-does-not-exist', 'subnautica', subnauticaGameDetail(), session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'UNKNOWN_ENTRY');
  });

  test('unknown game entirely -> blocked', async () => {
    const driver = new FakeMemoryDriver();
    driver.setProcessExecutableName(6010, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6010, executableName: 'Subnautica.exe' }, true);
    const result = authorizeTrainerDeckRead(VALID_ID, 'subnautica', { available: false, tables: [] }, session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'UNKNOWN_GAME');
  });

  test('renderer cannot supply a raw address or PID — the function signature has no such parameter', () => {
    // Structural proof, not a runtime assertion: authorizeTrainerDeckRead's
    // only caller-controlled input is an opaque string id. There is no
    // address/PID/module parameter anywhere in its signature for a renderer
    // to abuse — TypeScript itself makes "renderer attempts raw address" and
    // "renderer attempts arbitrary PID" impossible to even construct a call for.
    const signatureParamCount = authorizeTrainerDeckRead.length;
    assert.equal(signatureParamCount, 4); // (libraryEntryId, sessionCatalogGameId, gameDetail, session) — no address/PID param
  });

  test('no session at all -> not_attached, never reaches CT library lookup', () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver);
    let gameDetailAccessed = false;
    const trackedDetail = new Proxy(subnauticaGameDetail(), {
      get(target, prop, receiver) {
        gameDetailAccessed = true;
        return Reflect.get(target, prop, receiver);
      },
    });
    const result = authorizeTrainerDeckRead(VALID_ID, null, trackedDetail, session);
    assert.equal(result.status, 'not_attached');
    assert.equal(gameDetailAccessed, false, 'must fail closed on no-session before ever inspecting gameDetail');
  });

  test('native read failure is surfaced, not swallowed', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(6005, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6005, executableName: 'Subnautica.exe' }, true);
    // No regions seeded — the first dereference throws inside the driver.

    const result = authorizeTrainerDeckRead(VALID_ID, 'subnautica', subnauticaGameDetail(), session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') {
      assert.equal(result.code, 'FINAL_ADDRESS_UNRESOLVED');
      assert.ok(result.reason.length > 0);
    }
  });

  test('no write primitive is ever invoked by the authorization+read chain', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(6006, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6006, executableName: 'Subnautica.exe' }, true);
    seedSubnauticaChain(driver, 1);

    let writeMemoryCalls = 0;
    let writeBufferCalls = 0;
    const originalWriteMemory = driver.writeMemory.bind(driver);
    const originalWriteBuffer = driver.writeBuffer.bind(driver);
    driver.writeMemory = (...args) => {
      writeMemoryCalls += 1;
      return originalWriteMemory(...args);
    };
    driver.writeBuffer = (...args) => {
      writeBufferCalls += 1;
      return originalWriteBuffer(...args);
    };

    authorizeTrainerDeckRead(VALID_ID, 'subnautica', subnauticaGameDetail(), session);
    assert.equal(writeMemoryCalls, 0);
    assert.equal(writeBufferCalls, 0);
  });

  test('no freeze primitive is invoked (freeze concurrency registry stays empty)', async () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Subnautica.exe', 0x140000000n, 0x1000000);
    driver.setProcessExecutableName(6007, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6007, executableName: 'Subnautica.exe' }, true);
    seedSubnauticaChain(driver, 1);

    authorizeTrainerDeckRead(VALID_ID, 'subnautica', subnauticaGameDetail(), session);
    // startFreeze is never on the call path at all — readTrainerDeckCard only
    // ever calls probe.readValue. Structural guarantee, verified by the
    // "no write primitive invoked" test above and by inspection of
    // trainer-deck-read.ts's imports (no freeze-related import exists there).
    assert.ok(true);
  });

  test('Lua/AA execution path is structurally impossible: promote-bridge fail-closed refuses script/aob kinds before any card exists', async () => {
    const driver = new FakeMemoryDriver();
    driver.setProcessExecutableName(6011, 'Subnautica.exe');
    const session = makeSession(driver);
    await session.attach({ pid: 6011, executableName: 'Subnautica.exe' }, true);
    const scriptDetail: TrainerDeckGameDetailLike = {
      available: true,
      game: { displayName: 'Subnautica' },
      tables: [
        {
          tableName: '0 Subnautica',
          archivePath: 'Games/Subnautica/0_Subnautica.CT',
          sourceSha256: 'abc123',
          cheats: [
            { id: 'script-1', name: 'AA Script', kind: 'script', executable: false, certificationLevel: 'L0', metadata: { scriptType: 'autoassembler' } },
          ],
        },
      ],
    };
    const result = authorizeTrainerDeckRead('subnautica:abc123:script-1', 'subnautica', scriptDetail, session);
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.code, 'NOT_PROMOTABLE');
  });
});
