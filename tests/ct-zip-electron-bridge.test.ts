import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import { createCtZipPickerBridge } from '../src/core/ct-library/ct-zip-picker-bridge.js';
import { createCtImportSingleFlight } from '../src/core/ct-library/import-single-flight.js';
import { compileCtZipArchive } from '../src/core/registry/compile-ct-zip.js';

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    canonicalize: async (value: string) => path.resolve(value),
    stat: async () => ({ isFile: () => true }),
    validateSafety: () => ({ safe: true }),
    ...overrides,
  };
}

test('native picker bridge selects and resolves an owner-bound ZIP', async () => {
  const bridge = createCtZipPickerBridge(dependencies());
  const result = await bridge.pick(7, async () => ({ canceled: false, filePaths: ['C:/fixtures/valid.ZIP'] }));
  assert.equal(result.status, 'selected');
  if (result.status !== 'selected') return;
  assert.deepEqual(bridge.resolve(7, result.selectionId), {
    success: true,
    archivePath: path.resolve('C:/fixtures/valid.ZIP'),
  });
  assert.equal(bridge.resolve(8, result.selectionId).success, false);
});

test('native picker bridge distinguishes cancellation and picker failure', async () => {
  const bridge = createCtZipPickerBridge(dependencies());
  assert.deepEqual(
    await bridge.pick(1, async () => ({ canceled: true, filePaths: [] })),
    { status: 'cancelled' },
  );
  const failed = await bridge.pick(1, async () => { throw new Error('dialog failed'); });
  assert.equal(failed.status, 'error');
  if (failed.status === 'error') assert.equal(failed.errorCode, 'PICKER_FAILED');
});

test('native picker bridge rejects non-ZIP, missing, directory, and unsafe paths', async () => {
  const validDialog = async () => ({ canceled: false, filePaths: ['C:/fixtures/input.zip'] });
  const nonZip = await createCtZipPickerBridge(dependencies()).pick(
    1,
    async () => ({ canceled: false, filePaths: ['C:/fixtures/input.txt'] }),
  );
  assert.equal(nonZip.status === 'error' && nonZip.errorCode, 'REJECTED_FILE_TYPE');

  const missing = await createCtZipPickerBridge(dependencies({
    canonicalize: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  })).pick(1, validDialog);
  assert.equal(missing.status === 'error' && missing.errorCode, 'REJECTED_INVALID_PATH');

  const directory = await createCtZipPickerBridge(dependencies({
    stat: async () => ({ isFile: () => false }),
  })).pick(1, validDialog);
  assert.equal(directory.status === 'error' && directory.errorCode, 'REJECTED_NOT_FILE');

  const unsafe = await createCtZipPickerBridge(dependencies({
    validateSafety: () => ({ safe: false, reason: 'blocked fixture path' }),
  })).pick(1, validDialog);
  assert.equal(unsafe.status === 'error' && unsafe.errorCode, 'REJECTED_PATH_SAFETY');
});

test('selected ZIP reaches the existing CT ZIP importer', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-picker-'));
  const zipPath = path.join(tempDir, 'valid.zip');
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(
    '<CheatTable><CheatEntries><CheatEntry><ID>1</ID><Description>"Health"</Description><VariableType>4 Bytes</VariableType><Address>game.exe+10</Address></CheatEntry></CheatEntries></CheatTable>',
  ), 'Game/Game.CT');
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
  });

  const bridge = createCtZipPickerBridge({});
  const selected = await bridge.pick(9, async () => ({ canceled: false, filePaths: [zipPath] }));
  assert.equal(selected.status, 'selected');
  if (selected.status !== 'selected') return;
  const resolved = bridge.resolve(9, selected.selectionId);
  assert.equal(resolved.success, true);
  if (!resolved.success) return;
  const imported = await compileCtZipArchive(resolved.archivePath);
  assert.equal(imported.totals.compiledTables, 1);
});

test('single-flight guard prevents overlapping renderer submissions and restores state', async () => {
  const guard = createCtImportSingleFlight();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const first = guard.run(async () => pending);
  assert.deepEqual(await guard.run(async () => undefined), { started: false });
  release();
  assert.equal((await first).started, true);
  assert.equal((await guard.run(async () => 'again')).started, true);
});

test('production CT ZIP flow has no renderer File.path fallback and is token-wired', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const files = [
    'electron/ct-library-ipc.ts',
    'electron/preload.ts',
    'src/app/pages/CtLibraryExplorerPage.tsx',
  ];
  const sources = await Promise.all(files.map((file) => fs.readFile(path.join(root, file), 'utf8')));
  assert.equal(sources.some((source) => /File\.path|file\.path|\(files\[0\].*\.path/.test(source)), false);
  assert.match(sources[0], /pickerBridge\.pick/);
  assert.match(sources[0], /pickerBridge\.resolve/);
  assert.doesNotMatch(sources[0], /parsed\.data\.archivePath/);
  assert.match(sources[1], /selectionId: string/);
  assert.match(sources[2], /selectionId: picked\.selectionId/);
});

test('selective commit and history IPC remain main-window authorized and bounded', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const ipcSource = await fs.readFile(path.join(root, 'electron/ct-library-ipc.ts'), 'utf8');
  const preloadSource = await fs.readFile(path.join(root, 'electron/preload.ts'), 'utf8');
  assert.match(ipcSource, /validateIpcSender\(event, \['main'\]\)/);
  assert.match(ipcSource, /selectedIds: z\.array[\s\S]*\.max\(5_000\)/);
  assert.match(ipcSource, /receiptId: z\.string\(\)\.uuid\(\)/);
  assert.match(ipcSource, /importService\.commit\(\{/);
  assert.match(ipcSource, /ct-library-import-history-list/);
  assert.match(ipcSource, /limit: z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/);
  assert.match(ipcSource, /ct-library-import-history-detail/);
  assert.match(preloadSource, /receiptId: string/);
  assert.match(preloadSource, /selectedIds: string\[\]/);
  assert.doesNotMatch(ipcSource, /parsed\.data\.(archivePath|sourceSha256|tables|definitions)/);
});
