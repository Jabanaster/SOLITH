import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import { importDefinitionCt, previewDefinitionCt } from '../src/core/definitions/import-definition-ct.ts';
import { parseCheatTableMetadata } from '../src/core/definitions/ct-metadata.ts';
import {
  analyzeCheatTableScripts,
  extractCheatTableRawScriptCatalog,
} from '../src/core/script-research/ct-script-research.ts';

// Independent security review, Finding 1 (CRITICAL) against frozen candidate
// ef254d1: parseCheatTableXml() validated raw XML, but importDefinitionCt()/
// previewDefinitionCt() reparsed the SAME raw, unvalidated xmlText via
// parseCheatTableMetadata()/analyzeCheatTableScripts() whenever
// parsed.accepted.length === 0 — a condition true both for "legit table with
// no supported entries" and "XML safety rejected the input". Malicious .CT
// payloads always produce accepted.length === 0 (the main parser rejects
// them before any entry is accepted), so every one of these RED-first cases
// previously reached xml2js.parseStringPromise() with zero size/DOCTYPE/
// entity/depth protection. These tests prove the fallback path itself now
// enforces the same boundary, not just the main parser (already covered by
// ct-import-security.test.ts).

const OVERSIZED_FILLER = 'A'.repeat(11 * 1024 * 1024);

function xxePayload(): string {
  return `<?xml version="1.0"?>
<!DOCTYPE CheatTable [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>&xxe;</Description>
      <AutoAssemblerScript>reject me so accepted stays empty</AutoAssemblerScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
}

function bareDoctypePayload(): string {
  return `<?xml version="1.0"?>
<!DOCTYPE CheatTable>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>"bare doctype"</Description>
      <AutoAssemblerScript>reject me so accepted stays empty</AutoAssemblerScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
}

function billionLaughsPayload(): string {
  return `<?xml version="1.0"?>
<!DOCTYPE CheatTable [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>&lol2;</Description>
      <AutoAssemblerScript>reject me so accepted stays empty</AutoAssemblerScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
}

function oversizedPayload(): string {
  return `<?xml version="1.0"?>\n<CheatTable><CheatEntries><CheatEntry><Description>"${OVERSIZED_FILLER}"</Description><AutoAssemblerScript>reject me</AutoAssemblerScript></CheatEntry></CheatEntries></CheatTable>`;
}

function deepNestingPayload(): string {
  // See xml.ts — limit recalibrated to 256 after this fix exposed real
  // CrimsonDesert.CT-style tables nesting to depth 75. 300 stays a clear,
  // deliberate exceedance of the new limit.
  const depth = 300;
  let xml = '<?xml version="1.0"?>\n<CheatTable><CheatEntries>';
  for (let i = 0; i < depth; i++) xml += '<CheatEntry><CheatEntries>';
  xml +=
    '<CheatEntry><Description>"deep"</Description><AutoAssemblerScript>reject me</AutoAssemblerScript></CheatEntry>';
  for (let i = 0; i < depth; i++) xml += '</CheatEntries></CheatEntry>';
  xml += '</CheatEntries></CheatTable>';
  return xml;
}

const MALICIOUS_CASES: Array<{ name: string; xml: () => string }> = [
  { name: 'external entity (XXE / SYSTEM)', xml: xxePayload },
  { name: 'bare DOCTYPE with no ENTITY/SYSTEM/PUBLIC', xml: bareDoctypePayload },
  { name: 'entity-expansion ("billion laughs")', xml: billionLaughsPayload },
  { name: 'oversized payload (> 10MB)', xml: oversizedPayload },
  { name: 'extreme nesting depth', xml: deepNestingPayload },
];

describe('.CT fallback/metadata path — Finding 1 XML safety boundary', () => {
  before(async () => {
    await initDatabase();
  });

  for (const { name, xml } of MALICIOUS_CASES) {
    test(`importDefinitionCt rejects ${name} even though accepted.length === 0`, async () => {
      const result = await importDefinitionCt(xml(), { title: 'Malicious Fallback Test' });
      assert.equal(result.success, false);
      if (result.success === false) {
        assert.ok(
          result.errors.some((e) => /xml_safety_violation/i.test(e)),
          `expected xml_safety_violation, got: ${result.errors.join(',')}`,
        );
        assert.ok(
          !result.errors.includes('no_importable_ct_entries'),
          'safety rejection must not be reported as "no importable entries"',
        );
      }
    });

    test(`previewDefinitionCt rejects ${name} even though accepted.length === 0`, async () => {
      const result = await previewDefinitionCt(xml(), { title: 'Malicious Fallback Test' });
      assert.equal(result.success, false);
      if (result.success === false) {
        assert.ok(result.errors.some((e) => /xml_safety_violation/i.test(e)));
      }
    });

    test(`parseCheatTableMetadata itself rejects ${name} (direct call, no upstream gate)`, async () => {
      await assert.rejects(() => parseCheatTableMetadata(xml(), { title: 'Direct Metadata Test' }), /xml_safety_violation/i);
    });

    test(`analyzeCheatTableScripts itself rejects ${name} (renderer-reachable via trainer-research-analyze-ct-scripts)`, async () => {
      await assert.rejects(() => analyzeCheatTableScripts(xml(), { title: 'Direct Script Research Test' }), /xml_safety_violation/i);
    });

    test(`extractCheatTableRawScriptCatalog itself rejects ${name} (used by compile-ct-zip/registry build tools)`, async () => {
      await assert.rejects(() => extractCheatTableRawScriptCatalog(xml(), { title: 'Direct Raw Catalog Test' }), /xml_safety_violation/i);
    });
  }

  test('a legitimate table with zero accepted pointer entries still imports via metadata fallback (no regression)', async () => {
    const validMetadataOnly = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>"Auto Fill HP"</Description>
      <AutoAssemblerScript>[ENABLE]\nnop\n[DISABLE]</AutoAssemblerScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"Fast friendship"</Description>
      <AutoAssemblerScript>[ENABLE]\nnop\n[DISABLE]</AutoAssemblerScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
    const result = await importDefinitionCt(validMetadataOnly, { title: 'Valid Metadata Only' });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.metadataImport, true);
      assert.equal(result.acceptedCount, 0);
      assert.ok((result.cheatCount ?? 0) >= 2);
    }
  });
});
