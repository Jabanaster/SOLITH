import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFileSync } from '../src/core/database/index.ts';
import { testAIConnection } from '../src/core/ai/index.ts';

describe('atomic database file writes', () => {
  test('atomicWriteFileSync replaces the target without leaving a .tmp sibling', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-db-atomic-'));
    const target = path.join(dir, 'solith.db');
    try {
      atomicWriteFileSync(target, Buffer.from('version-1'));
      assert.equal(fs.readFileSync(target, 'utf8'), 'version-1');

      atomicWriteFileSync(target, Buffer.from('version-2-longer-payload'));
      assert.equal(fs.readFileSync(target, 'utf8'), 'version-2-longer-payload');

      const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
      assert.deepEqual(leftovers, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AI connection probe', () => {
  test('fails closed when endpoint is empty', async () => {
    const result = await testAIConnection({
      provider: 'Ollama',
      endpoint: '',
      model: 'llama',
      timeout: 1000,
    });
    assert.equal(result.success, false);
    assert.match(result.message, /empty/i);
  });

  test('fails closed when endpoint is not reachable', async () => {
    const result = await testAIConnection({
      provider: 'Ollama',
      endpoint: 'http://127.0.0.1:1',
      model: 'llama',
      timeout: 1000,
    });
    assert.equal(result.success, false);
    assert.match(result.message, /failed/i);
  });

  test('None provider stays rule-based without network', async () => {
    const result = await testAIConnection({
      provider: 'None',
      endpoint: '',
      model: '',
      timeout: 1000,
    });
    assert.equal(result.success, true);
    assert.match(result.message, /rule-based/i);
  });
});
