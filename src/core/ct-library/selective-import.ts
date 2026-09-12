import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  compileCtZipArchive,
  type CompileCtZipOptions,
  type CtZipCatalogEntry,
  type CtZipCatalogIndex,
} from '../registry/compile-ct-zip.js';
import { createCtPreviewReceiptStore } from './preview-receipt.js';
import { writeCtLibraryIndex } from './write-library.js';

export interface CtImportServicePaths {
  catalogPath: string;
  librarySummaryPath: string;
  shardDirectory: string;
  historyPath: string;
}

export type CtImportHistoryStatus = 'succeeded' | 'failed' | 'cancelled' | 'rolled-back';

export interface CtImportHistoryEntry {
  historyId: string;
  operationId: string;
  timestamp: string;
  sourceType: 'zip-archive';
  sourceIdentifier: string;
  sourceSha256: string;
  selectedItemIds: string[];
  selectedCount: number;
  importedCount: number;
  skippedCount: number;
  failureCount: number;
  status: CtImportHistoryStatus;
  summary: string;
  schemaVersion: 1;
  importerVersion: 1;
  createdTableIds: string[];
  rollbackAvailable: boolean;
  warnings: string[];
  errorCode?: string;
}

interface CtImportHistoryDocument {
  schemaVersion: 1;
  entries: CtImportHistoryEntry[];
}

interface CtImportTransactionReplacement {
  stagePath: string;
  targetPath: string;
  backupPath: string;
  hadOriginal: boolean;
  completed: boolean;
}

interface CtImportTransactionJournal {
  schemaVersion: 1;
  operationId: string;
  state: 'replacing' | 'committed';
  replacements: CtImportTransactionReplacement[];
}

export interface CtImportPreviewItem {
  id: string;
  game: string;
  tableName: string;
  archivePath: string;
  counts: CtZipCatalogEntry['counts'];
}

export interface CtImportPreviewResult {
  receiptId: string;
  expiresAt: number;
  sourceSha256: string;
  filename: string;
  totals: CtZipCatalogIndex['totals'];
  rejected: CtZipCatalogIndex['rejected'];
  items: CtImportPreviewItem[];
}

export type CtImportCommitResult =
  | {
      success: true;
      historyId: string;
      operationId: string;
      selectedIds: string[];
      importedCount: number;
      skippedCount: number;
      totals: CtZipCatalogIndex['totals'];
    }
  | { success: false; errorCode: string };

interface TrustedPreview {
  ownerId: number;
  archivePath: string;
  filename: string;
  sourceSha256: string;
  index: CtZipCatalogIndex;
  itemIds: Map<string, CtZipCatalogEntry>;
}

export interface CreateCtImportServiceOptions {
  paths: CtImportServicePaths;
  now?: () => number;
  createId?: () => string;
  receiptTtlMs?: number;
  maxSelectionIds?: number;
  compileArchive?: typeof compileCtZipArchive;
  beforeReplace?: (targetPath: string, index: number) => void | Promise<void>;
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
}

function hashesMatch(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function ctPreviewItemId(table: CtZipCatalogEntry): string {
  const normalizedArchivePath = table.archivePath.replace(/\\/g, '/');
  const digest = createHash('sha256')
    .update(`${normalizedArchivePath}\0${table.sourceSha256.toLowerCase()}`, 'utf8')
    .digest('hex');
  return `ct-table-${digest}`;
}

function selectedIndex(index: CtZipCatalogIndex, selectedTables: CtZipCatalogEntry[]): CtZipCatalogIndex {
  const tables = [...selectedTables].sort((a, b) => a.archivePath.localeCompare(b.archivePath));
  return {
    ...index,
    totals: {
      ctFiles: tables.length,
      compiledTables: tables.length,
      rejectedTables: 0,
      pointers: tables.reduce((total, table) => total + table.counts.pointers, 0),
      scripts: tables.reduce((total, table) => total + table.counts.scripts, 0),
      aobSignatures: tables.reduce((total, table) => total + table.counts.aobSignatures, 0),
      cheats: tables.reduce((total, table) => total + table.cheats.length, 0),
    },
    tables,
    rejected: [],
  };
}

async function readHistory(historyPath: string): Promise<CtImportHistoryDocument> {
  try {
    const parsed = JSON.parse(await fs.readFile(historyPath, 'utf8')) as CtImportHistoryDocument;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error('ct_import_history_invalid');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, entries: [] };
    }
    throw error;
  }
}

