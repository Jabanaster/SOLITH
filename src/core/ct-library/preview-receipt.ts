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
        | 'PREVIEW_RECEIPT_IN_USE'
        | 'PREVIEW_SELECTION_INVALID'
        | 'PREVIEW_SELECTION_DUPLICATE'
        | 'PREVIEW_SELECTION_TOO_LARGE';
    };

export interface CtPreviewReceiptStoreOptions {
  ttlMs?: number;
  now?: () => number;
  createId?: () => string;
  maxSelectionIds?: number;
}

export function createCtPreviewReceiptStore(options: CtPreviewReceiptStoreOptions = {}) {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const maxSelectionIds = options.maxSelectionIds ?? 5_000;
  const receipts = new Map<string, CtPreviewReceipt>();
  const reservedReceipts = new Set<string>();
  const revokedReservedReceipts = new Set<string>();

  function purgeExpired(): void {
    const currentTime = now();
    for (const [receiptId, receipt] of receipts) {
      if (receipt.expiresAt <= currentTime && !reservedReceipts.has(receiptId)) receipts.delete(receiptId);
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

    reserve(input: {
      receiptId: string;
      ownerId: number;
      selectionId: string;
      selectedIds: string[];
    }): ConsumeCtPreviewReceiptResult {
      const receipt = receipts.get(input.receiptId);
      if (!receipt) return { success: false, errorCode: 'PREVIEW_RECEIPT_NOT_FOUND' };
      if (reservedReceipts.has(receipt.receiptId)) {
        return { success: false, errorCode: 'PREVIEW_RECEIPT_IN_USE' };
      }
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

      if (input.selectedIds.length > maxSelectionIds) {
        return { success: false, errorCode: 'PREVIEW_SELECTION_TOO_LARGE' };
      }
      const selectedIds = [...new Set(input.selectedIds)];
      if (selectedIds.length !== input.selectedIds.length) {
        return { success: false, errorCode: 'PREVIEW_SELECTION_DUPLICATE' };
      }
      const allowed = new Set(receipt.allowedIds);
      if (selectedIds.length === 0 || selectedIds.some((id) => !allowed.has(id))) {
        return { success: false, errorCode: 'PREVIEW_SELECTION_INVALID' };
      }

      reservedReceipts.add(receipt.receiptId);
      return {
        success: true,
        receipt: { ...receipt, allowedIds: [...receipt.allowedIds] },
        selectedIds,
      };
    },

    commit(receiptId: string): boolean {
      if (!reservedReceipts.has(receiptId)) return false;
      reservedReceipts.delete(receiptId);
      revokedReservedReceipts.delete(receiptId);
      return receipts.delete(receiptId);
    },

    release(receiptId: string): void {
      reservedReceipts.delete(receiptId);
      if (revokedReservedReceipts.delete(receiptId)) receipts.delete(receiptId);
    },

    consume(input: {
      receiptId: string;
      ownerId: number;
      selectionId: string;
      selectedIds: string[];
    }): ConsumeCtPreviewReceiptResult {
      const result = this.reserve(input);
      if (result.success) this.commit(input.receiptId);
      return result;
    },

    revokeOwner(ownerId: number): void {
      for (const [receiptId, receipt] of receipts) {
        if (receipt.ownerId === ownerId) {
          if (reservedReceipts.has(receiptId)) revokedReservedReceipts.add(receiptId);
          else receipts.delete(receiptId);
        }
      }
    },
  };
}
