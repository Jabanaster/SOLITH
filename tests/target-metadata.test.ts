import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  definitionTargetMetadata,
  selectDefinitionTarget,
} from '../src/core/definitions/target-metadata.ts';
import {
  parseSolithDefinitionV1,
  type SolithDefinitionV1,
} from '../src/core/definitions/schema.v1.ts';

const baseDefinition: SolithDefinitionV1 = {
  schemaVersion: 1,
  id: 'multi-launcher-rpg',
  title: 'Multi Launcher RPG',
  gameVersion: '1.0',
  executableHashPrefixes: [],
  author: 'Solith',
  safety: {
    requiresApproval: true,
    requiresOfflineConfirm: true,
    verificationStatus: 'metadata-only',
  },
  target: {
    executables: ['Game-Steam.exe', 'Game-WinGDK.exe'],
    arch: 'x64',
  },
  certificationLevel: 'L0',
  targetMetadata: [
    {
      targetId: 'multi-launcher-rpg-steam',
      launcher: 'steam',
      executableName: 'Game-Steam.exe',
      executableSha256: 'a'.repeat(64),
      moduleName: 'Game-Steam.exe',
      packaging: 'win32',
      accessModel: 'standard_user_readonly',
      certificationLevel: 'L3',
    },
    {
      targetId: 'multi-launcher-rpg-xbox',
      launcher: 'xbox_pc',
      executableName: 'Game-WinGDK.exe',
      executableSha256: 'b'.repeat(64),
      moduleName: 'Game-WinGDK.exe',
      packaging: 'msixvc',
      accessModel: 'restricted_or_denied',
      certificationLevel: 'L0',
    },
  ],
  memoryFeatures: [],
};

describe('launcher-aware target metadata', () => {
  test('schema accepts multiple executable target metadata blocks under one game identity', () => {
    const parsed = parseSolithDefinitionV1(baseDefinition);
    assert.equal(parsed.id, 'multi-launcher-rpg');
    assert.equal(parsed.targetMetadata?.length, 2);
    assert.equal(parsed.targetMetadata?.[0]?.launcher, 'steam');
    assert.equal(parsed.targetMetadata?.[1]?.packaging, 'msixvc');
  });

  test('selects certification per launcher executable and hash, not per game title', () => {
    const steam = selectDefinitionTarget(
      baseDefinition,
      { executableName: 'Game-Steam.exe' },
      'a'.repeat(64),
    );
    assert.equal(steam.status, 'matched');
    assert.equal(steam.target?.targetId, 'multi-launcher-rpg-steam');
    assert.equal(steam.certificationLevel, 'L3');

    const wrongHash = selectDefinitionTarget(
      baseDefinition,
      { executableName: 'Game-Steam.exe' },
      'c'.repeat(64),
    );
    assert.equal(wrongHash.status, 'hash_mismatch');
    assert.equal(wrongHash.certificationLevel, 'L0');
  });

  test('fails closed for restricted launcher packages without requesting elevation', () => {
    const xbox = selectDefinitionTarget(
      baseDefinition,
      { executableName: 'Game-WinGDK.exe' },
      'b'.repeat(64),
    );
    assert.equal(xbox.status, 'restricted_fail_closed');
    assert.equal(xbox.certificationLevel, 'L0');
    assert.match(xbox.reason, /reports unavailable instead of requesting elevation/i);
  });

  test('legacy executable arrays are projected as unknown standard read-only metadata', () => {
    const legacy = { ...baseDefinition, targetMetadata: undefined };
    const projected = definitionTargetMetadata(legacy);
    assert.equal(projected.length, 2);
    assert.equal(projected[0]?.launcher, 'unknown');
    assert.equal(projected[0]?.accessModel, 'standard_user_readonly');
  });

  test('schema rejects restricted targets that claim L1+ certification', () => {
    const unsafe = {
      ...baseDefinition,
      targetMetadata: [
        {
          targetId: 'unsafe-xbox',
          launcher: 'xbox_pc',
          executableName: 'Game-WinGDK.exe',
          moduleName: 'Game-WinGDK.exe',
          packaging: 'msixvc',
          accessModel: 'restricted_or_denied',
          certificationLevel: 'L3',
        },
      ],
    };

    assert.throws(() => parseSolithDefinitionV1(unsafe), /cannot claim L1\+ certification/);
  });
});
