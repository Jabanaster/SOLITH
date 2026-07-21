import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferMemoryReader } from '../src/core/runtime/memory-reader.ts';
import { assertExplicitProcessSelection } from '../src/core/runtime/process-discovery.ts';
import { assertReadOnlyPolicy } from '../src/core/runtime/runtime-policy.ts';
import { parseAobPattern, scanModuleForSignature } from '../src/core/runtime/signature-scanner.ts';

const moduleInfo = { name: 'Avowed-Win64-Shipping.exe', baseAddress: 0x1000n, size: 8 };

describe('read-only runtime foundation', () => {
  test('requires explicit process selection and read-only policy', () => {
    assert.doesNotThrow(() => assertExplicitProcessSelection({ pid: 10, executableName: 'Game.exe', selectedByUser: true }));
    assert.throws(() => assertExplicitProcessSelection({ pid: 10, executableName: 'Game.exe', selectedByUser: false }), /explicitly selected/);
    assert.doesNotThrow(() => assertReadOnlyPolicy());
    assert.throws(() => assertReadOnlyPolicy({ readOnly: false, requireExplicitProcessSelection: true, allowWrites: true, allowAutoAttach: false, allowPrivilegeEscalation: false, maxScanBytes: 10, timeoutMs: 10 }), /read-only/);
  });

  test('parses AOB patterns and scans only provided module bytes', async () => {
    assert.deepEqual(parseAobPattern('48 8B ?? * 89').map((token) => token.value), [0x48, 0x8b, null, null, 0x89]);

    const reader = new BufferMemoryReader({
      'Avowed-Win64-Shipping.exe': Uint8Array.from([0x90, 0x48, 0x8b, 0x01, 0xaa, 0x89, 0x90, 0x90]),
    });
    const result = await scanModuleForSignature({
      module: moduleInfo,
      pattern: '48 8B ?? * 89',
      reader,
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.offset, 1);
    assert.equal(result.matches[0]?.address, '0x1001');
    assert.equal(result.timedOut, false);
  });

  test('enforces module bounds and scan limits', async () => {
    const reader = new BufferMemoryReader({
      'Avowed-Win64-Shipping.exe': Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]),
    });
    const result = await scanModuleForSignature({
      module: { ...moduleInfo, size: 4 },
      pattern: 'CC DD',
      reader,
      policy: { readOnly: true, requireExplicitProcessSelection: true, allowWrites: false, allowAutoAttach: false, allowPrivilegeEscalation: false, maxScanBytes: 2, timeoutMs: 1000 },
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.truncated, true);
  });
});
