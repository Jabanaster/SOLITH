import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SAMPLE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable><CheatTableTitle>Avowed</CheatTableTitle><CheatEntries>
<CheatEntry><Description>"Health Script"</Description><CheatScript>[ENABLE]
aobscanmodule(playerHealth,Avowed-Win64-Shipping.exe,48 8B ?? 89)
[DISABLE]</CheatScript></CheatEntry>
</CheatEntries></CheatTable>`;

function run(args: string[], cwd: string): string {
  return execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', ...args], { cwd, encoding: 'utf8' });
}

describe('registry CLI tools', () => {
  test('compiles, inspects, and searches a registry artifact', () => {
    const cwd = path.resolve('.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-registry-cli-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    const registryPath = path.join(dir, 'registry.json');
    fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');

    const compileOut = run(['scripts/compile-ct-registry.mjs', ctPath, registryPath, 'Avowed'], cwd);
    assert.match(compileOut, /aobSignatures=1/);

    const inspectOut = run(['scripts/inspect-registry.mjs', '--registry', registryPath], cwd);
    assert.match(inspectOut, /Registry: Avowed/);
    assert.match(inspectOut, /AOB signatures: 1/);
    assert.match(inspectOut, /Warnings: 0/);

    const searchOut = run(['scripts/search-registry.mjs', '--registry', registryPath, '--type', 'aob', '--query', 'health'], cwd);
    assert.match(searchOut, /playerHealth/);
    assert.match(searchOut, /executable=false/);

    const csvOut = run(['scripts/search-registry.mjs', '--registry', registryPath, '--format', 'csv'], cwd);
    assert.match(csvOut, /id,type,title,module/);

    const mdOut = run(['scripts/search-registry.mjs', '--registry', registryPath, '--format', 'markdown'], cwd);
    assert.match(mdOut, /\| Type \| Title \| Module \|/);
  });
});
