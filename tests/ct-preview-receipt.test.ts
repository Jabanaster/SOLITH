import assert from 'node:assert/strict';
import test from 'node:test';
import { createCtPreviewReceiptStore } from '../src/core/ct-library/preview-receipt.js';

test('preview receipt binds owner, selection, source hash, expiry, and selected IDs', () => {
  let currentTime = 1_000;
  const store = createCtPreviewReceiptStore({
    ttlMs: 500,
    now: () => currentTime,
    createId: () => 'receipt-1',
  });
  const receipt = store.issue({
    ownerId: 7,
    selectionId: 'selection-1',
    sourceSha256: 'A'.repeat(64),
    allowedIds: ['table-b', 'table-a', 'table-a'],
  });

  assert.equal(receipt.receiptId, 'receipt-1');
  assert.equal(receipt.sourceSha256, 'a'.repeat(64));
  assert.deepEqual(receipt.allowedIds, ['table-a', 'table-b']);
  assert.equal(
    store.consume({
      receiptId: receipt.receiptId,
      ownerId: 8,
      selectionId: 'selection-1',
      selectedIds: ['table-a'],
    }).success,
    false,
  );
  assert.equal(
    store.consume({
      receiptId: receipt.receiptId,
      ownerId: 7,
      selectionId: 'selection-2',
      selectedIds: ['table-a'],
    }).success,
    false,
  );
  assert.deepEqual(
    store.consume({
      receiptId: receipt.receiptId,
      ownerId: 7,
      selectionId: 'selection-1',
      selectedIds: ['unknown'],
    }),
    { success: false, errorCode: 'PREVIEW_SELECTION_INVALID' },
  );

  currentTime = 1_501;
  assert.deepEqual(
    store.consume({
      receiptId: receipt.receiptId,
      ownerId: 7,
      selectionId: 'selection-1',
      selectedIds: ['table-a'],
    }),
    { success: false, errorCode: 'PREVIEW_RECEIPT_EXPIRED' },
  );
});

test('preview receipt is single-use and permits a selective subset', () => {
  const store = createCtPreviewReceiptStore({ createId: () => 'receipt-2' });
  store.issue({
    ownerId: 4,
    selectionId: 'selection-2',
    sourceSha256: 'b'.repeat(64),
    allowedIds: ['one', 'two'],
  });

  const consumed = store.consume({
    receiptId: 'receipt-2',
    ownerId: 4,
    selectionId: 'selection-2',
    selectedIds: ['two'],
  });
  assert.equal(consumed.success, true);
  if (consumed.success) assert.deepEqual(consumed.selectedIds, ['two']);
  assert.deepEqual(
    store.consume({
      receiptId: 'receipt-2',
      ownerId: 4,
      selectionId: 'selection-2',
      selectedIds: ['one'],
    }),
    { success: false, errorCode: 'PREVIEW_RECEIPT_NOT_FOUND' },
  );
});
