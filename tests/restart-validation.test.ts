import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRestartSignatureArtifacts } from '../src/core/runtime/restart-validation.ts';
import type { RuntimeSignatureValidationArtifact } from '../src/core/runtime/signature-validation.ts';

const base = {
  registryId: `Avowed:${'a'.repeat(64)}`,
  process: { pid: 10, executableName: 'Game.exe', selectedByUser: true },
  moduleHashes: { 'Game.exe': 'b'.repeat(64) },
} satisfies Omit<RuntimeSignatureValidationArtifact, 'sessionId' | 'signatureResults'>;

describe('restart signature validation', () => {
  test('promotes only unique same-offset unchanged-module evidence to an L3 candidate', () => {
    const previous: RuntimeSignatureValidationArtifact = {
      ...base,
      sessionId: 'before-restart',
      signatureResults: [
        {
          signatureId: 'health',
          symbol: 'playerHealth',
          module: 'Game.exe',
          status: 'unique_match',
          matchCount: 1,
          matches: [{ offset: 16, address: '0x1010' }],
        },
      ],
    };
    const current: RuntimeSignatureValidationArtifact = {
      ...base,
      process: { pid: 11, executableName: 'Game.exe', selectedByUser: true },
      sessionId: 'after-restart',
      signatureResults: [
        {
          signatureId: 'health',
          symbol: 'playerHealth',
          module: 'Game.exe',
          status: 'unique_match',
          matchCount: 1,
          matches: [{ offset: 16, address: '0x2010' }],
        },
      ],
    };

    const artifact = compareRestartSignatureArtifacts({ previous, current });

    assert.equal(artifact.readOnly, true);
    assert.equal(artifact.executable, false);
    assert.equal(artifact.summary.restart_stable_unique, 1);
    assert.equal(artifact.comparisons[0]?.classification, 'restart_stable_unique');
    assert.equal(artifact.comparisons[0]?.certificationCandidate, 'L3');
    assert.equal(artifact.comparisons[0]?.previousAddress, '0x1010');
    assert.equal(artifact.comparisons[0]?.currentAddress, '0x2010');
  });

  test('keeps changed offsets, changed hashes, and non-unique matches below L3', () => {
    const previous: RuntimeSignatureValidationArtifact = {
      ...base,
      sessionId: 'before',
      signatureResults: [
        { signatureId: 'offset', symbol: 'offset', module: 'Game.exe', status: 'unique_match', matchCount: 1, matches: [{ offset: 4, address: '0x1004' }] },
        { signatureId: 'multi', symbol: 'multi', module: 'Game.exe', status: 'multiple_matches', matchCount: 2, matches: [{ offset: 1, address: '0x1001' }, { offset: 2, address: '0x1002' }] },
        { signatureId: 'hash', symbol: 'hash', module: 'Game.exe', status: 'unique_match', matchCount: 1, matches: [{ offset: 8, address: '0x1008' }] },
      ],
    };
    const current: RuntimeSignatureValidationArtifact = {
      ...base,
      sessionId: 'after',
      moduleHashes: { 'Game.exe': 'c'.repeat(64) },
      signatureResults: [
        { signatureId: 'offset', symbol: 'offset', module: 'Game.exe', status: 'unique_match', matchCount: 1, matches: [{ offset: 5, address: '0x2005' }] },
        { signatureId: 'multi', symbol: 'multi', module: 'Game.exe', status: 'unique_match', matchCount: 1, matches: [{ offset: 1, address: '0x2001' }] },
        { signatureId: 'hash', symbol: 'hash', module: 'Game.exe', status: 'unique_match', matchCount: 1, matches: [{ offset: 8, address: '0x2008' }] },
      ],
    };

    const artifact = compareRestartSignatureArtifacts({ previous, current });

    assert.equal(artifact.comparisons.find((c) => c.signatureId === 'offset')?.classification, 'hash_changed');
    assert.equal(artifact.comparisons.find((c) => c.signatureId === 'multi')?.classification, 'not_unique');
    assert.equal(artifact.comparisons.find((c) => c.signatureId === 'hash')?.classification, 'hash_changed');
    assert.ok(artifact.comparisons.every((comparison) => comparison.certificationCandidate !== 'L3'));
  });

  test('rejects comparisons across different registries', () => {
    const previous: RuntimeSignatureValidationArtifact = {
      ...base,
      sessionId: 'before',
      signatureResults: [],
    };
    const current: RuntimeSignatureValidationArtifact = {
      ...base,
      registryId: `Other:${'d'.repeat(64)}`,
      sessionId: 'after',
      signatureResults: [],
    };

    assert.throws(() => compareRestartSignatureArtifacts({ previous, current }), /different registries/);
  });
});
