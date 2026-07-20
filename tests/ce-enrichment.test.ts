import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichCeScript } from '../src/core/script-research/ce-enrichment.ts';

describe('CE script enrichment', () => {
  test('extracts static CE script structures without executing syntax', () => {
    const record = enrichCeScript({
      name: 'Health Hook',
      path: 'Root > Health Hook',
      type: 'AutoAssembler_Script',
      executable: false,
      script_excerpt: '[ENABLE]',
      raw_script_content: `[ENABLE]
aobscanmodule(playerHealth,Game.exe,48 8B ??)
alloc(newmem,$1000,playerHealth)
label(code return originalcode)
define(healthOffset,playerHealth+07)
assert(playerHealth,48 8B 01)
readmem(playerHealth+07,5)
newmem:
code:
  mov [rax+000001B0],ecx
  jmp return
registersymbol(playerHealth)
[DISABLE]
unregistersymbol(playerHealth)`,
    });

    assert.equal(record.allocations[0]?.name, 'newmem');
    assert.ok(record.labels.includes('originalcode'));
    assert.ok(record.labels.includes('code'));
    assert.equal(record.defines[0]?.name, 'healthOffset');
    assert.equal(record.assertions[0]?.address, 'playerHealth');
    assert.equal(record.readmem[0]?.size, '5');
    assert.ok(record.registeredSymbols.includes('playerHealth'));
    assert.ok(record.unregisteredSymbols.includes('playerHealth'));
    assert.equal(record.enableDisablePairing.balanced, true);
    assert.ok(record.referencedOffsets.some((offset) => offset.expression === 'playerHealth+07'));
    assert.deepEqual(record.warnings, []);
  });

  test('warns on unbalanced enable-disable and symbol mismatches', () => {
    const record = enrichCeScript({
      name: 'Broken',
      path: 'Broken',
      type: 'AutoAssembler_Script',
      executable: false,
      script_excerpt: '[ENABLE]',
      raw_script_content: '[ENABLE]\nregistersymbol(orphan)',
    });

    assert.equal(record.enableDisablePairing.balanced, false);
    assert.match(record.warnings.join('\n'), /balanced/);
    assert.match(record.warnings.join('\n'), /not unregistered/);
  });
});
