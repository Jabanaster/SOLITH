import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferMemoryReader } from '../src/core/runtime/memory-reader.ts';
import { readMemoryView } from '../src/core/runtime/memory-viewer.ts';
import { captureMemorySnapshot, diffMemorySnapshots } from '../src/core/runtime/memory-snapshot.ts';

const moduleInfo = { name: 'Game.exe', baseAddress: 0x1000n, size: 8 };

describe('read-only memory research tools', () => {
  test('renders a hex/ascii memory view', async () => {
    const reader = new BufferMemoryReader({ 'Game.exe': Uint8Array.from([0x41, 0x42, 0, 0xff]) });
    const rows = await readMemoryView({ module: { ...moduleInfo, size: 4 }, reader, offset: 0, length: 4, bytesPerRow: 4 });

    assert.equal(rows[0]?.address, '0x1000');
    assert.equal(rows[0]?.hex, '41 42 00 FF');
    assert.equal(rows[0]?.ascii, 'AB..');
  });

  test('captures snapshots and diffs changed bytes', async () => {
    const before = await captureMemorySnapshot({
      id: 'before',
      module: { ...moduleInfo, size: 4 },
      reader: new BufferMemoryReader({ 'Game.exe': Uint8Array.from([1, 2, 3, 4]) }),
      offset: 0,
      length: 4,
      capturedAt: '2026-07-20T00:00:00.000Z',
    });
    const after = await captureMemorySnapshot({
      id: 'after',
      module: { ...moduleInfo, size: 4 },
      reader: new BufferMemoryReader({ 'Game.exe': Uint8Array.from([1, 9, 3, 8]) }),
      offset: 0,
      length: 4,
      capturedAt: '2026-07-20T00:00:01.000Z',
    });

    assert.deepEqual(diffMemorySnapshots(before, after), [
      { offset: 1, before: 2, after: 9 },
      { offset: 3, before: 4, after: 8 },
    ]);
  });
});
