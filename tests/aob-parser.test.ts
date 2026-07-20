import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAOBsFromCatalog,
  extractAOBsFromScriptEntry,
} from '../src/core/script-research/aob-parser.ts';
import type { CtRawScriptCatalog, CtRawScriptCatalogEntry } from '../src/core/script-research/types.ts';

const ENTRY: CtRawScriptCatalogEntry = {
  name: 'Infinite Health',
  path: 'Avowed 2.0 AOB script > Infinite Health',
  type: 'AutoAssembler_Script',
  executable: false,
  raw_script_content: `[ENABLE]
aobscanmodule(playerHealth,Avowed-Win64-Shipping.exe,48 8B ?? * 89 45 F8)
label(returnHealth)
define(healthOffset,playerHealth+07)
playerHealth+07:
  mov [rax+000001B0],ecx
returnHealth:
registersymbol(playerHealth)
[DISABLE]
unregistersymbol(playerHealth)`,
};

describe('AOB parser', () => {
  test('extracts inert module AOB signatures with source identity and context hints', () => {
    const signatures = extractAOBsFromScriptEntry(ENTRY);

    assert.equal(signatures.length, 1);
    assert.equal(signatures[0]?.symbol, 'playerHealth');
    assert.equal(signatures[0]?.module, 'Avowed-Win64-Shipping.exe');
    assert.equal(signatures[0]?.scanType, 'aobscanmodule');
    assert.equal(signatures[0]?.pattern, '48 8B ?? * 89 45 F8');
    assert.equal(signatures[0]?.executable, false);
    assert.equal(signatures[0]?.sourceEntry, 'Infinite Health');
    assert.ok(signatures[0]?.nearbyLabels.includes('returnHealth'));
    assert.ok(signatures[0]?.nearbyOffsets.includes('+07'));
    assert.ok(signatures[0]?.nearbyOffsets.includes('+000001B0'));
    assert.ok(signatures[0]?.registeredSymbols.includes('playerHealth'));
    assert.equal(signatures[0]?.completeness, 'complete');
  });

  test('keeps process-wide and invalid scans separate with validation warnings', () => {
    const entry: CtRawScriptCatalogEntry = {
      ...ENTRY,
      raw_script_content: `[ENABLE]
aobscan(globalThing,AA BB ?? CC)
aobscanmodule(badThing,Game.exe,AA ZZ)
[DISABLE]`,
    };

    const signatures = extractAOBsFromScriptEntry(entry);

    assert.equal(signatures.length, 2);
    assert.equal(signatures[0]?.scanType, 'aobscan');
    assert.match(signatures[0]?.warnings.join('\n') ?? '', /does not declare a module/);
    assert.equal(signatures[0]?.completeness, 'complete');
    assert.equal(signatures[1]?.completeness, 'invalid');
    assert.match(signatures[1]?.warnings.join('\n') ?? '', /Invalid AOB token "ZZ"/);
  });

  test('marks duplicate normalized signatures across catalog scripts', () => {
    const catalog: CtRawScriptCatalog = {
      title: 'Avowed',
      catalogGameId: 'avowed',
      sourceNote: 'metadata only',
      scripts: [
        ENTRY,
        {
          ...ENTRY,
          name: 'Infinite Essence',
          path: 'Avowed 2.0 AOB script > Infinite Essence',
          raw_script_content: '[ENABLE]\naobscanmodule(playerEssence,Avowed-Win64-Shipping.exe,48 8B ?? * 89 45 F8)\n[DISABLE]',
        },
      ],
    };

    const report = extractAOBsFromCatalog(catalog, { extractedAt: '2026-07-20T00:00:00.000Z' });

    assert.equal(report.totalScripts, 2);
    assert.equal(report.totalSignatures, 2);
    assert.equal(report.duplicateSignatures, 1);
    assert.equal(report.signatures[1]?.duplicateOf, 'playerHealth');
    assert.match(report.warnings.join('\n'), /Duplicate signature pattern/);
  });
});
