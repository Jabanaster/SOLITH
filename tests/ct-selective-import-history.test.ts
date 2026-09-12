import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import {
  createCtImportService,
  recoverCtImportTransaction,
  type CtImportServicePaths,
} from '../src/core/ct-library/selective-import.js';

const tableXml = (name: string) => `<?xml version="1.0"?>
<CheatTable><CheatEntries><CheatEntry><ID>1</ID><Description>"${name} Health"</Description>
<VariableType>4 Bytes</VariableType><Address>${name}.exe+10</Address></CheatEntry></CheatEntries></CheatTable>`;

async function writeZip(zipPath: string, entries: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const [entryPath, content] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(content), entryPath);
  }
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
  });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-ct-selective-'));
  const zipPath = path.join(root, 'inputs', 'tables.zip');
  await writeZip(zipPath, {
    'Games/Alpha/Alpha.CT': tableXml('Alpha'),
    'Games/Beta/Beta.CT': tableXml('Beta'),
    'Games/Gamma/Gamma.CT': tableXml('Gamma'),
  });
  const paths: CtImportServicePaths = {
    catalogPath: path.join(root, 'data', 'registry', 'personal-ct-catalog.index.json'),
    librarySummaryPath: path.join(root, 'data', 'ct-library', 'personal-ct-library.summary.json'),
    shardDirectory: path.join(root, 'data', 'ct-library', 'personal-ct-library-shards'),
    historyPath: path.join(root, 'data', 'ct-library', 'import-history.json'),
  };
  return { root, zipPath, paths };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

test('selective commit writes only explicitly selected preview tables and accurate durable history', async () => {
  const { zipPath, paths } = await fixture();
  const service = createCtImportService({ paths, createId: (() => {
    let id = 0;
    return () => `operation-${++id}`;
  })() });
  const preview = await service.preview({ ownerId: 7, selectionId: 'selection-a', archivePath: zipPath });
  assert.equal(preview.items.length, 3);

  const chosen = [preview.items[2].id, preview.items[0].id];
  const committed = await service.commit({
    ownerId: 7,
    selectionId: 'selection-a',
    receiptId: preview.receiptId,
    selectedIds: chosen,
  });
  assert.equal(committed.success, true);
  if (!committed.success) return;
  assert.equal(committed.importedCount, 2);
  assert.deepEqual(committed.selectedIds, [...chosen].sort());

  const catalog = await readJson<{ tables: Array<{ archivePath: string }> }>(paths.catalogPath);
  assert.deepEqual(catalog.tables.map((table) => table.archivePath), [
    'Games/Alpha/Alpha.CT',
    'Games/Gamma/Gamma.CT',
  ]);
  const history = await service.listHistory({ limit: 10, offset: 0 });
  assert.equal(history.total, 1);
  assert.equal(history.entries[0].status, 'succeeded');
  assert.equal(history.entries[0].selectedCount, 2);
  assert.deepEqual(history.entries[0].selectedItemIds, [...chosen].sort());
  assert.equal(JSON.stringify(history).includes(preview.receiptId), false);
  assert.equal(JSON.stringify(history).includes(zipPath), false);

  const restarted = createCtImportService({ paths });
  assert.equal((await restarted.getHistory(history.entries[0].historyId))?.importedCount, 2);
});

test('selection validation fails closed without mutation and does not consume a retryable receipt', async () => {
  const { zipPath, paths } = await fixture();
  const service = createCtImportService({ paths });
  const preview = await service.preview({ ownerId: 1, selectionId: 'selection-b', archivePath: zipPath });

  for (const selectedIds of [[], ['unknown'], [preview.items[0].id, preview.items[0].id]]) {
    const result = await service.commit({
      ownerId: 1,
      selectionId: 'selection-b',
      receiptId: preview.receiptId,
      selectedIds,
    });
    assert.equal(result.success, false);
    assert.equal(await fs.stat(paths.catalogPath).then(() => true, () => false), false);
  }

  const success = await service.commit({
    ownerId: 1,
    selectionId: 'selection-b',
    receiptId: preview.receiptId,
    selectedIds: [preview.items[1].id],
  });
  assert.equal(success.success, true);
  const consumed = await service.commit({
    ownerId: 1,
    selectionId: 'selection-b',
    receiptId: preview.receiptId,
    selectedIds: [preview.items[1].id],
  });
  assert.deepEqual(consumed, { success: false, errorCode: 'PREVIEW_RECEIPT_NOT_FOUND' });
});

