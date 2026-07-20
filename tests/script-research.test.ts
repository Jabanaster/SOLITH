import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAaScript, normalizeCeAobPattern } from '../src/core/script-research/aa-script-analyzer.ts';
import {
  analyzeCheatTableScripts,
  extractCheatTableRawScriptCatalog,
} from '../src/core/script-research/ct-script-research.ts';
import { mergeDumpspaceWithScriptResearch } from '../src/core/ue-research/research-merge.ts';
import { buildDumpspaceImportSummary } from '../src/core/ue-research/dumpspace-import.ts';
import { buildSchemaDraftFromCandidates } from '../src/core/trainer-research/schema-draft.ts';
import { SCRIPT_RESEARCH_CHARTER } from '../src/core/script-research/types.ts';

const FRIENDSHIP_SCRIPT = `
[ENABLE]
aobscanmodule(INJECT_FAST_FRIENDSHIP,$process,74 ?? ?? 8B ?? 20 E8 ?? ?? ?? ?? 3C FE 7E ??)
alloc(newmem,$1000)
alloc(INJECT_FAST_FRIENDSHIPo, $F)
INJECT_FAST_FRIENDSHIP:
  jmp far newmem
code:
  cmp qword ptr [rax+20], 64
  jae short code
  mov qword ptr [rax+20], 64
registersymbol(INJECT_FAST_FRIENDSHIP INJECT_FAST_FRIENDSHIPo)
[DISABLE]
unregistersymbol(INJECT_FAST_FRIENDSHIP INJECT_FAST_FRIENDSHIPo)
`;

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const crimsonCt = path.join(fixtureDir, 'community-ct/CrimsonDesert.CT');
const dumpspaceDir = path.join(fixtureDir, 'ue-dumpspace-minimal');

describe('script-research analyzer', () => {
  test('normalizes CE ?? wildcards to Solith AOB tokens', () => {
    assert.equal(normalizeCeAobPattern('74 ?? ?? 8B ?? 20'), '74 ? ? 8B ? 20');
  });

  test('extracts friendship script AOB, symbols, and memory hints', () => {
    const analysis = analyzeAaScript('Fast friendship', FRIENDSHIP_SCRIPT, 'CrimsonDesert.exe');
    assert.ok(analysis);
    assert.equal(analysis!.aobScans[0]?.symbol, 'INJECT_FAST_FRIENDSHIP');
    assert.equal(analysis!.aobScans[0]?.module, 'CrimsonDesert.exe');
    assert.ok(analysis!.registeredSymbols.includes('INJECT_FAST_FRIENDSHIP'));
    assert.equal(analysis!.usesCodeInjection, true);
    assert.equal(analysis!.memoryOperandHints[0]?.offset, 0x20);
    assert.equal(analysis!.replicationStrategy, 'mixed');
    assert.ok(analysis!.workflowSteps.some((s) => /memory diff/i.test(s)));
    assert.ok(analysis!.workflowSteps.some((s) => /do not replicate hooks/i.test(s)));
  });

  test('parses Crimson Desert CT scripts without executing them', async () => {
    const xml = fs.readFileSync(crimsonCt, 'utf8');
    const report = await analyzeCheatTableScripts(xml, { title: 'Crimson Desert', executable: 'CrimsonDesert.exe' });
    assert.ok(report.analyzedScripts >= 10);
    const friendship = report.scripts.find((s) => /Fast friendship/i.test(s.cheatName));
    assert.ok(friendship);
    assert.ok(friendship!.aobScans.length > 0);
  });

  test('extracts nested raw CT scripts as inert metadata', async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatTableTitle>Avowed Research</CheatTableTitle>
  <CheatEntries>
    <CheatEntry>
      <Description>"[ENABLE] Steam 2.1"</Description>
      <CheatEntries>
        <CheatEntry>
          <Description>"Create Console"</Description>
          <CheatScript>[ENABLE]
aobscanmodule(console,Avowed-Win64-Shipping.exe,48 8B ?? ??)
[DISABLE]</CheatScript>
        </CheatEntry>
        <CheatEntry>
          <Description>"Lua helper"</Description>
          <LuaScript>print('metadata only')</LuaScript>
        </CheatEntry>
      </CheatEntries>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
    const catalog = await extractCheatTableRawScriptCatalog(xml, { title: 'Avowed' });
    assert.equal(catalog.catalogGameId, 'avowed');
    assert.equal(catalog.scripts.length, 2);
    assert.equal(catalog.scripts[0]?.name, 'Create Console');
    assert.equal(catalog.scripts[0]?.type, 'CheatScript_Metadata');
    assert.equal(catalog.scripts[0]?.executable, false);
    assert.match(catalog.scripts[0]?.raw_script_content ?? '', /aobscanmodule/);
    assert.equal(catalog.scripts[1]?.type, 'Lua_Script');
    assert.match(catalog.scripts[1]?.path ?? '', /\[ENABLE\] Steam 2\.1 > Lua helper/);
  });

  test('merges UEDumper members with script cheat names', async () => {
    const xml = fs.readFileSync(crimsonCt, 'utf8');
    const scriptReport = await analyzeCheatTableScripts(xml, { title: 'Palworld UE Research', executable: 'Palworld-Win64-Shipping.exe' });
    const summary = buildDumpspaceImportSummary({
      title: 'Palworld UE Research',
      executable: 'Palworld-Win64-Shipping.exe',
      offsetsJson: fs.readFileSync(path.join(dumpspaceDir, 'OffsetsInfo.json'), 'utf8'),
      classesJson: fs.readFileSync(path.join(dumpspaceDir, 'ClassesInfo.json'), 'utf8'),
    });
    const merged = mergeDumpspaceWithScriptResearch(summary, scriptReport);
    assert.ok(merged.length > 0);
    const hpScript = merged.find((m) => /hp/i.test(m.cheatName));
    assert.ok(hpScript?.ueClassMember?.includes('CurrentHP') || merged.some((m) => m.ueClassMember));
  });

  test('promotes verified diff candidates to freeze schema features', () => {
    const definition = buildSchemaDraftFromCandidates({
      title: 'Friendship Research',
      gameExecutable: 'CrimsonDesert.exe',
      candidates: [
        {
          id: 'friendship-1',
          address: '0x12345678',
          dataType: 'int32',
          baselineValue: 10,
          currentValue: 100,
          label: 'Fast friendship value',
          category: 'Game',
          featureType: 'freeze',
        },
      ],
    });
    assert.equal(definition.memoryFeatures?.[0]?.type, 'freeze');
  });

  test('charter allows analyzer and diff path, not injection', () => {
    assert.ok(SCRIPT_RESEARCH_CHARTER.notAuthorized.some((s) => /inject/i.test(s)));
    assert.ok(SCRIPT_RESEARCH_CHARTER.authorized.some((s) => /memory diff/i.test(s)));
  });
});
