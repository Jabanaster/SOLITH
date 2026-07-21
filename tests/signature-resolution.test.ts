import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferMemoryReader } from '../src/core/runtime/memory-reader.ts';
import { scanModuleForSignature } from '../src/core/runtime/signature-scanner.ts';
import {
  resolveRegistrySignaturesReadOnly,
  summarizeSignatureResolution,
  type SignatureResolutionArtifact,
} from '../src/core/runtime/signature-resolution.ts';
import type { RuntimeModuleInfo } from '../src/core/runtime/module-inspection.ts';
import type { RuntimeProcessSummary } from '../src/core/runtime/process-discovery.ts';
import type { WindowsReadOnlyProcessSession } from '../src/core/runtime/windows-readonly-process-module-reader.ts';
import type { CompiledCtRegistry } from '../src/core/registry/load-registry.ts';

const registry = {
  schemaVersion: '1.0.0',
  artifact: {
    schemaVersion: 1,
    generatedAt: '2026-07-20T00:00:00.000Z',
    source: { path: 'Safe.CT', filename: 'Safe.CT', sha256: 'c'.repeat(64) },
    counts: { pointers: 0, scripts: 0, aobSignatures: 3, rejections: 0, warnings: 0, duplicates: 0 },
  },
  game: 'Safe Test',
  sourceFile: 'Safe.CT',
  compiledAt: '2026-07-20T00:00:00.000Z',
  metadata: {
    totalPointers: 0,
    totalScripts: 0,
    rejectedPointers: 0,
    pointerImportErrors: 0,
    totalAobSignatures: 3,
    aobWarnings: 0,
    duplicateAobSignatures: 0,
  },
  pointers: { title: 'Safe Test', catalogGameId: 'safe-test', accepted: [], rejected: [], definition: {} as never, errors: [] },
  scripts: { title: 'Safe Test', catalogGameId: 'safe-test', sourceNote: '', scripts: [] },
  aobSignatures: [
    {
      id: 'unique',
      symbol: 'unique',
      scanType: 'aobscanmodule',
      module: 'safe.exe',
      pattern: 'AA BB CC',
      normalizedPattern: 'AA BB CC',
      sourceEntryId: '1',
      sourceEntryDescription: 'Unique',
      sourceScriptIndex: 0,
      lineNumber: 1,
      executable: false,
      warnings: [],
      completeness: 'complete',
      sourcePath: 'Unique',
    },
    {
      id: 'zero',
      symbol: 'zero',
      scanType: 'aobscanmodule',
      module: 'safe.exe',
      pattern: 'FF EE DD',
      normalizedPattern: 'FF EE DD',
      sourceEntryId: '2',
      sourceEntryDescription: 'Zero',
      sourceScriptIndex: 0,
      lineNumber: 2,
      executable: false,
      warnings: [],
      completeness: 'complete',
      sourcePath: 'Zero',
    },
    {
      id: 'missing-module',
      symbol: 'missing',
      scanType: 'aobscanmodule',
      module: 'missing.exe',
      pattern: 'AA',
      normalizedPattern: 'AA',
      sourceEntryId: '3',
      sourceEntryDescription: 'Missing',
      sourceScriptIndex: 0,
      lineNumber: 3,
      executable: false,
      warnings: [],
      completeness: 'complete',
      sourcePath: 'Missing',
    },
  ],
  rejections: [],
} satisfies CompiledCtRegistry;

class FakeReadOnlySession extends BufferMemoryReader implements WindowsReadOnlyProcessSession {
  closed = false;
  readonly process: RuntimeProcessSummary = {
    pid: 456,
    executableName: 'safe.exe',
    executablePath: 'C:/Temp/safe.exe',
    selectedByUser: true,
  };

  constructor(private readonly modules: RuntimeModuleInfo[]) {
    super({ 'safe.exe': Uint8Array.from([0x90, 0xaa, 0xbb, 0xcc, 0x90]) });
  }

  getModules(): RuntimeModuleInfo[] {
    return this.modules;
  }

  close(): void {
    this.closed = true;
  }
}

class CappedChunkReader extends BufferMemoryReader {
  constructor(private readonly maxReadBytes: number, bytes: Uint8Array) {
    super({ 'chunk.exe': bytes });
  }

  override async readModuleBytes(module: RuntimeModuleInfo, offset: number, length: number): Promise<Uint8Array> {
    if (length > this.maxReadBytes) {
      throw new Error(`Read size ${length} exceeds cap ${this.maxReadBytes}.`);
    }
    return super.readModuleBytes(module, offset, length);
  }
}

describe('runtime signature resolution', () => {
  test('resolves a registry against an explicitly selected read-only process session and closes it', async () => {
    const session = new FakeReadOnlySession([
      { name: 'safe.exe', baseAddress: 0x5000n, size: 5, sha256: 'd'.repeat(64) },
    ]);

    const artifact = await resolveRegistrySignaturesReadOnly({
      registry,
      sessionId: 'session-safe',
      process: { pid: 456, executableName: 'safe.exe', selectedByUser: true },
      openSession: () => session,
      generatedAt: '2026-07-20T01:00:00.000Z',
    });

    assert.equal(session.closed, true);
    assert.equal(artifact.readOnly, true);
    assert.equal(artifact.executable, false);
    assert.equal(artifact.registryId, `Safe Test:${'c'.repeat(64)}`);
    assert.equal(artifact.generatedAt, '2026-07-20T01:00:00.000Z');
    assert.deepEqual(artifact.summary.byStatus, {
      not_tested: 0,
      no_match: 1,
      unique_match: 1,
      multiple_matches: 0,
      read_failure: 0,
      module_missing: 1,
    });
    assert.equal(artifact.signatureResults.find((result) => result.signatureId === 'unique')?.matches[0]?.address, '0x5001');
  });

  test('summarizes status counts for reporting', () => {
    const artifact = {
      signatureResults: [
        { status: 'unique_match' },
        { status: 'unique_match' },
        { status: 'multiple_matches' },
        { status: 'no_match' },
      ],
    } as SignatureResolutionArtifact;

    assert.deepEqual(summarizeSignatureResolution(artifact), {
      total: 4,
      byStatus: {
        not_tested: 0,
        no_match: 1,
        unique_match: 2,
        multiple_matches: 1,
        read_failure: 0,
        module_missing: 0,
      },
    });
  });

  test('requires explicit user process selection', async () => {
    await assert.rejects(
      () => resolveRegistrySignaturesReadOnly({
        registry,
        sessionId: 'session-safe',
        process: { pid: 456, executableName: 'safe.exe', selectedByUser: false },
        openSession: () => new FakeReadOnlySession([]),
      }),
      /explicitly selected/,
    );
  });

  test('scans large modules through bounded overlapping reads', async () => {
    const bytes = new Uint8Array((1024 * 1024) + 8);
    bytes.set([0xde, 0xad, 0xbe, 0xef], (1024 * 1024) - 2);

    const result = await scanModuleForSignature({
      module: { name: 'chunk.exe', baseAddress: 0x100000n, size: bytes.length },
      pattern: 'DE AD BE EF',
      reader: new CappedChunkReader(1024 * 1024, bytes),
      policy: {
        readOnly: true,
        requireExplicitProcessSelection: true,
        allowWrites: false,
        allowAutoAttach: false,
        allowPrivilegeEscalation: false,
        maxScanBytes: bytes.length,
        timeoutMs: 10_000,
      },
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.offset, (1024 * 1024) - 2);
    assert.equal(result.matches[0]?.address, '0x1ffffe');
  });
});
