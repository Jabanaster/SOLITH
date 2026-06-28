import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTrainerHostSupervisor, ChildProcessLike } from '../../src/core/trainer-host/host-supervisor.js';
import { encodeResponse } from '../../src/core/trainer-host/protocol.js';
import { initDatabase } from '../../src/core/database/index.js';
import { addGame } from '../../src/core/games/index.js';

// ── Fake child process ────────────────────────────────────────────────────────

function makeFakeChild(pid = 9999): {
  proc: ChildProcessLike & { triggerData(s: string): void; triggerClose(): void };
  killCalls: string[];
  writtenLines(): string[];
} {
  const written: string[] = [];
  const killCalls: string[] = [];
  const handlers: Record<string, Function[]> = { data: [], close: [], error: [] };

  const proc = {
    pid,
    stdin: {
      write(data: string) { written.push(data); },
    },
    stdout: {
      on(event: string, cb: (chunk: Buffer) => void) {
        (handlers[event] ??= []).push(cb as any);
      },
    },
    stderr: {
      on(_event: string, _cb: any) {},
    },
    on(event: string, cb: Function) {
      (handlers[event] ??= []).push(cb);
    },
    kill(signal?: string) {
      killCalls.push(signal ?? 'SIGTERM');
      return true;
    },
    triggerData(s: string) {
      for (const cb of handlers['data'] ?? []) (cb as any)(Buffer.from(s));
    },
    triggerClose() {
      for (const cb of handlers['close'] ?? []) (cb as any)(0);
    },
  };

  return { proc, killCalls, writtenLines: () => written };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createTrainerHostSupervisor — start / handshake', () => {
  test('returns running=false before start', () => {
    const sup = createTrainerHostSupervisor(() => { throw new Error('should not spawn'); });
    assert.equal(sup.getStatus().running, false);
  });

  test('resolves success after receiving handshake', async () => {
    const { proc } = makeFakeChild();
    const sup = createTrainerHostSupervisor(() => proc as any);

    const startPromise = sup.start();
    proc.triggerData(encodeResponse('handshake', { protocolVersion: 1, capabilities: ['readSaveField'] }));
    const result = await startPromise;

    assert.equal(result.success, true);
    assert.deepEqual(sup.getStatus().capabilities, ['readSaveField']);
  });

  test('returns already_running when called twice', async () => {
    const { proc } = makeFakeChild(process.pid);
    const sup = createTrainerHostSupervisor(() => proc as any);

    const p1 = sup.start();
    proc.triggerData(encodeResponse('handshake', { protocolVersion: 1, capabilities: ['readSaveField'] }));
    await p1;

    const p2 = await sup.start();
    assert.equal(p2.success, false);
    assert.equal(p2.error, 'already_running');
  });
});

describe('createTrainerHostSupervisor — stop', () => {
  test('sends shutdown and clears running state', async () => {
    const { proc, writtenLines } = makeFakeChild();
    const sup = createTrainerHostSupervisor(() => proc as any);

    const startP = sup.start();
    proc.triggerData(encodeResponse('handshake', { protocolVersion: 1, capabilities: ['readSaveField'] }));
    await startP;

    const stopP = sup.stop();
    const shutdownLine = writtenLines().find(l => l.includes('"shutdown"'));
    const id = shutdownLine ? JSON.parse(shutdownLine.trim()).id : null;
    if (id) proc.triggerData(encodeResponse(id, { ok: true }));
    proc.triggerClose();
    await stopP;

    assert.equal(sup.getStatus().running, false);
  });
});

describe('createTrainerHostSupervisor — approved-path gate', () => {
  test('rejects readField when path is not approved', async () => {
    const { proc } = makeFakeChild(process.pid);
    const sup = createTrainerHostSupervisor(() => proc as any);
    const startP = sup.start();
    proc.triggerData(encodeResponse('handshake', { protocolVersion: 1, capabilities: ['readSaveField'] }));
    await startP;

    const result = await sup.readField('demo-game-quest-id-000000000000', '/etc/passwd', 'root');
    assert.equal(result.success, false);
    assert.equal(result.error, 'path_not_approved');
  });
});

