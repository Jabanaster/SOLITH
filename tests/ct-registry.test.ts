import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileSolithCtRegistry } from '../src/core/registry/compile-ct-registry.ts';

const SAMPLE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatTableTitle>Avowed</CheatTableTitle>
  <CheatEntries>
    <CheatEntry>
      <Description>"Player Health"</Description>
      <VariableType>Float</VariableType>
      <Address>"Avowed-Win64-Shipping.exe"+1234</Address>
      <Offsets>
        <Offset>18</Offset>
      </Offsets>
    </CheatEntry>
    <CheatEntry>
      <Description>"Create Console"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(console,Avowed-Win64-Shipping.exe,48 8B ?? ??)
aobscan(globalConsole,48 8B * AA)
[DISABLE]</CheatScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"No Signature Script"</Description>
      <CheatScript>[ENABLE]
registersymbol(noSignatureOnly)
[DISABLE]</CheatScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

const EDGE_CASE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatTableTitle>Avowed</CheatTableTitle>
  <CheatEntries>
    <CheatEntry>
      <Description>"Duplicate One"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(firstDup,Avowed-Win64-Shipping.exe,AA BB ?? CC)
[DISABLE]</CheatScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"Duplicate Two"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(secondDup,Avowed-Win64-Shipping.exe,AA BB ?? CC)
[DISABLE]</CheatScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"Malformed"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(badSig,Avowed-Win64-Shipping.exe,AA ZZ)
[DISABLE]</CheatScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

