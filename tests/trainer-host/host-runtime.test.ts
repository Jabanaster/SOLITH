import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { startHostRuntime, ADVERTISED_CAPABILITIES, PROTOCOL_VERSION } from '../../src/core/trainer-host/host-runtime.js';
import { encodeRequest } from '../../src/core/trainer-host/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../demo-game/save/stardew-fixture.xml');

// ── Fake IO ───────────────────────────────────────────────────────────────────

interface FakeIO {
  stdin: {
    handlers: Record<string, ((chunk: Buffer) => void) | (() => void)>;
    on(event: string, cb: (chunk: Buffer) => void): void;
    emit(event: string, data?: Buffer): void;
  };
  stdout: { write(s: string): void; lines(): string[] };
  exit(code: number): void;
  exitCalls: number[];
  writtenLines: string[];
}

function makeFakeIO(): FakeIO {
  const handlers: Record<string, ((chunk: Buffer) => void) | (() => void)> = {};
  const writtenLines: string[] = [];
  const exitCalls: number[] = [];

  return {
    stdin: {
      handlers,
      on(event: string, cb: (chunk: Buffer) => void) { handlers[event] = cb; },
      emit(event: string, data?: Buffer) {
        const h = handlers[event];
        if (h) (h as any)(data);
      },
    },
    stdout: {
      write(s: string) { writtenLines.push(s); },
      lines() { return writtenLines; },
    },
    exit(code: number) { exitCalls.push(code); },
    exitCalls,
    writtenLines,
  };
}

function sendLine(io: FakeIO, line: string): void {
  io.stdin.emit('data', Buffer.from(line + '\n'));
}

function parseLastLine(io: FakeIO): any {
  const lines = io.stdout.lines();
  return JSON.parse(lines[lines.length - 1]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('startHostRuntime — handshake', () => {
  test('sends handshake immediately on start', () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    const lines = io.stdout.lines();
    assert.equal(lines.length, 1);
    const msg = JSON.parse(lines[0]);
    assert.equal(msg.id, 'handshake');
    assert.equal(msg.ok, true);
    assert.equal(msg.result.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(msg.result.capabilities, [...ADVERTISED_CAPABILITIES]);
  });

  test('advertises all write capabilities', () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    const msg = JSON.parse(io.stdout.lines()[0]);
    const caps: string[] = msg.result.capabilities;
    assert.ok(caps.includes('readSaveField'));
    assert.ok(caps.includes('proposeWriteField'));
    assert.ok(caps.includes('executeWriteField'));
    assert.ok(caps.includes('rollbackWriteField'));
  });
});

describe('startHostRuntime — unknown method', () => {
  test('returns error envelope for unknown method', () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    sendLine(io, encodeRequest('r1', 'doSomethingEvil').trim());
    const reply = parseLastLine(io);
    assert.equal(reply.id, 'r1');
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'unknown_method');
  });
});

describe('startHostRuntime — shutdown', () => {
  test('replies and calls exit(0) on shutdown request', () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    sendLine(io, encodeRequest('s1', 'shutdown').trim());
    const reply = parseLastLine(io);
    assert.equal(reply.id, 's1');
    assert.equal(reply.ok, true);
    assert.equal(io.exitCalls[0], 0);
  });
});

describe('startHostRuntime — parent loss', () => {
  test('exits on stdin end', () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    io.stdin.emit('end');
    assert.equal(io.exitCalls[0], 0);
  });

  test('exits on stdin close', () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    io.stdin.emit('close');
    assert.equal(io.exitCalls[0], 0);
  });
});

describe('startHostRuntime — readSaveField dispatch', () => {
  test('dispatches readSaveField and returns result', async () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    sendLine(
      io,
      encodeRequest('rf1', 'readSaveField', {
        filePath: FIXTURE,
        field: 'SaveGame.player.0.money',
      }).trim(),
    );
    await new Promise(r => setTimeout(r, 50));
    const reply = parseLastLine(io);
    assert.equal(reply.id, 'rf1');
    assert.equal(reply.ok, true);
    assert.equal(reply.result.found, true);
    assert.equal(reply.result.value, '5000');
  });

  test('returns error for invalid params', async () => {
    const io = makeFakeIO();
    startHostRuntime(io as any);
    sendLine(io, encodeRequest('rf2', 'readSaveField', { filePath: '', field: '' }).trim());
    await new Promise(r => setTimeout(r, 50));
    const reply = parseLastLine(io);
    assert.equal(reply.id, 'rf2');
    assert.equal(reply.ok, false);
    assert.ok(reply.error.includes('invalid_params'));
  });
});
