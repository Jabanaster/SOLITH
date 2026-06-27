import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LineFramer,
  RpcFrameError,
  encodeRequest,
  encodeResponse,
  encodeError,
  isRpcRequest,
  isRpcResponse,
  isRpcError,
} from '../../src/core/trainer-host/protocol.js';

describe('encodeRequest / encodeResponse / encodeError', () => {
  test('produces newline-terminated JSON', () => {
    assert.match(encodeRequest('1', 'ping'), /\n$/);
    assert.match(encodeResponse('1', 42), /\n$/);
    assert.match(encodeError('1', 'oops'), /\n$/);
  });

  test('round-trips request with params', () => {
    const line = encodeRequest('r1', 'readSaveField', { filePath: '/a', field: 'player.money' });
    const parsed = JSON.parse(line);
    assert.deepEqual(parsed, { id: 'r1', method: 'readSaveField', params: { filePath: '/a', field: 'player.money' } });
  });

  test('round-trips response', () => {
    const line = encodeResponse('r2', { value: '99', found: true });
    const parsed = JSON.parse(line);
    assert.deepEqual(parsed, { id: 'r2', ok: true, result: { value: '99', found: true } });
  });

  test('round-trips error', () => {
    const line = encodeError('r3', 'not_found');
    const parsed = JSON.parse(line);
    assert.deepEqual(parsed, { id: 'r3', ok: false, error: 'not_found' });
  });

  test('omits params key when params is undefined', () => {
    const line = encodeRequest('r4', 'shutdown');
    assert.ok(!line.includes('"params"'));
  });
});

describe('type guards', () => {
  test('isRpcRequest identifies requests', () => {
    assert.equal(isRpcRequest({ id: '1', method: 'ping' }), true);
    assert.equal(isRpcRequest({ id: '1', ok: true, result: null }), false);
  });

  test('isRpcResponse identifies ok responses', () => {
    assert.equal(isRpcResponse({ id: '1', ok: true, result: null }), true);
    assert.equal(isRpcResponse({ id: '1', ok: false, error: 'e' }), false);
  });

  test('isRpcError identifies error responses', () => {
    assert.equal(isRpcError({ id: '1', ok: false, error: 'e' }), true);
    assert.equal(isRpcError({ id: '1', ok: true, result: null }), false);
  });
});

describe('LineFramer', () => {
  test('emits message when a complete line arrives in one chunk', () => {
    const f = new LineFramer();
    const msgs = f.push(Buffer.from('{"id":"1","method":"ping"}\n'));
    assert.equal(msgs.length, 1);
    assert.equal((msgs[0] as any).method, 'ping');
  });

  test('buffers partial line and emits on subsequent chunk', () => {
    const f = new LineFramer();
    assert.equal(f.push(Buffer.from('{"id":"1","me')).length, 0);
    const msgs = f.push(Buffer.from('thod":"ping"}\n'));
    assert.equal(msgs.length, 1);
  });

  test('emits multiple messages from one chunk', () => {
    const f = new LineFramer();
    const msgs = f.push(Buffer.from('{"id":"1","method":"a"}\n{"id":"2","method":"b"}\n'));
    assert.equal(msgs.length, 2);
  });

  test('emits first message and buffers remainder when chunk has partial second line', () => {
    const f = new LineFramer();
    const msgs = f.push(Buffer.from('{"id":"1","method":"a"}\n{"id":"2","met'));
    assert.equal(msgs.length, 1);
    assert.ok(f.bufferedBytes > 0);
  });

  test('skips empty lines', () => {
    const f = new LineFramer();
    const msgs = f.push(Buffer.from('\n\n{"id":"1","method":"ping"}\n\n'));
    assert.equal(msgs.length, 1);
  });

  test('accepts string input', () => {
    const f = new LineFramer();
    const msgs = f.push('{"id":"1","method":"ping"}\n');
    assert.equal(msgs.length, 1);
  });

  test('throws RpcFrameError on malformed JSON', () => {
    const f = new LineFramer();
    assert.throws(() => f.push(Buffer.from('not-json\n')), RpcFrameError);
  });

  test('RpcFrameError contains the offending raw line', () => {
    const f = new LineFramer();
    try {
      f.push(Buffer.from('bad line here\n'));
      assert.fail('expected throw');
    } catch (e) {
      assert.ok(e instanceof RpcFrameError);
      assert.equal((e as RpcFrameError).rawLine, 'bad line here');
    }
  });

  test('retains buffered bytes after a throw', () => {
    const f = new LineFramer();
    try { f.push(Buffer.from('bad\n')); } catch {}
    assert.equal(f.bufferedBytes, 0);
  });
});
