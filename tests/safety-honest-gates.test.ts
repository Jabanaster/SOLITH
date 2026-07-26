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

  test('rejects HTTP 200 with invalid Ollama /api/tags shape', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const result = await testAIConnection({
        provider: 'Ollama',
        endpoint: `http://127.0.0.1:${port}`,
        model: 'llama',
        timeout: 2000,
      });
      assert.equal(result.success, false);
      assert.match(result.message, /models array/i);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  test('accepts valid Ollama /api/tags and LM Studio /v1/models shapes', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url?.includes('/v1/models')) {
        res.end(JSON.stringify({ data: [{ id: 'local-model' }] }));
        return;
      }
      res.end(JSON.stringify({ models: [{ name: 'llama' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const ollama = await testAIConnection({
        provider: 'Ollama',
        endpoint: `http://127.0.0.1:${port}`,
        model: 'llama',
        timeout: 2000,
      });
      assert.equal(ollama.success, true);
      const lm = await testAIConnection({
        provider: 'LM Studio',
        endpoint: `http://127.0.0.1:${port}`,
        model: 'local',
        timeout: 2000,
      });
      assert.equal(lm.success, true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
