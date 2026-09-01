import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSolithDefinitionV1,
  validateSolithDefinitionV1,
  memoryDataTypeToLiveValue,
  SOLITH_DEFINITION_SCHEMA_VERSION,
  isValidMemoryFeatureResolution,
} from '../src/core/definitions/schema.v1.js';
import { importDefinitionYaml } from '../src/core/definitions/import-definition.js';
import { verifyDefinitionFingerprint, fingerprintBlocksAttach } from '../src/core/definitions/fingerprint-verify.js';
import { modPackToSolithDefinition } from '../src/core/definitions/mod-pack-adapter.js';
import type { ModPack } from '../src/core/trainer-catalog/types.js';

const SAMPLE_DEFINITION = {
  schemaVersion: 1,
  id: 'demo-game',
  title: 'Demo Game',
  gameVersion: '1.0.0',
  executableHashPrefixes: ['abc123'],
  author: 'solith',
  safety: {
    requiresApproval: true,
    requiresOfflineConfirm: true,
    verificationStatus: 'community',
  },
  target: {
    executables: ['Demo.exe'],
    arch: 'x64',
  },
  memoryFeatures: [
    {
      id: 'health',
      name: 'Health',
      category: 'Player',
      type: 'freeze',
      dataType: 'int32',
      defaultValue: 999,
      resolution: {
        signature: '48 8B 05 ? ? ? ?',
        moduleName: 'Demo.exe',
        baseOffset: '0x10',
        pointerChain: [0x20],
      },
    },
  ],
} as const;

describe('SolithDefinitionV1 schema', () => {
  test('parses a valid definition', () => {
    const parsed = parseSolithDefinitionV1(SAMPLE_DEFINITION);
    assert.equal(parsed.schemaVersion, SOLITH_DEFINITION_SCHEMA_VERSION);
    assert.equal(parsed.memoryFeatures?.[0]?.type, 'freeze');
  });

  test('rejects inject-like feature types', () => {
    const bad = {
      ...SAMPLE_DEFINITION,
      memoryFeatures: [{ ...SAMPLE_DEFINITION.memoryFeatures[0], type: 'inject' }],
    };
    const errors = validateSolithDefinitionV1(bad);
    assert.ok(errors.length > 0);
  });

  test('maps boolean memory data type to byte live value', () => {
    assert.equal(memoryDataTypeToLiveValue('boolean'), 'byte');
  });
});

describe('verifyDefinitionFingerprint', () => {
  const fullHash = 'abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890';

  test('prefix match passes', () => {
    const result = verifyDefinitionFingerprint({
      executableHashSHA256: fullHash,
      executableHashPrefixes: ['abc123'],
    });
    assert.equal(result.status, 'prefix_match');
  });

  test('prefix mismatch warns', () => {
    const result = verifyDefinitionFingerprint({
      executableHashSHA256: fullHash,
      executableHashPrefixes: ['deadbeef'],
    });
    assert.equal(result.status, 'mismatch');
    assert.match(result.warning ?? '', /Patch Day Drift/);
    assert.equal(fingerprintBlocksAttach(result, false), true);
    assert.equal(fingerprintBlocksAttach(result, true), false);
  });

  test('full target hash mismatch', () => {
    const result = verifyDefinitionFingerprint({
      executableHashSHA256: fullHash,
      targetSHA256: '0000000000000000000000000000000000000000000000000000000000000000',
    });
    assert.equal(result.status, 'mismatch');
  });

  test('skips when no constraints', () => {
    const result = verifyDefinitionFingerprint({ executableHashSHA256: fullHash });
    assert.equal(result.status, 'skipped');
  });
});

describe('modPackToSolithDefinition', () => {
  test('adapts mod pack cheats and fingerprint prefixes', () => {
    const pack: ModPack = {
      packId: 'pack-1',
      catalogGameId: 'stardew',
      gameName: 'Stardew Valley',
      source: { provider: 'community' },
      verificationStatus: 'community',
      versions: [
        {
          versionLabel: '1.6',
          executables: ['Stardew Valley.exe'],
          executableHashPrefixes: ['aabbcc'],
        },
      ],
      cheats: [
        {
          id: 'money',
          name: 'Money',
          description: 'Gold',
          category: 'Economy',
          valueType: 'int32',
          requiresDiscovery: false,
          verified: true,
          pointerPath: {
            moduleName: 'Stardew Valley.exe',
            moduleOffset: 0x100,
            offsets: [0x8],
          },
        },
      ],
      connectionBaseline: 2,
      platform: 'steam',
      syncedAt: '2026-07-11T00:00:00.000Z',
    };

    const definition = modPackToSolithDefinition(pack);
    assert.equal(definition.schemaVersion, 1);
    assert.deepEqual(definition.executableHashPrefixes, ['aabbcc']);
    assert.equal(definition.connectionBaseline, 2);
    assert.equal(definition.memoryFeatures?.[0]?.resolution.baseOffset, '0x100');
    assert.equal(definition.memoryFeatures?.[0]?.type, 'toggle');
  });
});

describe('Candidate 1A Regression Coverage: Resolution shape safety & import outcomes', () => {
  test('isValidMemoryFeatureResolution identifies valid, malformed, and missing resolution objects', () => {
    const valid = { moduleName: 'Game.exe', baseOffset: '0x10', pointerChain: [0x20] };
    const missingModuleName = { baseOffset: '0x10' };
    const badChainType = { moduleName: 'Game.exe', pointerChain: ['not-a-number'] };
    const nullVal = null;
    const undefinedVal = undefined;

    assert.equal(isValidMemoryFeatureResolution(valid), true);
    assert.equal(isValidMemoryFeatureResolution(missingModuleName), false);
    assert.equal(isValidMemoryFeatureResolution(badChainType), false);
    assert.equal(isValidMemoryFeatureResolution(nullVal), false);
    assert.equal(isValidMemoryFeatureResolution(undefinedVal), false);
  });

  test('valid feature resolution is accepted by parseSolithDefinitionV1', () => {
    const parsed = parseSolithDefinitionV1(SAMPLE_DEFINITION);
    assert.equal(isValidMemoryFeatureResolution(parsed.memoryFeatures?.[0]?.resolution), true);
  });

  test('malformed feature resolution is rejected by validateSolithDefinitionV1 without throwing runtime errors', () => {
    const malformedDef = {
      ...SAMPLE_DEFINITION,
      memoryFeatures: [
        {
          ...SAMPLE_DEFINITION.memoryFeatures[0],
          resolution: { baseOffset: '0x10' }, // missing required moduleName
        },
      ],
    };
    const errors = validateSolithDefinitionV1(malformedDef);
    assert.ok(errors.length > 0, 'Validation must report error for missing moduleName');
    assert.ok(errors.some((e) => e.includes('moduleName')), 'Error message must mention moduleName');
  });

  test('importDefinitionYaml exposes errors through discriminated failure outcome when YAML compilation fails', () => {
    const badYaml = 'invalid: [yaml: content';
    const outcome = importDefinitionYaml(badYaml);
    assert.equal(outcome.success, false);
    if (outcome.success === false) {
      assert.ok(Array.isArray(outcome.errors), 'Outcome must expose errors array');
      assert.ok(outcome.errors.length > 0, 'Outcome must contain at least one error');
    }
  });
});