test('an item ID from another receipt is rejected and concurrent reuse commits only once', async () => {
  const { zipPath, paths } = await fixture();
  const service = createCtImportService({ paths });
  const first = await service.preview({ ownerId: 11, selectionId: 'selection-first', archivePath: zipPath, limit: 1 });
  const second = await service.preview({ ownerId: 11, selectionId: 'selection-second', archivePath: zipPath });
  assert.equal((await service.commit({
    ownerId: 11,
    selectionId: 'selection-first',
    receiptId: first.receiptId,
    selectedIds: [second.items[1].id],
  })).success, false);

  const attempts = await Promise.all([
    service.commit({ ownerId: 11, selectionId: 'selection-second', receiptId: second.receiptId, selectedIds: [second.items[0].id] }),
    service.commit({ ownerId: 11, selectionId: 'selection-second', receiptId: second.receiptId, selectedIds: [second.items[0].id] }),
  ]);
  assert.equal(attempts.filter((result) => result.success).length, 1);
  assert.equal((await service.listHistory({ status: 'succeeded' })).total, 1);
});

test('wrong owner, wrong receipt selection, expiry, and oversized payload fail without mutation', async () => {
  const { zipPath, paths } = await fixture();
  let now = 1_000;
  const service = createCtImportService({ paths, now: () => now, receiptTtlMs: 100, maxSelectionIds: 2 });
  const preview = await service.preview({ ownerId: 2, selectionId: 'selection-c', archivePath: zipPath });

  assert.equal((await service.commit({ ownerId: 3, selectionId: 'selection-c', receiptId: preview.receiptId, selectedIds: [preview.items[0].id] })).success, false);
  assert.equal((await service.commit({ ownerId: 2, selectionId: 'wrong', receiptId: preview.receiptId, selectedIds: [preview.items[0].id] })).success, false);
  assert.equal((await service.commit({ ownerId: 2, selectionId: 'selection-c', receiptId: preview.receiptId, selectedIds: preview.items.map((item) => item.id) })).success, false);
  now = 1_101;
  assert.equal((await service.commit({ ownerId: 2, selectionId: 'selection-c', receiptId: preview.receiptId, selectedIds: [preview.items[0].id] })).success, false);
  assert.equal(await fs.stat(paths.catalogPath).then(() => true, () => false), false);
});

test('commit-time source mismatch is detected before mutation and recorded without secrets', async () => {
  const { zipPath, paths } = await fixture();
  const service = createCtImportService({ paths });
  const preview = await service.preview({ ownerId: 5, selectionId: 'selection-d', archivePath: zipPath });
  await writeZip(zipPath, { 'Games/Replaced/Replaced.CT': tableXml('Replaced') });

  const result = await service.commit({ ownerId: 5, selectionId: 'selection-d', receiptId: preview.receiptId, selectedIds: [preview.items[0].id] });
  assert.deepEqual(result, { success: false, errorCode: 'CT_IMPORT_SOURCE_CHANGED' });
  assert.equal(await fs.stat(paths.catalogPath).then(() => true, () => false), false);
  const history = await service.listHistory({ limit: 10, offset: 0, status: 'failed' });
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].status, 'failed');
  assert.equal(JSON.stringify(history).includes(preview.receiptId), false);
  assert.equal(JSON.stringify(history).includes(zipPath), false);
});

