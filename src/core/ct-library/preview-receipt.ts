import { randomUUID } from 'node:crypto';

export interface CtPreviewReceipt {
  receiptId: string;
  ownerId: number;
  selectionId: string;
  sourceSha256: string;
  allowedIds: string[];
  expiresAt: number;
}

export interface CreateCtPreviewReceipt {
  ownerId: number;
  selectionId: string;
  sourceSha256: string;
  allowedIds: string[];
}

export type ConsumeCtPreviewReceiptResult =
  | {
      success: true;
      receipt: CtPreviewReceipt;
      selectedIds: string[];
    }
  | {
      success: false;
      errorCode:
        | 'PREVIEW_RECEIPT_NOT_FOUND'
        | 'PREVIEW_RECEIPT_OWNER_MISMATCH'
        | 'PREVIEW_RECEIPT_SELECTION_MISMATCH'
        | 'PREVIEW_RECEIPT_EXPIRED'
        | 'PREVIEW_SELECTION_INVALID';
    };

export interface CtPreviewReceiptStoreOptions {
  ttlMs?: number;
  now?: () => number;
  createId?: () => string;
}

export function createCtPreviewReceiptStore(options: CtPreviewReceiptStoreOptions = {}) {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const receipts = new Map<string, CtPreviewReceipt>();

  function purgeExpired(): void {
    const currentTime = now();
    for (const [receiptId, receipt] of receipts) {
      if (receipt.expiresAt <= currentTime) receipts.delete(receiptId);
    }
  }

  return {
    issue(input: CreateCtPreviewReceipt): CtPreviewReceipt {
      purgeExpired();
      const receipt: CtPreviewReceipt = {
        receiptId: createId(),
        ownerId: input.ownerId,
        selectionId: input.selectionId,
        sourceSha256: input.sourceSha256.toLowerCase(),
        allowedIds: [...new Set(input.allowedIds)].sort(),
        expiresAt: now() + ttlMs,
      };
      receipts.set(receipt.receiptId, receipt);
      return { ...receipt, allowedIds: [...receipt.allowedIds] };
    },

    consume(input: {
      receiptId: string;
      ownerId: number;
      selectionId: string;
      selectedIds: string[];
    }): ConsumeCtPreviewReceiptResult {
      const receipt = receipts.get(input.receiptId);
      if (!receipt) return { success: false, errorCode: 'PREVIEW_RECEIPT_NOT_FOUND' };
      if (receipt.ownerId !== input.ownerId) {
        return { success: false, errorCode: 'PREVIEW_RECEIPT_OWNER_MISMATCH' };
      }
      if (receipt.selectionId !== input.selectionId) {
        return { success: false, errorCode: 'PREVIEW_RECEIPT_SELECTION_MISMATCH' };
      }
      if (receipt.expiresAt <= now()) {
        receipts.delete(receipt.receiptId);
        return { success: false, errorCode: 'PREVIEW_RECEIPT_EXPIRED' };
      }

      const selectedIds = [...new Set(input.selectedIds)];
      const allowed = new Set(receipt.allowedIds);
      if (selectedIds.length === 0 || selectedIds.some((id) => !allowed.has(id))) {
        return { success: false, errorCode: 'PREVIEW_SELECTION_INVALID' };
      }

      receipts.delete(receipt.receiptId);
      return {
        success: true,
        receipt: { ...receipt, allowedIds: [...receipt.allowedIds] },
        selectedIds,
      };
    },

    revokeOwner(ownerId: number): void {
      for (const [receiptId, receipt] of receipts) {
        if (receipt.ownerId === ownerId) receipts.delete(receiptId);
      }
    },
  };
}