async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function exists(targetPath: string): Promise<boolean> {
  return fs.stat(targetPath).then(() => true, () => false);
}

async function rollbackJournal(journal: CtImportTransactionJournal): Promise<void> {
  for (const replacement of [...journal.replacements].reverse()) {
    const backupExists = await exists(replacement.backupPath);
    const stageExists = await exists(replacement.stagePath);
    if (backupExists) {
      await fs.rm(replacement.targetPath, { recursive: true, force: true });
      await fs.rename(replacement.backupPath, replacement.targetPath);
    } else if (!replacement.hadOriginal && (replacement.completed || !stageExists)) {
      await fs.rm(replacement.targetPath, { recursive: true, force: true });
    }
    await fs.rm(replacement.stagePath, { recursive: true, force: true });
  }
}

export async function recoverCtImportTransaction(
  journalPath: string,
): Promise<'none' | 'rolled-back' | 'finalized'> {
  let journal: CtImportTransactionJournal;
  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as CtImportTransactionJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'none';
    throw new Error('ct_import_transaction_journal_invalid');
  }
  if (journal.schemaVersion !== 1 || !Array.isArray(journal.replacements)) {
    throw new Error('ct_import_transaction_journal_invalid');
  }
  if (journal.state === 'replacing') {
    await rollbackJournal(journal);
    await fs.rm(journalPath, { force: true });
    return 'rolled-back';
  }
  if (journal.state !== 'committed') throw new Error('ct_import_transaction_journal_invalid');
  for (const replacement of journal.replacements) {
    await fs.rm(replacement.backupPath, { recursive: true, force: true });
    await fs.rm(replacement.stagePath, { recursive: true, force: true });
  }
  await fs.rm(journalPath, { force: true });
  return 'finalized';
}

async function replacePreparedTargets(
  replacements: Array<{ stagePath: string; targetPath: string }>,
  operationId: string,
  journalPath: string,
  beforeReplace?: CreateCtImportServiceOptions['beforeReplace'],
): Promise<void> {
  const journal: CtImportTransactionJournal = {
    schemaVersion: 1,
    operationId,
    state: 'replacing',
    replacements: await Promise.all(replacements.map(async (replacement) => ({
      ...replacement,
      backupPath: `${replacement.targetPath}.backup-${operationId}`,
      hadOriginal: await exists(replacement.targetPath),
      completed: false,
    }))),
  };
  await atomicWriteJson(journalPath, journal);
  try {
    for (const [index, replacement] of journal.replacements.entries()) {
      await beforeReplace?.(replacement.targetPath, index);
      await fs.mkdir(path.dirname(replacement.targetPath), { recursive: true });
      await fs.rm(replacement.backupPath, { recursive: true, force: true });
      if (replacement.hadOriginal) await fs.rename(replacement.targetPath, replacement.backupPath);
      try {
        await fs.rename(replacement.stagePath, replacement.targetPath);
      } catch (error) {
        if (replacement.hadOriginal) await fs.rename(replacement.backupPath, replacement.targetPath);
        throw error;
      }
      replacement.completed = true;
      await atomicWriteJson(journalPath, journal);
    }
    journal.state = 'committed';
    await atomicWriteJson(journalPath, journal);
  } catch (error) {
    await rollbackJournal(journal);
    await fs.rm(journalPath, { force: true });
    throw error;
  }
  for (const replacement of journal.replacements) {
    await fs.rm(replacement.backupPath, { recursive: true, force: true });
  }
  await fs.rm(journalPath, { force: true });
}

function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
  }
  return 'CT_IMPORT_COMMIT_FAILED';
}

