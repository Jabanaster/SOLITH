import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSessionStability } from '../src/core/runtime/delta-engine.ts';
import { HEADLESS_VERIFICATION_PROTOCOL_VERSION, type HeadlessVerificationArtifact } from '../src/core/runtime/headless-verification.ts';

function artifact(overrides: Partial<HeadlessVerificationArtifact> = {}): HeadlessVerificationArtifact {
  return {
    protocolVersion: HEADLESS_VERIFICATION_PROTOCOL_VERSION,
    requestId: 'req',
    generatedAt: '2026-07-22T00:00:00.000Z',
    readOnly: true,
    executable: false,
    registrySource: {
      game: 'Delta Game',
      sourceFile: 'Delta.CT',
      sha256: 'a'.repeat(64),
      pipelineSchemaVersion: '1.2.0',
    },
    process: { pid: 1, executableName: 'Delta.exe', selectedByUser: true },
    aobResolution: {
      registryId: `Delta Game:${'a'.repeat(64)}`,
      sessionId: 'session-a',
      process: { pid: 1, executableName: 'Delta.exe', selectedByUser: true },
      moduleHashes: { 'Delta.exe': 'b'.repeat(64) },
      signatureResults: [],
      generatedAt: '2026-07-22T00:00:00.000Z',
      readOnly: true,
      executable: false,
      summary: {
        total: 0,
        byStatus: {
          not_tested: 0,
          no_match: 0,
          unique_match: 0,
          multiple_matches: 0,
          read_failure: 0,
          module_missing: 0,
        },
      },
    },
    pointerResults: [
      {
        entryId: 'health',
        label: 'Health',
        module: 'Delta.exe',
        rawAddress: 'Delta.exe+100',
        rootOffset: '0x100',
        pointerChainLength: 1,
        linkedAobIds: ['sig-health'],
        status: 'l2_resolved',
        reason: 'resolved',
        finalAddress: '0x500010',
        hops: [{ address: '0x401000', pointerValue: '0x500000', offset: '0x10', nextAddress: '0x500010' }],
      },
    ],
    summary: {
      aobSignatures: {
        total: 0,
        byStatus: {
          not_tested: 0,
          no_match: 0,
          unique_match: 0,
          multiple_matches: 0,
          read_failure: 0,
          module_missing: 0,
        },
      },
      pointers: {
        not_applicable: 0,
        schema_only: 0,
        module_missing: 0,
        invalid_offset: 0,
        root_in_module_range: 0,
        root_out_of_module_range: 0,
        l2_resolved: 1,
        l2_unreadable: 0,
        l2_invalid_chain: 0,
        helper_unavailable: 0,
      },
    },
    ...overrides,
  };
}

describe('offline delta comparison engine', () => {
  test('promotes ASLR-shifted pointer evidence when structural offsets remain stable', () => {
    const baseline = artifact();
    const current = artifact({
      requestId: 'req-b',
      process: { pid: 2, executableName: 'Delta.exe', selectedByUser: true },
      aobResolution: {
        ...baseline.aobResolution,
        sessionId: 'session-b',
        process: { pid: 2, executableName: 'Delta.exe', selectedByUser: true },
      },
      pointerResults: [
        {
          ...baseline.pointerResults[0]!,
          finalAddress: '0x700010',
          hops: [{ address: '0x601000', pointerValue: '0x700000', offset: '0x10', nextAddress: '0x700010' }],
        },
      ],
    });

    const result = evaluateSessionStability({ baseline, current });

    assert.equal(result.readOnly, true);
    assert.equal(result.executable, false);
    assert.deepEqual(result.promotedToL3, ['health']);
    assert.equal(result.summary.l3_stability_verified, 1);
    assert.equal(result.comparisons[0]?.previousFinalAddress, '0x500010');
    assert.equal(result.comparisons[0]?.currentFinalAddress, '0x700010');
  });

  test('flags all current nodes stale when registry or module hash evidence changes', () => {
    const baseline = artifact();
    const current = artifact({
      aobResolution: {
        ...baseline.aobResolution,
        sessionId: 'session-b',
        moduleHashes: { 'Delta.exe': 'c'.repeat(64) },
      },
    });

    const result = evaluateSessionStability({ baseline, current });

    assert.deepEqual(result.promotedToL3, []);
    assert.deepEqual(result.unstableWarnings, ['health']);
    assert.equal(result.comparisons[0]?.classification, 'executable_or_registry_changed');
  });

  test('flags non-L2, changed signature, changed hop count, and changed relative offset below L3', () => {
    const baseline = artifact({
      pointerResults: [
        artifact().pointerResults[0]!,
        { ...artifact().pointerResults[0]!, entryId: 'mana', label: 'Mana', linkedAobIds: ['sig-mana'] },
        { ...artifact().pointerResults[0]!, entryId: 'gold', label: 'Gold', linkedAobIds: ['sig-gold'], pointerChainLength: 2 },
      ],
    });
    const current = artifact({
      aobResolution: {
        ...baseline.aobResolution,
        sessionId: 'session-b',
      },
      pointerResults: [
        { ...baseline.pointerResults[0]!, status: 'l2_unreadable', reason: 'not readable' },
        { ...baseline.pointerResults[1]!, linkedAobIds: ['sig-other'] },
        { ...baseline.pointerResults[2]!, pointerChainLength: 1 },
      ],
    });

    const result = evaluateSessionStability({ baseline, current });

    assert.equal(result.comparisons.find((item) => item.ctEntryId === 'health')?.classification, 'not_l2_resolved');
    assert.equal(result.comparisons.find((item) => item.ctEntryId === 'mana')?.classification, 'signature_changed');
    assert.equal(result.comparisons.find((item) => item.ctEntryId === 'gold')?.classification, 'pointer_hops_changed');
    assert.equal(result.summary.l3_stability_verified, 0);
  });
});
