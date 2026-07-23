import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import { buildCtLibraryIndex } from '../src/core/ct-library/index.js';
import {
  CtZipImportAbortError,
  compileCtZipArchive,
  validateZipEntryPath,
  type CtZipImportPhase,
} from '../src/core/registry/compile-ct-zip.js';

function writeZip(zipPath: string, entries: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [entryPath, content] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(content, 'utf8'), entryPath);
    }
    zip.end();
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
  });
}

const tableXml = (name: string, symbol: string) => `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <ID>1</ID>
      <Description>"${name} Health"</Description>
      <VariableType>Float</VariableType>
      <Address>${name}.exe+10</Address>
      <Offsets><Offset>8</Offset></Offsets>
    </CheatEntry>
    <CheatEntry>
      <ID>2</ID>
      <Description>"${name} Script"</Description>
      <VariableType>Auto Assembler Script</VariableType>
      <AssemblerScript>[ENABLE]
aobscanmodule(${symbol},${name}.exe,48 8B ?? ?? 89)
registersymbol(${symbol})
[DISABLE]</AssemblerScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

test('CT Library imports zip archives as metadata-only game cheat indexes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-ct-library-'));
  const zipPath = path.join(tempDir, 'personal-ct.zip');
  await writeZip(zipPath, {
    'My Games/Avowed/Avowed-Win64-Shipping.CT': tableXml('Avowed', 'playerHealth'),
    'My Games/Borderlands 3/Borderlands3.CT': tableXml('Borderlands3', 'goldValue'),
  });

  const compiled = await compileCtZipArchive(zipPath, {
    compiledAt: '2026-07-20T00:00:00.000Z',
  });
  const library = buildCtLibraryIndex(compiled);

  assert.equal(library.schemaVersion, 1);
  assert.equal(library.source.kind, 'zip-archive');
  assert.equal(library.safety.executableScripts, false);
  assert.equal(library.safety.memoryWrites, false);
  assert.equal(library.safety.processAttach, false);
  assert.equal(library.safety.certificationLevel, 'L0');
  assert.equal(library.safety.verificationStatus, 'metadata-only');
  assert.equal(library.totals.ctFiles, 2);
  assert.equal(library.totals.compiledTables, 2);
  assert.equal(library.totals.pointers, 2);
  assert.equal(library.totals.scripts, 2);
  assert.equal(library.totals.aobSignatures, 2);
  assert.equal(library.games.length, 2);
  assert.deepEqual(
    library.games.map((game) => [game.displayName, game.cheatCount]),
    [
      ['Avowed', 3],
      ['Borderlands 3', 3],
    ],
  );
  assert.equal(library.tables[0]?.cheats.every((cheat) => cheat.executable === false), true);
});

test('CT Library rejects unsafe zip CT entry paths before parsing', () => {
  assert.equal(validateZipEntryPath('Safe/Game.CT'), null);
  assert.equal(validateZipEntryPath('../Escape.CT'), 'zip entry path traversal is rejected');
  assert.equal(validateZipEntryPath('Safe/../Escape.CT'), 'zip entry path traversal is rejected');
  assert.equal(validateZipEntryPath('/Absolute.CT'), 'absolute zip entry paths are rejected');
  assert.equal(validateZipEntryPath('C:/Absolute.CT'), 'absolute zip entry paths are rejected');
  assert.equal(validateZipEntryPath('Bad\u0000Name.CT'), 'zip entry contains NUL byte');
});

test('CT Library zip compiler emits granular progress phases', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-ct-library-progress-'));
  const zipPath = path.join(tempDir, 'personal-ct.zip');
  await writeZip(zipPath, {
    'My Games/Avowed/Avowed-Win64-Shipping.CT': tableXml('Avowed', 'playerHealth'),
  });

  const phases: CtZipImportPhase[] = [];
  await compileCtZipArchive(zipPath, {
    compiledAt: '2026-07-20T00:00:00.000Z',
    outputJsonPath: path.join(tempDir, 'catalog.index.json'),
    onProgress: (progress) => phases.push(progress.phase),
  });

  assert.deepEqual(
    phases,
    ['hashing-source', 'extracting-archive', 'parsing-xml', 'scraping-signatures', 'writing-output', 'complete'],
  );
});

test('CT Library zip compiler cancellation rejects and wipes temp import sandbox', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-ct-library-cancel-'));
  const tempRoot = path.join(tempDir, 'sandboxes');
  const zipPath = path.join(tempDir, 'personal-ct.zip');
  await writeZip(zipPath, {
    'My Games/Avowed/Avowed-Win64-Shipping.CT': tableXml('Avowed', 'playerHealth'),
  });
  const controller = new AbortController();

  await assert.rejects(
    () => compileCtZipArchive(zipPath, {
      compiledAt: '2026-07-20T00:00:00.000Z',
      tempRoot,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'parsing-xml') controller.abort();
      },
    }),
    CtZipImportAbortError,
  );

  const remaining = await fs.readdir(tempRoot);
  assert.deepEqual(remaining, []);
});
