import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runLocalSandboxScript,
  scriptLooksUnsafe,
} from '../../src/core/sandbox-script/local-sandbox.js';

describe('local-sandbox', () => {
  test('evaluates pure arithmetic', () => {
    const result = runLocalSandboxScript('1 + 2 * 3');
    assert.equal(result.ok, true);
    assert.equal(result.value, 7);
  });

  test('blocks require-like bindings', () => {
    const result = runLocalSandboxScript('require("fs")');
    assert.equal(result.ok, false);
  });

  test('copies JSON-safe bindings into the sandbox without host prototypes', () => {
    const result = runLocalSandboxScript(
      'stats.values.reduce((sum, value) => sum + value, 0)',
      { bindings: { stats: { values: [2, 3, 5] } } },
    );
    assert.equal(result.ok, true);
    assert.equal(result.value, 10);
  });

  test('rejects functions and forbidden nested binding keys', () => {
    const functionBinding = runLocalSandboxScript('helper()', {
      bindings: { helper: () => 1 },
    });
    assert.equal(functionBinding.ok, false);
    assert.match(functionBinding.error ?? '', /JSON-safe data/);

    const constructorBinding = runLocalSandboxScript('payload.value', {
      bindings: { payload: { constructor: 'escape', value: 1 } },
    });
    assert.equal(constructorBinding.ok, false);
    assert.match(constructorBinding.error ?? '', /forbidden/);
  });

  test('blocks constructor code-generation escapes', () => {
    const result = runLocalSandboxScript(
      'this.constructor.constructor("return process")()',
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /Code generation|forbidden/i);
  });

  test('rejects Promise microtasks to keep execution synchronous', () => {
    const result = runLocalSandboxScript(
      'Promise.resolve().then(() => { while (true) {} }); 1',
      { timeoutMs: 10 },
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /forbidden/i);
  });

  test('scriptLooksUnsafe flags network/inject tokens', () => {
    assert.equal(scriptLooksUnsafe('const x = 1'), false);
    assert.equal(scriptLooksUnsafe('fetch("http://x")'), true);
    assert.equal(scriptLooksUnsafe('WriteProcessMemory()'), true);
  });

  test('run rejects scripts that reference forbidden surfaces', () => {
    const result = runLocalSandboxScript('fetch("https://example.invalid")');
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /forbidden/);
  });

  test('rejects oversized source', () => {
    const result = runLocalSandboxScript('x'.repeat(70_000));
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /64KB/);
  });
});
