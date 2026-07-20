import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import { buildCtLibraryIndex } from '../src/core/ct-library/index.js';
import { compileCtZipArchive } from '../src/core/registry/compile-ct-zip.js';

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
