import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNITY_WARNING_LABEL,
  requiresCommunityExecutionApproval,
} from '../src/core/trainer-catalog/community-trust.ts';
import {
  sanitizeDefinitionForCommunityPublish,
} from '../src/core/trainer-catalog/sync/hub-client.ts';

describe('community definition trust layer', () => {
  test('L0 definitions receive the required warning and execution gate', () => {
    assert.equal(COMMUNITY_WARNING_LABEL, 'Community (Scan Required)');
    assert.equal(requiresCommunityExecutionApproval('L0_Community'), true);
    assert.equal(requiresCommunityExecutionApproval('L3_Certified'), false);
  });

  test('publishing strips PII paths and all client certification claims', () => {
    const sanitized = sanitizeDefinitionForCommunityPublish({
      schemaVersion: 1,
      id: 'local-game',
      title: 'Local Game',
      gameVersion: 'research',
      targetSHA256: 'b'.repeat(64),
      executableHashPrefixes: ['bbbb'],
      author: 'C:\\Users\\chase\\\\wsl$\\Ubuntu\\home\\chase',
      certificationLevel: 'L4',
      safety: {
        requiresApproval: false,
        requiresOfflineConfirm: false,
        verificationStatus: 'verified',
      },
      target: {
        executables: [
          'C:\\Users\\chase\\Games\\LocalGame.exe',
          '\\\\NAS\\Users\\chase\\Games\\LocalGame.exe',
        ],
        arch: 'x64',
      },
      memoryFeatures: [{
        id: 'health',
        name: 'Health',
        category: 'Player',
        type: 'scan_unknown',
        dataType: 'int32',
        defaultValue: 100,
        certificationLevel: 'L4',
        resolution: {
          moduleName: 'C:\\Users\\chase\\Games\\LocalGame.exe',
          baseOffset: '0x1234',
        },
      }],
    }, 'a'.repeat(64));

    assert.equal(sanitized.author, 'community-contributor');
    assert.equal(sanitized.targetSHA256, 'a'.repeat(64));
    assert.deepEqual(sanitized.target.executables, ['LocalGame.exe', 'LocalGame.exe']);
    assert.equal(sanitized.certificationLevel, undefined);
    assert.equal(sanitized.memoryFeatures?.[0]?.certificationLevel, undefined);
    assert.equal(sanitized.safety.verificationStatus, 'community');
    assert.equal(sanitized.safety.requiresApproval, true);
    assert.equal(sanitized.safety.requiresOfflineConfirm, true);
    assert.equal(sanitized.memoryFeatures?.[0]?.resolution.moduleName, 'LocalGame.exe');
    assert.doesNotMatch(JSON.stringify(sanitized), /chase|NAS|wsl/i);
  });
});
