import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFeatureCandidates } from '../src/core/research/feature-candidates.ts';
import type { CompiledCtRegistry } from '../src/core/registry/load-registry.ts';

const registry = {
  schemaVersion: '1.0.0',
  artifact: {
    schemaVersion: 1,
    generatedAt: '2026-07-20T00:00:00.000Z',
    source: { path: 'Avowed.CT', filename: 'Avowed.CT', sha256: 'a'.repeat(64) },
    counts: { pointers: 1, scripts: 1, aobSignatures: 3, rejections: 0, warnings: 0, duplicates: 0 },
  },
  game: 'Avowed',
  sourceFile: 'Avowed.CT',
  compiledAt: '2026-07-20T00:00:00.000Z',
  metadata: { totalPointers: 1, totalScripts: 1, rejectedPointers: 0, pointerImportErrors: 0, totalAobSignatures: 3, aobWarnings: 0, duplicateAobSignatures: 0 },
  pointers: { title: 'Avowed', catalogGameId: 'avowed', accepted: [{ id: 'health-ptr', name: 'Current Health', category: 'Imported', dataType: 'float', moduleName: 'Game.exe', pointerChain: [] }], rejected: [], definition: {} as never, errors: [] },
  scripts: { title: 'Avowed', catalogGameId: 'avowed', sourceNote: 'metadata', scripts: [{ name: 'Avowed AOB', path: 'Avowed AOB', type: 'AutoAssembler_Script', executable: false, script_excerpt: '', raw_script_content: '' }] },
  aobSignatures: [
    { id: 'aob-health', symbol: 'aobDamageCalc', scanType: 'aobscanmodule', module: 'Game.exe', pattern: 'AA', normalizedPattern: 'AA', sourceEntryId: 'ct-script-0-avowed-aob', sourceEntryDescription: 'Avowed AOB', sourceScriptIndex: 0, lineNumber: 1, executable: false, warnings: [], completeness: 'complete', sourcePath: 'Avowed AOB' },
    { id: 'aob-stamina', symbol: 'aobStaminaCalc', scanType: 'aobscanmodule', module: 'Game.exe', pattern: 'BB', normalizedPattern: 'BB', sourceEntryId: 'ct-script-0-avowed-aob', sourceEntryDescription: 'Avowed AOB', sourceScriptIndex: 0, lineNumber: 2, executable: false, warnings: [], completeness: 'complete', sourcePath: 'Avowed AOB' },
    { id: 'aob-xp', symbol: 'aobXPGainCalc', scanType: 'aobscanmodule', module: 'Game.exe', pattern: 'CC', normalizedPattern: 'CC', sourceEntryId: 'ct-script-0-avowed-aob', sourceEntryDescription: 'Avowed AOB', sourceScriptIndex: 0, lineNumber: 3, executable: false, warnings: [], completeness: 'complete', sourcePath: 'Avowed AOB' },
  ],
  rejections: [],
} satisfies CompiledCtRegistry;

describe('feature candidate mapping', () => {
  test('derives unreviewed candidates from pointers and static AOB evidence', () => {
    const candidates = deriveFeatureCandidates(registry);

    const health = candidates.find((candidate) => candidate.id === 'candidate-health');
    const stamina = candidates.find((candidate) => candidate.id === 'candidate-stamina');
    const xp = candidates.find((candidate) => candidate.id === 'candidate-experience');

    assert.equal(health?.status, 'unreviewed');
    assert.equal(health?.confidence, 'high');
    assert.deepEqual(health?.pointerIds, ['health-ptr']);
    assert.ok(health?.aobSignatureIds.includes('aob-health'));
    assert.equal(stamina?.confidence, 'medium');
    assert.equal(xp?.name, 'Experience');
    assert.ok(xp?.evidence.some((line) => /aobXPGainCalc/.test(line)));
  });
});
