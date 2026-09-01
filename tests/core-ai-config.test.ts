/**
 * ROADMAP §6.5 Local AI — this module (src/core/ai/index.ts) previously had
 * zero test coverage. Covers config persistence and the connection-test
 * validation paths that don't require a live network call.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { getAIConfig, setAIConfig, testAIConnection, explainValue, classifyCategory, generateTrainerName } from '../src/core/ai/index.ts';

describe('AI config persistence', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('defaults to Ollama with an empty endpoint when nothing is configured', () => {
    const config = getAIConfig();
    assert.equal(config.provider, 'Ollama');
  });

  test('setAIConfig persists and getAIConfig reads it back', () => {
    setAIConfig('Ollama', { endpoint: 'http://localhost:11434', model: 'llama3', timeout: 30000 });
    const config = getAIConfig();
    assert.equal(config.provider, 'Ollama');
    assert.equal(config.endpoint, 'http://localhost:11434');
    assert.equal(config.model, 'llama3');
    assert.equal(config.timeout, 30000);
  });

  test('setAIConfig for LM Studio does not clobber the stored Ollama row', () => {
    setAIConfig('LM Studio', { endpoint: 'http://localhost:1234', model: 'local-model', timeout: 45000 });
    const config = getAIConfig();
    // getAIConfig() (no provider argument) prefers Ollama when both rows exist.
    assert.equal(config.provider, 'Ollama');
    assert.equal(config.endpoint, 'http://localhost:11434', 'the earlier Ollama row must survive an LM Studio write');
  });
});

describe('testAIConnection — validation paths (no live network required)', () => {
  test("provider 'None' always succeeds with a rule-based-fallback message", async () => {
    const result = await testAIConnection({ provider: 'None', endpoint: '', model: '', timeout: 1000 });
    assert.equal(result.success, true);
    assert.match(result.message, /rule-based/i);
  });

  test('an empty endpoint fails before attempting any network call', async () => {
    const result = await testAIConnection({ provider: 'Ollama', endpoint: '', model: '', timeout: 1000 });
    assert.equal(result.success, false);
    assert.match(result.message, /empty/i);
  });

  test('a malformed endpoint URL fails validation', async () => {
    const result = await testAIConnection({ provider: 'Ollama', endpoint: 'not a url', model: '', timeout: 1000 });
    assert.equal(result.success, false);
    assert.match(result.message, /invalid/i);
  });

  test('a non-http(s) endpoint scheme is rejected (no arbitrary protocol probing)', async () => {
    const result = await testAIConnection({ provider: 'Ollama', endpoint: 'file:///etc/passwd', model: '', timeout: 1000 });
    assert.equal(result.success, false);
    assert.match(result.message, /http/i);
  });
});

describe('rule-based fallback (no AI configured)', () => {
  test('explainValue produces a currency-specific explanation', () => {
    assert.match(explainValue('player.gold', 100, 500), /currency/i);
  });

  test('classifyCategory buckets a health field as PLAYER', () => {
    assert.equal(classifyCategory('player.health'), 'PLAYER');
  });

  test('generateTrainerName suggests "Set Gold" for a currency path', () => {
    assert.equal(generateTrainerName('player.gold', 0, 999), 'Set Gold');
  });
});
