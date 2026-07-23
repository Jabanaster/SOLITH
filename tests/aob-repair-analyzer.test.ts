import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeAobRepairCandidatesReadOnly,
  generateConservativeAobRepairPatterns,
} from '../src/core/runtime/aob-repair-analyzer.js';
import { BufferMemoryReader } from '../src/core/runtime/memory-reader.js';
import type { CompiledCtRegistry } from '../src/core/registry/loaded-registry.js';
import type { SignatureResolutionArtifact } from '../src/core/runtime/signature-resolution.js';

test('generateConservativeAobRepairPatterns produces bounded wildcard candidates', () => {
  const candidates = generateConservativeAobRepairPatterns(
    { normalizedPattern: '48 8B 01 02 03 89' },
    { maxCandidates: 4 },
  );

  assert.equal(candidates.length, 4);
  assert.equal(new Set(candidates.map((candidate) => candidate.pattern)).size, 4);
  assert.ok(candidates.every((candidate) => candidate.pattern.includes('??')));
  assert.ok(candidates.every((candidate) => candidate.wildcardedIndexes.length >= 1));
});

test('generateConservativeAobRepairPatterns skips patterns without concrete bytes', () => {
  const candidates = generateConservativeAobRepairPatterns(
    { normalizedPattern: '?? ?? *' },
    { maxCandidates: 8 },
  );

  assert.deepEqual(candidates, []);
});

test('analyzeAobRepairCandidatesReadOnly reports unique inert candidates without mutating registry entries', async () => {
  const registry = {
    schemaVersion: '1.0.0',
    game: 'Fixture',
    sourceFile: 'fixture.CT',
    compiledAt: '2026-07-23T00:00:00.000Z',
    artifact: {
      schemaVersion: 1,
      generatedAt: '2026-07-23T00:00:00.000Z',
      source: { path: 'fixture.CT', filename: 'fixture.CT', sha256: 'abc' },
      counts: { pointers: 0, scripts: 0, aobSignatures: 1, rejections: 0, warnings: 0, duplicates: 0 },
    },
    metadata: {
      totalPointers: 0,
      totalScripts: 0,
      rejectedPointers: 0,
      pointerImportErrors: 0,
      totalAobSignatures: 1,
      aobWarnings: 0,
      duplicateAobSignatures: 0,
    },
    pointers: { accepted: [], rejected: [], errors: [] },
    scripts: { title: 'Fixture', sourceNote: 'Fixture', extractedAt: '2026-07-23T00:00:00.000Z', scripts: [] },
    aobSignatures: [{
      id: 'aob-fixture',
      symbol: 'aobFixture',
      scanType: 'aobscanmodule',
      module: 'Fixture.exe',
      pattern: 'AA BB CC DD',
      normalizedPattern: 'AA BB CC DD',
      sourceEntryId: null,
      sourceEntryDescription: 'Fixture',
      sourceScriptIndex: 0,
      lineNumber: 1,
      executable: false,
      warnings: [],
      completeness: 'complete',
      sourcePath: 'Fixture',
    }],
    rejections: [],
  } satisfies CompiledCtRegistry;

  const artifact: SignatureResolutionArtifact = {
    registryId: 'Fixture:abc',
    sessionId: 'session-a',
    process: { pid: 1, executableName: 'Fixture.exe', selectedByUser: true },
    moduleHashes: {},
    signatureResults: [{
      signatureId: 'aob-fixture',
      symbol: 'aobFixture',
      module: 'Fixture.exe',
      status: 'no_match',
      matchCount: 0,
      matches: [],
    }],
    generatedAt: '2026-07-23T00:00:00.000Z',
    readOnly: true,
    executable: false,
    summary: {
      total: 1,
      byStatus: {
        not_tested: 0,
        no_match: 1,
        unique_match: 0,
        multiple_matches: 0,
        read_failure: 0,
        module_missing: 0,
      },
    },
  };

  const report = await analyzeAobRepairCandidatesReadOnly({
    registry,
    sourceArtifact: artifact,
    modules: [{ name: 'Fixture.exe', baseAddress: 0x1000n, size: 8 }],
    reader: new BufferMemoryReader({
      'Fixture.exe': Uint8Array.from([0xAA, 0xBB, 0x99, 0xDD, 0x11, 0x22, 0x33, 0x44]),
    }),
    maxCandidatesPerSignature: 4,
    generatedAt: '2026-07-23T00:00:00.000Z',
  });

  assert.equal(report.readOnly, true);
  assert.equal(report.executable, false);
  assert.equal(report.totals.uniqueCandidates, 1);
  assert.equal(report.signatures[0].recommendation, 'replace_candidate_requires_restart_validation');
  assert.equal(registry.aobSignatures[0].normalizedPattern, 'AA BB CC DD');
});

