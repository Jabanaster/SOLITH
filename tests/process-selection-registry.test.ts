import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProcessSelection,
  resolveProcessSelection,
  consumeProcessSelection,
  clearSelectionsForWindow,
  purgeExpiredSelections,
  _clearAllSelectionsForTests,
} from '../src/core/security/process-selection-registry.ts';

describe('process-selection-registry', () => {
  beforeEach(() => {
    _clearAllSelectionsForTests();
  });

  test('a selection resolves successfully from the same window before expiry', () => {
    const record = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 1 });
    const result = resolveProcessSelection(record.selectionId, 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.selection.pid, 1234);
      assert.equal(result.selection.executableName, 'game.exe');
    }
  });

  test('rejects an unknown selectionId', () => {
    const result = resolveProcessSelection('never-created', 1);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, 'unknown_selection');
  });

  test('rejects resolution from a different window than the one that created the selection', () => {
    const record = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 1 });
    const result = resolveProcessSelection(record.selectionId, 2);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, 'wrong_window');
  });

  test('rejects an expired selection', () => {
    const record = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 1, nowMs: 1_000_000, ttlMs: 100 });
    const result = resolveProcessSelection(record.selectionId, 1, 1_000_000 + 101);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, 'expired');
  });

  test('is still valid one ms before its TTL boundary (no off-by-one)', () => {
    const record = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 1, nowMs: 1_000_000, ttlMs: 100 });
    const result = resolveProcessSelection(record.selectionId, 1, 1_000_000 + 99);
    assert.equal(result.ok, true);
  });

  test('is reusable — resolving it twice within the TTL both succeed (deliberately not single-use)', () => {
    const record = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 1 });
    const first = resolveProcessSelection(record.selectionId, 1);
    const second = resolveProcessSelection(record.selectionId, 1);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  });

  test('consumeProcessSelection explicitly discards a selection', () => {
    const record = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 1 });
    consumeProcessSelection(record.selectionId);
    const result = resolveProcessSelection(record.selectionId, 1);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, 'unknown_selection');
  });

  test('clearSelectionsForWindow removes only that window\'s selections', () => {
    const a = createProcessSelection({ pid: 1234, executableName: 'a.exe', windowId: 1 });
    const b = createProcessSelection({ pid: 5678, executableName: 'b.exe', windowId: 2 });

    clearSelectionsForWindow(1);

    assert.equal(resolveProcessSelection(a.selectionId, 1).ok, false);
    assert.equal(resolveProcessSelection(b.selectionId, 2).ok, true);
  });

  test('purgeExpiredSelections removes only expired entries, never a still-valid one', () => {
    const expired = createProcessSelection({ pid: 1, executableName: 'x.exe', windowId: 1, nowMs: 0, ttlMs: 10 });
    const valid = createProcessSelection({ pid: 2, executableName: 'y.exe', windowId: 1, nowMs: 0, ttlMs: 100_000 });

    purgeExpiredSelections(50);

    assert.equal(resolveProcessSelection(expired.selectionId, 1, 50).ok, false);
    assert.equal(resolveProcessSelection(valid.selectionId, 1, 50).ok, true);
  });

  test('two different windows can hold independent selections for the same or different processes', () => {
    const a = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 1 });
    const b = createProcessSelection({ pid: 1234, executableName: 'game.exe', windowId: 2 });

    assert.equal(resolveProcessSelection(a.selectionId, 1).ok, true);
    assert.equal(resolveProcessSelection(b.selectionId, 2).ok, true);
    assert.equal(resolveProcessSelection(a.selectionId, 2).ok, false, 'window 2 must not be able to use window 1\'s selection');
  });
  test('authoritative selection preserves the complete process identity snapshot', () => {
    const record = createProcessSelection({
      pid: 1234, executableName: 'game.exe', executablePath: 'C:\\Games\\game.exe',
      processStartTime: '2026-07-27T00:00:00.000Z', volumeSerialNumber: 'VOL', fileIndex: 'IDX', exeSha256: 'abc', windowId: 1,
    });
    const resolved = resolveProcessSelection(record.selectionId, 1);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.deepEqual(
      { path: resolved.selection.executablePath, start: resolved.selection.processStartTime, volume: resolved.selection.volumeSerialNumber, index: resolved.selection.fileIndex, hash: resolved.selection.exeSha256 },
      { path: 'C:\\Games\\game.exe', start: '2026-07-27T00:00:00.000Z', volume: 'VOL', index: 'IDX', hash: 'abc' },
    );
  });

  test('verification source revalidates the stored identity immediately before worker execution', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../electron/registry-verification-ipc.ts', import.meta.url), 'utf8');
    assert.match(source, /compareProcessIdentity\([\s\S]*queryWindowsProcessIdentity\(pid\)/);
    assert.match(source, /selection_rejected:identity_mismatch/);
  });
});