test('replacement failure rolls back catalog, library, shards, and success history', async () => {
  const { zipPath, paths } = await fixture();
  await fs.mkdir(path.dirname(paths.catalogPath), { recursive: true });
  await fs.mkdir(paths.shardDirectory, { recursive: true });
  await fs.writeFile(paths.catalogPath, '{"sentinel":"catalog"}');
  await fs.mkdir(path.dirname(paths.librarySummaryPath), { recursive: true });
  await fs.writeFile(paths.librarySummaryPath, '{"sentinel":"summary"}');
  await fs.writeFile(path.join(paths.shardDirectory, 'sentinel.txt'), 'shards');
  await fs.writeFile(paths.historyPath, '{"schemaVersion":1,"entries":[]}');

  const service = createCtImportService({
    paths,
    beforeReplace: (_target, index) => {
      if (index === 2) throw new Error('injected replacement failure');
    },
  });
  const preview = await service.preview({ ownerId: 6, selectionId: 'selection-e', archivePath: zipPath });
  const failed = await service.commit({ ownerId: 6, selectionId: 'selection-e', receiptId: preview.receiptId, selectedIds: [preview.items[0].id] });
  assert.equal(failed.success, false);
  assert.equal(await fs.readFile(paths.catalogPath, 'utf8'), '{"sentinel":"catalog"}');
  assert.equal(await fs.readFile(paths.librarySummaryPath, 'utf8'), '{"sentinel":"summary"}');
  assert.equal(await fs.readFile(path.join(paths.shardDirectory, 'sentinel.txt'), 'utf8'), 'shards');
  const history = await readJson<{ entries: Array<{ status: string }> }>(paths.historyPath);
  assert.equal(history.entries.some((entry) => entry.status === 'succeeded'), false);
});

test('history pagination is bounded, deterministic, filterable, and rejects malformed lookups', async () => {
  const { zipPath, paths } = await fixture();
  let now = 10_000;
  const service = createCtImportService({ paths, now: () => ++now });
  for (let index = 0; index < 3; index += 1) {
    const preview = await service.preview({ ownerId: 9, selectionId: `selection-${index}`, archivePath: zipPath });
    assert.equal((await service.commit({ ownerId: 9, selectionId: `selection-${index}`, receiptId: preview.receiptId, selectedIds: [preview.items[index].id] })).success, true);
  }
  const page = await service.listHistory({ limit: 2, offset: 0, status: 'succeeded', sourceType: 'zip-archive' });
  assert.equal(page.limit, 2);
  assert.equal(page.total, 3);
  assert.equal(page.entries.length, 2);
  assert.ok(page.entries[0].timestamp >= page.entries[1].timestamp);
  assert.equal(await service.getHistory('../invalid'), null);
});

test('durable transaction journal rolls back interruption and finalizes committed cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-ct-recovery-'));
  const journalPath = path.join(root, 'transaction.json');
  const targetA = path.join(root, 'a.json');
  const targetB = path.join(root, 'b.json');
  const backupA = `${targetA}.backup-op`;
  const backupB = `${targetB}.backup-op`;
  const stageA = `${targetA}.stage-op`;
  const stageB = `${targetB}.stage-op`;
  await fs.writeFile(targetA, 'new-a');
  await fs.writeFile(backupA, 'old-a');
  await fs.writeFile(targetB, 'old-b');
  await fs.writeFile(stageB, 'new-b');
  await fs.writeFile(journalPath, JSON.stringify({
    schemaVersion: 1,
    operationId: 'op',
    state: 'replacing',
    replacements: [
      { targetPath: targetA, backupPath: backupA, stagePath: stageA, hadOriginal: true, completed: true },
      { targetPath: targetB, backupPath: backupB, stagePath: stageB, hadOriginal: true, completed: false },
    ],
  }));
  assert.equal(await recoverCtImportTransaction(journalPath), 'rolled-back');
  assert.equal(await fs.readFile(targetA, 'utf8'), 'old-a');
  assert.equal(await fs.readFile(targetB, 'utf8'), 'old-b');
  assert.equal(await fs.stat(stageB).then(() => true, () => false), false);

  await fs.writeFile(targetA, 'committed-a');
  await fs.writeFile(backupA, 'old-a');
  await fs.writeFile(journalPath, JSON.stringify({
    schemaVersion: 1,
    operationId: 'op',
    state: 'committed',
    replacements: [
      { targetPath: targetA, backupPath: backupA, stagePath: stageA, hadOriginal: true, completed: true },
    ],
  }));
  assert.equal(await recoverCtImportTransaction(journalPath), 'finalized');
  assert.equal(await fs.readFile(targetA, 'utf8'), 'committed-a');
  assert.equal(await fs.stat(backupA).then(() => true, () => false), false);
});