test('analyzeAobRepairCandidatesReadOnly refines ambiguous wildcard candidates from observed bytes', async () => {
  const registry = {
    schemaVersion: '1.0.0',
    game: 'Fixture',
    sourceFile: 'fixture.CT',
    compiledAt: '2026-07-23T00:00:00.000Z',
    artifact: {
      schemaVersion: 1,
      generatedAt: '2026-07-23T00:00:00.000Z',
      source: { path: 'fixture.CT', filename: 'fixture.CT', sha256: 'abc' },
      counts: { pointers: 0, scripts: 0, aobSignatures: 1, rejections: 0, warnings: 0, duplicates: 0 },
    },
    metadata: {
      totalPointers: 0,
      totalScripts: 0,
      rejectedPointers: 0,
      pointerImportErrors: 0,
      totalAobSignatures: 1,
      aobWarnings: 0,
      duplicateAobSignatures: 0,
    },
    pointers: { accepted: [], rejected: [], errors: [] },
    scripts: { title: 'Fixture', sourceNote: 'Fixture', extractedAt: '2026-07-23T00:00:00.000Z', scripts: [] },
    aobSignatures: [{
      id: 'aob-refine',
      symbol: 'aobRefine',
      scanType: 'aobscanmodule',
      module: 'Fixture.exe',
      pattern: 'AA BB CC DD',
      normalizedPattern: 'AA BB CC DD',
      sourceEntryId: null,
      sourceEntryDescription: 'Fixture',
      sourceScriptIndex: 0,
      lineNumber: 1,
      executable: false,
      warnings: [],
      completeness: 'complete',
      sourcePath: 'Fixture',
    }],
    rejections: [],
  } satisfies CompiledCtRegistry;

  const artifact: SignatureResolutionArtifact = {
    registryId: 'Fixture:abc',
    sessionId: 'session-a',
    process: { pid: 1, executableName: 'Fixture.exe', selectedByUser: true },
    moduleHashes: {},
    signatureResults: [{
      signatureId: 'aob-refine',
      symbol: 'aobRefine',
      module: 'Fixture.exe',
      status: 'no_match',
      matchCount: 0,
      matches: [],
    }],
    generatedAt: '2026-07-23T00:00:00.000Z',
    readOnly: true,
    executable: false,
    summary: {
      total: 1,
      byStatus: {
        not_tested: 0,
        no_match: 1,
        unique_match: 0,
        multiple_matches: 0,
        read_failure: 0,
        module_missing: 0,
      },
    },
  };

  const report = await analyzeAobRepairCandidatesReadOnly({
    registry,
    sourceArtifact: artifact,
    modules: [{ name: 'Fixture.exe', baseAddress: 0x1000n, size: 8 }],
    reader: new BufferMemoryReader({
      'Fixture.exe': Uint8Array.from([0xAA, 0xBB, 0x99, 0xDD, 0xAA, 0xBB, 0x88, 0xDD]),
    }),
    maxCandidatesPerSignature: 1,
    maxObservedRefinementsPerCandidate: 2,
    generatedAt: '2026-07-23T00:00:00.000Z',
  });

  const candidates = report.signatures[0].candidates;
  assert.equal(candidates[0].status, 'candidate_multiple_matches');
  assert.equal(candidates.filter((candidate) => candidate.status === 'candidate_unique_match').length, 2);
  assert.ok(candidates.some((candidate) => candidate.pattern === 'AA BB 99 DD'));
  assert.ok(candidates.some((candidate) => candidate.pattern === 'AA BB 88 DD'));
});