describe('createTrainerHostSupervisor — rollback backup ownership gate', () => {
  async function createOwnedBackupScenario() {
    await initDatabase();

    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-host-rollback-'));
    const gameDir = path.join(testRoot, 'game');
    fs.mkdirSync(gameDir, { recursive: true });
    const targetFile = path.join(gameDir, 'save.xml');
    const otherTargetFile = path.join(gameDir, 'other-save.xml');
    const backupPath = targetFile + '.trainer-backup';
    fs.writeFileSync(targetFile, '<SaveGame><player><money>5000</money></player></SaveGame>', 'utf-8');
    fs.writeFileSync(otherTargetFile, '<SaveGame><player><money>100</money></player></SaveGame>', 'utf-8');

    const game = addGame({ name: `Rollback Ownership ${Date.now()}`, path: gameDir, engine: 'Test' });
    const { proc, writtenLines } = makeFakeChild(process.pid);
    const sup = createTrainerHostSupervisor(() => proc as any);
    const startP = sup.start();
    proc.triggerData(encodeResponse('handshake', { protocolVersion: 1, capabilities: ['proposeWriteField', 'executeWriteField', 'rollbackWriteField'] }));
    await startP;

    const proposeP = sup.proposeWrite(game.id, targetFile, 'SaveGame.player.0.money', '5000', '9999');
    let line = writtenLines().find(l => l.includes('"proposeWriteField"'));
    assert.ok(line, 'proposeWrite must send child RPC');
    proc.triggerData(encodeResponse(JSON.parse(line.trim()).id, { valid: true }));
    const proposeResult = await proposeP;
    assert.equal(proposeResult.success, true);
    assert.ok(proposeResult.proposalId);

    const approveP = sup.approveAndWrite(proposeResult.proposalId);
    line = writtenLines().find(l => l.includes('"executeWriteField"'));
    assert.ok(line, 'approveAndWrite must send child RPC');
    proc.triggerData(encodeResponse(JSON.parse(line.trim()).id, {
      written: true,
      verifiedValue: '9999',
      backupPath,
    }));
    const approveResult = await approveP;
    assert.equal(approveResult.success, true);
    assert.equal(approveResult.backupPath, backupPath);

    return { testRoot, game, sup, proc, writtenLines, targetFile, otherTargetFile, backupPath };
  }

  test('rejects rollback when backupPath was not created for the approved target', async () => {
    await initDatabase();

    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-host-rollback-'));
    const gameDir = path.join(testRoot, 'game');
    fs.mkdirSync(gameDir, { recursive: true });
    const targetFile = path.join(gameDir, 'save.xml');
    const hostileBackupPath = path.join(testRoot, 'hostile-backup.xml');
    fs.writeFileSync(targetFile, '<SaveGame><player><money>5000</money></player></SaveGame>', 'utf-8');
    fs.writeFileSync(hostileBackupPath, '<SaveGame><player><money>999999</money></player></SaveGame>', 'utf-8');

    try {
      const game = addGame({ name: `Rollback Ownership ${Date.now()}`, path: gameDir, engine: 'Test' });
      const { proc, writtenLines } = makeFakeChild(process.pid);
      const sup = createTrainerHostSupervisor(() => proc as any);
      const startP = sup.start();
      proc.triggerData(encodeResponse('handshake', { protocolVersion: 1, capabilities: ['rollbackWriteField'] }));
      await startP;

      const rollbackP = sup.rollback(targetFile, hostileBackupPath, 'SaveGame.player.0.money', game.id);

      const rollbackLine = writtenLines().find(l => l.includes('"rollbackWriteField"'));
      if (rollbackLine) {
        const id = JSON.parse(rollbackLine.trim()).id;
        proc.triggerData(encodeResponse(id, { restored: true, verifiedValue: '999999' }));
      }

      const result = await rollbackP;
      assert.equal(result.success, false);
      assert.equal(result.error, 'backup_not_owned');
      assert.equal(rollbackLine, undefined, 'unowned backup rollback must be rejected before child RPC');
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('rejects rollback when owned backup belongs to a different target', async () => {
    const ctx = await createOwnedBackupScenario();
    try {
      const beforeCount = ctx.writtenLines().filter(l => l.includes('"rollbackWriteField"')).length;
      const result = await ctx.sup.rollback(ctx.otherTargetFile, ctx.backupPath, 'SaveGame.player.0.money', ctx.game.id);
      const afterCount = ctx.writtenLines().filter(l => l.includes('"rollbackWriteField"')).length;

      assert.equal(result.success, false);
      assert.equal(result.error, 'backup_target_mismatch');
      assert.equal(afterCount, beforeCount, 'different-target rollback must be rejected before child RPC');
    } finally {
      fs.rmSync(ctx.testRoot, { recursive: true, force: true });
    }
  });

  test('allows rollback for an owned backup created for the same target', async () => {
    const ctx = await createOwnedBackupScenario();
    try {
      const rollbackP = ctx.sup.rollback(ctx.targetFile, ctx.backupPath, 'SaveGame.player.0.money', ctx.game.id);
      const rollbackLine = ctx.writtenLines().find(l => l.includes('"rollbackWriteField"'));
      assert.ok(rollbackLine, 'owned backup rollback must reach child RPC');
      ctx.proc.triggerData(encodeResponse(JSON.parse(rollbackLine.trim()).id, { restored: true, verifiedValue: '5000' }));

      const result = await rollbackP;
      assert.equal(result.success, true);
      assert.equal(result.verifiedValue, '5000');
    } finally {
      fs.rmSync(ctx.testRoot, { recursive: true, force: true });
    }
  });
});

describe('createTrainerHostSupervisor — verifyExitOrKill', () => {
  test('kills a still-running child', async () => {
    const { proc, killCalls } = makeFakeChild(process.pid);
    const sup = createTrainerHostSupervisor(() => proc as any);
    const startP = sup.start();
    proc.triggerData(encodeResponse('handshake', { protocolVersion: 1, capabilities: [] }));
    await startP;

    sup.verifyExitOrKill();
    assert.ok(killCalls.length > 0, 'expected kill to be called');
  });

  test('is a no-op when child is not running', () => {
    const sup = createTrainerHostSupervisor(() => { throw new Error('no spawn'); });
    assert.doesNotThrow(() => sup.verifyExitOrKill());
  });
});
