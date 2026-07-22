import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADLESS_VERIFICATION_PROTOCOL_VERSION,
  handleHeadlessVerificationMessage,
  runHeadlessVerificationJob,
  verifyPipelinePointersReadOnly,
  type HeadlessVerificationRequest,
} from '../src/core/runtime/headless-verification.ts';
import { BufferMemoryReader } from '../src/core/runtime/memory-reader.ts';
import type { RuntimeModuleInfo } from '../src/core/runtime/module-inspection.ts';
import type { RuntimeProcessSummary } from '../src/core/runtime/process-discovery.ts';
import type { WindowsReadOnlyProcessSession } from '../src/core/runtime/windows-readonly-process-module-reader.ts';
import type { CompiledCtRegistry } from '../src/core/registry/load-registry.ts';

const pipeline = {
  $schema: 'https://solith.dev/schemas/ct-compiler-v1.2.0.json',
  schema_version: '1.2.0',
  compiled_at: '2026-07-22T00:00:00.000Z',
  source: {
    file: 'Safe.CT',
    sha256: 'e'.repeat(64),
    kind: 'ct-file',
  },
  global_status: {
    certification_level: 'L0',
    verification_cycles_completed: 0,
    last_monitored_pid: null,
  },
  entries: [
    {
      ct_entry_id: 'health',
      entry_path: ['Player', 'Health'],
      label: 'Health',
      type: 'Float',
      address_data: {
        base: 'safe.exe',
        root_offset: '0x2',
        raw_address: 'safe.exe+2',
        pointer_chain: ['0x18'],
        is_valid_math: true,
      },
      linked_script_ids: [],
      linked_aob_ids: ['aob-health'],
      entry_state: {
        current_tier: 'L0',
        proven_stable_sessions: 0,
      },
    },
    {
      ct_entry_id: 'gold',
      entry_path: ['Inventory', 'Gold'],
      label: 'Gold',
      type: '4 Bytes',
      address_data: {
        base: 'safe.exe',
        root_offset: '0x99',
        raw_address: 'safe.exe+99',
        pointer_chain: [],
        is_valid_math: true,
      },
      linked_script_ids: [],
      linked_aob_ids: [],
      entry_state: {
        current_tier: 'L0',
        proven_stable_sessions: 0,
      },
    },
    {
      ct_entry_id: 'bad',
      entry_path: ['Broken'],
      label: 'Bad Offset',
      type: 'Float',
      address_data: {
        base: 'safe.exe',
        root_offset: 'not-hex',
        raw_address: 'not-hex',
        pointer_chain: [],
        is_valid_math: false,
      },
      linked_script_ids: [],
      linked_aob_ids: [],
      entry_state: {
        current_tier: 'L0',
        proven_stable_sessions: 0,
      },
    },
  ],
  aob_signatures: [],
  script_catalog_refs: [],
  rejections: [],
  warnings: [],
} as const;

const registry = {
  schemaVersion: '1.0.0',
  artifact: {
    schemaVersion: 1,
    generatedAt: '2026-07-22T00:00:00.000Z',
    source: { path: 'Safe.CT', filename: 'Safe.CT', sha256: 'e'.repeat(64) },
    counts: { pointers: 3, scripts: 0, aobSignatures: 1, rejections: 0, warnings: 0, duplicates: 0 },
  },
  game: 'Safe Test',
  sourceFile: 'Safe.CT',
  compiledAt: '2026-07-22T00:00:00.000Z',
  metadata: {
    totalPointers: 3,
    totalScripts: 0,
    rejectedPointers: 0,
    pointerImportErrors: 0,
    totalAobSignatures: 1,
    aobWarnings: 0,
    duplicateAobSignatures: 0,
  },
  pointers: { title: 'Safe Test', catalogGameId: 'safe-test', accepted: [], rejected: [], definition: {} as never, errors: [] },
  scripts: { title: 'Safe Test', catalogGameId: 'safe-test', sourceNote: '', scripts: [] },
  aobSignatures: [
    {
      id: 'aob-health',
      symbol: 'health',
      scanType: 'aobscanmodule',
      module: 'safe.exe',
      pattern: 'AA BB CC',
      normalizedPattern: 'AA BB CC',
      sourceEntryId: 'health',
      sourceEntryDescription: 'Health',
      sourceScriptIndex: 0,
      lineNumber: 1,
      executable: false,
      warnings: [],
      completeness: 'complete',
      sourcePath: 'Health',
    },
  ],
  rejections: [],
  pipeline,
} satisfies CompiledCtRegistry;

class FakeReadOnlySession extends BufferMemoryReader implements WindowsReadOnlyProcessSession {
  closed = false;
  readonly process: RuntimeProcessSummary = {
    pid: 777,
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

function makeRequest(): HeadlessVerificationRequest {
  return {
    protocolVersion: HEADLESS_VERIFICATION_PROTOCOL_VERSION,
    requestId: 'job-1',
    type: 'VERIFY_REGISTRY_READONLY',
    registry,
    process: { pid: 777, executableName: 'safe.exe', selectedByUser: true },
    sessionId: 'session-1',
    generatedAt: '2026-07-22T01:00:00.000Z',
  };
}

describe('headless read-only verification', () => {
  test('runs AOB resolution and pointer preflight without enabling execution', async () => {
    const session = new FakeReadOnlySession([
      { name: 'safe.exe', baseAddress: 0x1000n, size: 5, sha256: 'f'.repeat(64) },
    ]);

    const artifact = await runHeadlessVerificationJob(makeRequest(), {
      openSession: () => session,
      now: () => '2026-07-22T01:00:00.000Z',
    });

    assert.equal(session.closed, true);
    assert.equal(artifact.readOnly, true);
    assert.equal(artifact.executable, false);
    assert.equal(artifact.aobResolution.summary.byStatus.unique_match, 1);
    assert.equal(artifact.summary.pointers.root_in_module_range, 1);
    assert.equal(artifact.summary.pointers.root_out_of_module_range, 1);
    assert.equal(artifact.summary.pointers.invalid_offset, 1);
    assert.match(
      artifact.pointerResults.find((result) => result.entryId === 'health')?.reason ?? '',
      /dereference remains disabled/,
    );
  });

  test('rejects non-explicit process selection through typed message handling', async () => {
    const response = await handleHeadlessVerificationMessage({
      ...makeRequest(),
      process: { pid: 777, executableName: 'safe.exe', selectedByUser: false },
    });

    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.match(response.error.message, /explicitly selected/);
    }
  });

  test('classifies module-missing pointer roots without reading target values', () => {
    const results = verifyPipelinePointersReadOnly(pipeline, [
      { name: 'other.exe', baseAddress: 0x1000n, size: 8 },
    ]);

    assert.equal(results.length, 3);
    assert.equal(results.every((result) => result.status === 'module_missing'), true);
  });
});