export function createCtImportService(options: CreateCtImportServiceOptions) {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const compileArchive = options.compileArchive ?? compileCtZipArchive;
  const receiptStore = createCtPreviewReceiptStore({
    now,
    createId,
    ttlMs: options.receiptTtlMs,
    maxSelectionIds: options.maxSelectionIds,
  });
  const trustedPreviews = new Map<string, TrustedPreview>();
  let commitQueue = Promise.resolve();
  const transactionJournalPath = `${options.paths.historyPath}.transaction.json`;
  const recoveryPromise = recoverCtImportTransaction(transactionJournalPath);

  async function appendFailure(entry: CtImportHistoryEntry): Promise<void> {
    const history = await readHistory(options.paths.historyPath);
    history.entries.push(entry);
    await atomicWriteJson(options.paths.historyPath, history);
  }

  function historyEntry(input: {
    historyId: string;
    operationId: string;
    preview: TrustedPreview;
    selectedIds: string[];
    status: CtImportHistoryStatus;
    importedCount: number;
    errorCode?: string;
  }): CtImportHistoryEntry {
    return {
      historyId: input.historyId,
      operationId: input.operationId,
      timestamp: new Date(now()).toISOString(),
      sourceType: 'zip-archive',
      sourceIdentifier: input.preview.filename,
      sourceSha256: input.preview.sourceSha256,
      selectedItemIds: [...input.selectedIds].sort(),
      selectedCount: input.selectedIds.length,
      importedCount: input.importedCount,
      skippedCount: input.preview.index.tables.length - input.selectedIds.length,
      failureCount: input.status === 'succeeded' ? 0 : 1,
      status: input.status,
      summary: input.status === 'succeeded'
        ? `Imported ${input.importedCount} selected CT table(s).`
        : 'CT import did not modify the library.',
      schemaVersion: 1,
      importerVersion: 1,
      createdTableIds: [],
      rollbackAvailable: false,
      warnings: [],
      errorCode: input.errorCode,
    };
  }

  async function commitInternal(input: {
    ownerId: number;
    selectionId: string;
    receiptId: string;
    selectedIds: string[];
    signal?: AbortSignal;
    onProgress?: CompileCtZipOptions['onProgress'];
    maxShardBytes?: number;
  }): Promise<CtImportCommitResult> {
    await recoveryPromise;
    const reserved = receiptStore.reserve(input);
    if (reserved.success === false) return reserved;
    const preview = trustedPreviews.get(input.receiptId);
    if (!preview) {
      receiptStore.release(input.receiptId);
      return { success: false, errorCode: 'PREVIEW_RECEIPT_NOT_FOUND' };
    }
    const selectedIds = [...reserved.selectedIds].sort();
    const operationId = createId();
    const historyId = createId();
    try {
      const revalidated = await compileArchive(preview.archivePath, {
        signal: input.signal,
        onProgress: input.onProgress,
      });
      if (!hashesMatch(revalidated.sourceArchive.sha256, reserved.receipt.sourceSha256)) {
        const failed = historyEntry({
          historyId,
          operationId,
          preview,
          selectedIds,
          status: 'failed',
          importedCount: 0,
          errorCode: 'CT_IMPORT_SOURCE_CHANGED',
        });
        await appendFailure(failed);
        return { success: false, errorCode: 'CT_IMPORT_SOURCE_CHANGED' };
      }

      const currentById = new Map(revalidated.tables.map((table) => [ctPreviewItemId(table), table]));
      const selectedTables = selectedIds.map((id) => currentById.get(id));
      if (selectedTables.some((table) => !table)) {
        return { success: false, errorCode: 'CT_IMPORT_PREVIEW_CHANGED' };
      }
      const index = selectedIndex(revalidated, selectedTables as CtZipCatalogEntry[]);
      const suffix = `${process.pid}-${operationId}`;
      const stagedCatalog = `${options.paths.catalogPath}.stage-${suffix}`;
      const stagedSummary = `${options.paths.librarySummaryPath}.stage-${suffix}`;
      const stagedShards = `${options.paths.shardDirectory}.stage-${suffix}`;
      const stagedHistory = `${options.paths.historyPath}.stage-${suffix}`;
      const stagedPaths = [stagedCatalog, stagedSummary, stagedShards, stagedHistory];
      try {
        await fs.mkdir(path.dirname(stagedCatalog), { recursive: true });
        await fs.writeFile(stagedCatalog, JSON.stringify(index, null, 2), 'utf8');
        await writeCtLibraryIndex(index, {
          libraryOutputPath: stagedSummary,
          shardDirectory: stagedShards,
          shardReferenceDirectory: options.paths.shardDirectory,
          maxShardBytes: input.maxShardBytes,
        });
        const history = await readHistory(options.paths.historyPath);
        history.entries.push(historyEntry({
          historyId,
          operationId,
          preview,
          selectedIds,
          status: 'succeeded',
          importedCount: index.tables.length,
        }));
        await fs.mkdir(path.dirname(stagedHistory), { recursive: true });
        await fs.writeFile(stagedHistory, JSON.stringify(history, null, 2), 'utf8');
        await replacePreparedTargets([
          { stagePath: stagedCatalog, targetPath: options.paths.catalogPath },
          { stagePath: stagedSummary, targetPath: options.paths.librarySummaryPath },
          { stagePath: stagedShards, targetPath: options.paths.shardDirectory },
          { stagePath: stagedHistory, targetPath: options.paths.historyPath },
        ], operationId, transactionJournalPath, options.beforeReplace);
      } finally {
        for (const stagedPath of stagedPaths) {
          await fs.rm(stagedPath, { recursive: true, force: true });
        }
      }
      if (!receiptStore.commit(input.receiptId)) {
        throw new Error('ct_import_receipt_commit_failed');
      }
      trustedPreviews.delete(input.receiptId);
      return {
        success: true,
        historyId,
        operationId,
        selectedIds,
        importedCount: index.tables.length,
        skippedCount: preview.index.tables.length - index.tables.length,
        totals: index.totals,
      };
    } catch (error) {
      const code = failureCode(error);
      try {
        await appendFailure(historyEntry({
          historyId,
          operationId,
          preview,
          selectedIds,
          status: code === 'ABORT_ERR' ? 'cancelled' : 'failed',
          importedCount: 0,
          errorCode: code,
        }));
      } catch {
        // Preserve the controlled import failure. History persistence failure is
        // reported by the generic commit code without exposing a local stack.
      }
      return { success: false, errorCode: code };
    } finally {
      receiptStore.release(input.receiptId);
    }
  }

  return {
    async preview(input: {
      ownerId: number;
      selectionId: string;
      archivePath: string;
      limit?: number;
      signal?: AbortSignal;
      onProgress?: CompileCtZipOptions['onProgress'];
    }): Promise<CtImportPreviewResult> {
      await recoveryPromise;
      const index = await compileArchive(input.archivePath, {
        limit: input.limit,
        signal: input.signal,
        onProgress: input.onProgress,
      });
      const itemIds = new Map(index.tables.map((table) => [ctPreviewItemId(table), table]));
      const receipt = receiptStore.issue({
        ownerId: input.ownerId,
        selectionId: input.selectionId,
        sourceSha256: index.sourceArchive.sha256,
        allowedIds: [...itemIds.keys()],
      });
      const trusted: TrustedPreview = {
        ownerId: input.ownerId,
        archivePath: path.resolve(input.archivePath),
        filename: path.basename(input.archivePath),
        sourceSha256: index.sourceArchive.sha256,
        index,
        itemIds,
      };
      trustedPreviews.set(receipt.receiptId, trusted);
      return {
        receiptId: receipt.receiptId,
        expiresAt: receipt.expiresAt,
        sourceSha256: receipt.sourceSha256,
        filename: trusted.filename,
        totals: index.totals,
        rejected: index.rejected,
        items: index.tables.map((table) => ({
          id: ctPreviewItemId(table),
          game: table.game,
          tableName: table.tableName,
          archivePath: table.archivePath,
          counts: table.counts,
        })),
      };
    },

    commit(input: Parameters<typeof commitInternal>[0]): Promise<CtImportCommitResult> {
      const result = commitQueue.then(() => commitInternal(input), () => commitInternal(input));
      commitQueue = result.then(() => undefined, () => undefined);
      return result;
    },

    async listHistory(input: {
      limit?: number;
      offset?: number;
      status?: CtImportHistoryStatus;
      sourceType?: 'zip-archive';
    } = {}) {
      await commitQueue;
      await recoveryPromise;
      const history = await readHistory(options.paths.historyPath);
      const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 25)));
      const offset = Math.max(0, Math.trunc(input.offset ?? 0));
      const entries = history.entries
        .filter((entry) => !input.status || entry.status === input.status)
        .filter((entry) => !input.sourceType || entry.sourceType === input.sourceType)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.historyId.localeCompare(a.historyId));
      return { total: entries.length, limit, offset, entries: entries.slice(offset, offset + limit) };
    },

    async getHistory(historyId: string): Promise<CtImportHistoryEntry | null> {
      if (!safeId(historyId)) return null;
      await commitQueue;
      await recoveryPromise;
      const history = await readHistory(options.paths.historyPath);
      return history.entries.find((entry) => entry.historyId === historyId) ?? null;
    },

    revokeOwner(ownerId: number): void {
      receiptStore.revokeOwner(ownerId);
      for (const [receiptId, preview] of trustedPreviews) {
        if (preview.ownerId === ownerId) trustedPreviews.delete(receiptId);
      }
    },
  };
}
