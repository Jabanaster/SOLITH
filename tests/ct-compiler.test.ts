import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { compileCtDirectory, compileCtFile } from '../src/core/registry/compile-ct.ts';

function findRealCtFixtures(): string[] {
  const roots = [
    path.resolve('CE-Examples-master'),
    path.resolve('fixtures/community-ct'),
  ];
  const found: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        if (entry.isFile() && /\.ct$/i.test(entry.name)) found.push(full);
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

describe('real-world CT compiler', () => {
  test('compiles an available real .CT fixture into Schema Version 1 registry JSON', async () => {
    const fixtures = findRealCtFixtures();
    assert.ok(fixtures.length > 0, 'expected at least one .CT fixture in CE-Examples-master/ or fixtures/community-ct/');
    const ctPath = fixtures[0];
    const xml = fs.readFileSync(ctPath, 'utf8');
    const registry = await compileCtFile(ctPath, {
      game: 'CT Fixture',
      title: 'CT Fixture',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    assert.equal(registry.schemaVersion, '1.0.0');
    assert.equal(registry.artifact.schemaVersion, 1);
    assert.equal(registry.artifact.source.filename, path.basename(ctPath));
    assert.equal(registry.artifact.source.sha256, crypto.createHash('sha256').update(xml, 'utf8').digest('hex'));
    assert.equal(registry.artifact.counts.pointers, registry.pointers.accepted.length);
    assert.equal(registry.artifact.counts.scripts, registry.scripts.scripts.length);
    assert.equal(registry.artifact.counts.aobSignatures, registry.aobSignatures.length);
    assert.ok(registry.artifact.counts.pointers + registry.artifact.counts.scripts + registry.artifact.counts.rejections > 0);
    assert.ok(registry.scripts.scripts.every((script) => script.executable === false));
  });

  test('extracts CT XML fields, scripts, AOB signatures, rejections, warnings, and deterministic hashes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-real-ct-compiler-'));
    const ctPath = path.join(dir, 'Mixed.CT');
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatTableTitle>Mixed Realistic Table</CheatTableTitle>
  <CheatEntries>
    <CheatEntry>
      <ID>7</ID>
      <Description>"Health Pointer"</Description>
      <VariableType>Float</VariableType>
      <Address>"Game.exe"+1234</Address>
      <ShowAsHex>1</ShowAsHex>
      <Offsets>
        <Offset>18</Offset>
        <Offset>20</Offset>
      </Offsets>
    </CheatEntry>
    <CheatEntry>
      <ID>8</ID>
      <Description>"Health Script"</Description>
      <AssemblerScript>[ENABLE]
aobscanmodule(playerHealth,Game.exe,48 8B ?? 89)
alloc(newmem,$1000)
registersymbol(playerHealth)
[DISABLE]
unregistersymbol(playerHealth)</AssemblerScript>
    </CheatEntry>
    <CheatEntry>
      <ID>9</ID>
      <Description>"Missing Address"</Description>
      <VariableType>Float</VariableType>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
    fs.writeFileSync(ctPath, xml, 'utf8');

    const first = await compileCtFile(ctPath, {
      game: 'Mixed',
      title: 'Mixed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });
    const second = await compileCtFile(ctPath, {
      game: 'Mixed',
      title: 'Mixed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    assert.equal(first.pointers.accepted[0]?.ctId, '7');
    assert.equal(first.pointers.accepted[0]?.rawAddress, '"Game.exe"+1234');
    assert.equal(first.pointers.accepted[0]?.showAsHex, true);
    assert.deepEqual(first.pointers.accepted[0]?.pointerChain, [0x18, 0x20]);
    assert.equal(first.scripts.scripts[0]?.ctId, '8');
    assert.equal(first.scripts.scripts[0]?.executable, false);
    assert.match(first.scripts.scripts[0]?.script_excerpt ?? '', /\[ENABLE\]/);
    assert.equal(first.aobSignatures[0]?.symbol, 'playerHealth');
    assert.equal(first.aobSignatures[0]?.module, 'Game.exe');
    assert.equal(first.aobSignatures[0]?.normalizedPattern, '48 8B ?? 89');
    assert.ok(first.rejections.some((rejection) => /Missing Address/.test(rejection.name)));
    assert.equal(first.artifact.source.sha256, second.artifact.source.sha256);
    assert.deepEqual(first.aobSignatures.map((signature) => signature.id), second.aobSignatures.map((signature) => signature.id));
  });

  test('compiles all CT files in a directory deterministically', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-real-ct-dir-'));
    fs.writeFileSync(path.join(dir, 'A.CT'), '<CheatTable><CheatEntries /></CheatTable>', 'utf8');
    fs.writeFileSync(path.join(dir, 'B.ct'), '<CheatTable><CheatEntries /></CheatTable>', 'utf8');

    const registries = await compileCtDirectory(dir, {
      game: 'Directory Compile',
      title: 'Directory Compile',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    assert.deepEqual(registries.map((registry) => registry.sourceFile), ['A.CT', 'B.ct']);
  });
});