describe('compileSolithCtRegistry', () => {
  test('combines pointer import and inert script catalog into one JSON payload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    const outPath = path.join(dir, 'Avowed_Master_Registry.json');
    fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');

    const registry = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      outputJsonPath: outPath,
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    assert.equal(registry.schemaVersion, '1.0.0');
    assert.equal(registry.pipeline.schema_version, '1.2.0');
    assert.equal(registry.pipeline.source.kind, 'ct-file');
    assert.equal(registry.pipeline.global_status.certification_level, 'L0');
    assert.equal(registry.pipeline.global_status.verification_cycles_completed, 0);
    assert.equal(registry.pipeline.entries[0]?.ct_entry_id, registry.pointers.accepted[0]?.id);
    assert.deepEqual(registry.pipeline.entries[0]?.address_data.pointer_chain, ['0x18']);
    assert.equal(registry.pipeline.aob_signatures[0]?.origin, 'ct-script-0-create-console');
    assert.equal(registry.pipeline.aob_signatures[0]?.signature_type, 'script-extracted');
    assert.equal(registry.pipeline.script_catalog_refs[0]?.catalog_storage_key, 'quarantine::ct-script-0-create-console::inert');
    assert.ok(registry.pipeline.script_catalog_refs[0]?.rejection_flags.includes('CONTAINS_SCRIPT_METADATA'));
    assert.equal(registry.game, 'Avowed');
    assert.equal(registry.sourceFile, 'Avowed.CT');
    assert.equal(registry.metadata.totalPointers, 1);
    assert.equal(registry.metadata.totalScripts, 2);
    assert.equal(registry.metadata.totalAobSignatures, 2);
    assert.equal(registry.metadata.aobWarnings, 1);
    assert.equal(registry.metadata.duplicateAobSignatures, 0);
    assert.equal(registry.pointers.accepted[0]?.name, 'Player Health');
    assert.equal(registry.scripts.scripts[0]?.name, 'Create Console');
    assert.equal(registry.scripts.scripts[0]?.executable, false);
    assert.equal(registry.scripts.scripts[1]?.name, 'No Signature Script');
    assert.equal(registry.aobSignatures.length, 2);
    assert.equal(registry.aobSignatures[0]?.symbol, 'console');
    assert.equal(registry.aobSignatures[0]?.module, 'Avowed-Win64-Shipping.exe');
    assert.equal(registry.aobSignatures[0]?.scanType, 'aobscanmodule');
    assert.equal(registry.aobSignatures[0]?.pattern, '48 8B ?? ??');
    assert.equal(registry.aobSignatures[0]?.normalizedPattern, '48 8B ?? ??');
    assert.equal(registry.aobSignatures[0]?.sourceEntryDescription, 'Create Console');
    assert.equal(registry.aobSignatures[0]?.sourceScriptIndex, 0);
    assert.equal(registry.aobSignatures[0]?.sourceEntryId, 'ct-script-0-create-console');
    assert.equal(registry.aobSignatures[0]?.executable, false);
    assert.equal(registry.aobSignatures[1]?.symbol, 'globalConsole');
    assert.equal(registry.aobSignatures[1]?.module, null);
    assert.equal(registry.aobSignatures[1]?.normalizedPattern, '48 8B * AA');
    assert.match(registry.aobSignatures[1]?.warnings.join('\n') ?? '', /does not declare a module/);
    assert.deepEqual(registry.rejections, registry.pointers.rejected);

    const written = JSON.parse(fs.readFileSync(outPath, 'utf8')) as typeof registry;
    assert.equal(written.metadata.totalPointers, 1);
    assert.equal(written.pipeline.schema_version, '1.2.0');
    assert.equal(written.scripts.scripts[0]?.executable, false);
    assert.equal(written.aobSignatures.length, 2);
  });

  test('PD-06: computed script -> AOB links are preserved, not discarded as []', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');

    const registry = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    const aobIds = registry.pipeline.aob_signatures.map((s) => s.aob_id);
    assert.equal(aobIds.length, 2);

    // Both AOB signatures were extracted from script index 0 ("Create Console");
    // that real, computed correlation must now show up on the script's ref
    // instead of being silently thrown away.
    const createConsoleRef = registry.pipeline.script_catalog_refs[0];
    assert.equal(createConsoleRef?.script_id, 'ct-script-0-create-console');
    assert.deepEqual([...(createConsoleRef?.linked_aob_ids ?? [])].sort(), [...aobIds].sort());

    // The second script has no AOB scans in it at all — genuinely empty, not fabricated.
    const noSignatureRef = registry.pipeline.script_catalog_refs[1];
    assert.equal(noSignatureRef?.script_id, 'ct-script-1-no-signature-script');
    assert.deepEqual(noSignatureRef?.linked_aob_ids, []);

    // Pointer entries never coexist with a script under the current importer
    // (a scripted CheatEntry is rejected before it can become an accepted
    // pointer), so these must stay empty rather than fabricate a link.
    for (const entry of registry.pipeline.entries) {
      assert.deepEqual(entry.linked_script_ids, []);
      assert.deepEqual(entry.linked_aob_ids, []);
    }
  });

  test('records manual-import user trust intent without granting runtime certification', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Manual.CT');
    fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');

    const registry = await compileSolithCtRegistry(ctPath, {
      game: 'Manual',
      title: 'Manual',
      compiledAt: '2026-07-20T00:00:00.000Z',
      sourceKind: 'manual-import',
      userCertified: true,
      localTrustSignature: 'solith_local_test_signature',
    });

    assert.equal(registry.pipeline.source.kind, 'manual-import');
    assert.equal(registry.pipeline.source.user_certified, true);
    assert.equal(registry.pipeline.global_status.certification_level, 'L0');
    assert.equal(registry.pipeline.global_status.local_trust_signature, 'solith_local_test_signature');
    assert.match(
      registry.pipeline.warnings.join('\n'),
      /manual_import_declared: still requires bounded read-only verification before L3 and L4 gates/,
    );
    assert.ok(registry.pipeline.entries.every((entry) => entry.entry_state.current_tier === 'L0'));
  });

  test('produces deterministic AOB IDs across repeated compilation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');

    const first = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });
    const second = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-21T00:00:00.000Z',
    });

    assert.deepEqual(
      first.aobSignatures.map((signature) => signature.id),
      second.aobSignatures.map((signature) => signature.id),
    );
  });

  test('keeps malformed and duplicate AOB signatures traceable without crashing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    fs.writeFileSync(ctPath, EDGE_CASE_CT, 'utf8');

    const registry = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    assert.equal(registry.metadata.totalPointers, 0);
    assert.equal(registry.metadata.totalScripts, 3);
    assert.equal(registry.metadata.totalAobSignatures, 3);
    assert.equal(registry.metadata.duplicateAobSignatures, 1);
    assert.ok(registry.metadata.aobWarnings >= 2);

    const duplicate = registry.aobSignatures.find((signature) => signature.symbol === 'secondDup');
    assert.equal(duplicate?.duplicateOf, 'firstDup');
    assert.match(duplicate?.warnings.join('\n') ?? '', /Duplicate signature pattern/);

    const malformed = registry.aobSignatures.find((signature) => signature.symbol === 'badSig');
    assert.equal(malformed?.completeness, 'invalid');
    assert.match(malformed?.warnings.join('\n') ?? '', /Invalid AOB token "ZZ"/);
  });
});
