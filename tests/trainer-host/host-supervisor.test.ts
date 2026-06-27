import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTrainerHostSupervisor, ChildProcessLike } from '../../src/core/trainer-host/host-supervisor.js';
import { encodeResponse } from '../../src/core/trainer-host/protocol.js';

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
