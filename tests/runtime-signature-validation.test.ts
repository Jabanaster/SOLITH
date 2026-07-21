import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferMemoryReader } from '../src/core/runtime/memory-reader.ts';
import { validateRegistrySignaturesReadOnly } from '../src/core/runtime/signature-validation.ts';
import type { CompiledCtRegistry } from '../src/core/registry/load-registry.ts';

const registry = {
  schemaVersion: '1.0.0',
  artifact: {
    schemaVersion: 1,
    generatedAt: '2026-07-20T00:00:00.000Z',
    source: { path: 'Avowed.CT', filename: 'Avowed.CT', sha256: 'a'.repeat(64) },
    counts: { pointers: 0, scripts: 0, aobSignatures: 4, rejections: 0, warnings: 0, duplicates: 0 },
  },
  game: 'Avowed',
  sourceFile: 'Avowed.CT',
  compiledAt: '2026-07-20T00:00:00.000Z',
  metadata: { totalPointers: 0, totalScripts: 0, rejectedPointers: 0, pointerImportErrors: 0, totalAobSignatures: 4, aobWarnings: 0, duplicateAobSignatures: 0 },
  pointers: { title: 'Avowed', catalogGameId: 'avowed', accepted: [], rejected: [], definition: {} as never, errors: [] },
  scripts: { title: 'Avowed', catalogGameId: 'avowed', sourceNote: '', scripts: [] },
  aobSignatures: [
    { id: 'unique', symbol: 'unique', scanType: 'aobscanmodule', module: 'Game.exe', pattern: 'AA BB', normalizedPattern: 'AA BB', sourceEntryId: null, sourceEntryDescription: 'Unique', sourceScriptIndex: 0, lineNumber: 1, executable: false, warnings: [], completeness: 'complete', sourcePath: 'Unique' },
    { id: 'multi', symbol: 'multi', scanType: 'aobscanmodule', module: 'Game.exe', pattern: 'CC DD', normalizedPattern: 'CC DD', sourceEntryId: null, sourceEntryDescription: 'Multi', sourceScriptIndex: 0, lineNumber: 1, executable: false, warnings: [], completeness: 'complete', sourcePath: 'Multi' },
    { id: 'missing', symbol: 'missing', scanType: 'aobscanmodule', module: 'Missing.exe', pattern: 'AA', normalizedPattern: 'AA', sourceEntryId: null, sourceEntryDescription: 'Missing', sourceScriptIndex: 0, lineNumber: 1, executable: false, warnings: [], completeness: 'complete', sourcePath: 'Missing' },
    { id: 'moduleless', symbol: 'moduleless', scanType: 'aobscan', module: null, pattern: 'AA', normalizedPattern: 'AA', sourceEntryId: null, sourceEntryDescription: 'Moduleless', sourceScriptIndex: 0, lineNumber: 1, executable: false, warnings: [], completeness: 'complete', sourcePath: 'Moduleless' },
  ],
  rejections: [],
} satisfies CompiledCtRegistry;

describe('runtime signature validation artifacts', () => {
  test('records read-only signature match statuses without mutating registry', async () => {
    const before = JSON.stringify(registry);
    const artifact = await validateRegistrySignaturesReadOnly({
      registry,
      sessionId: 'session-1',
      process: { pid: 10, executableName: 'Game.exe', selectedByUser: true },
      modules: [{ name: 'Game.exe', baseAddress: 0x1000n, size: 8, sha256: 'b'.repeat(64) }],
      reader: new BufferMemoryReader({ 'Game.exe': Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0xcc, 0xdd, 0x90, 0x90]) }),
    });

    assert.equal(artifact.registryId, `Avowed:${'a'.repeat(64)}`);
    assert.equal(artifact.moduleHashes['Game.exe'], 'b'.repeat(64));
    assert.equal(artifact.signatureResults.find((r) => r.signatureId === 'unique')?.status, 'unique_match');
    assert.equal(artifact.signatureResults.find((r) => r.signatureId === 'multi')?.status, 'multiple_matches');
    assert.equal(artifact.signatureResults.find((r) => r.signatureId === 'missing')?.status, 'module_missing');
    assert.equal(artifact.signatureResults.find((r) => r.signatureId === 'moduleless')?.status, 'not_tested');
    assert.equal(JSON.stringify(registry), before);
  });
});
