import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCheatTableXml } from '../src/core/definitions/ct-import.ts';

// Phase 7 Part 3 — the .CT importer previously called xml2js.parseStringPromise
// directly with none of the defense-in-depth guards already applied to the
// save-editor XML path (src/core/adapters/xml.ts's validateXmlSafety). These
// are RED-first negative tests for that gap.

describe('ct-import security hardening', () => {
  test('rejects an external entity (SYSTEM) declaration', async () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE CheatTable [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>&xxe;</Description>
      <VariableType>4 Bytes</VariableType>
      <Address>12345678</Address>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
    const result = await parseCheatTableXml(xxe, { title: 'XXE Test' });
    assert.equal(result.accepted.length, 0);
    assert.ok(result.errors.some((e) => /entity|doctype|safety/i.test(e)), `expected a safety error, got: ${result.errors.join(',')}`);
  });

  test('rejects a general entity-expansion ("billion laughs") declaration', async () => {
    const bomb = `<?xml version="1.0"?>
<!DOCTYPE CheatTable [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>&lol2;</Description>
      <VariableType>4 Bytes</VariableType>
      <Address>12345678</Address>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
    const result = await parseCheatTableXml(bomb, { title: 'Entity Expansion Test' });
    assert.equal(result.accepted.length, 0);
    assert.ok(result.errors.some((e) => /entity|doctype|safety/i.test(e)), `expected a safety error, got: ${result.errors.join(',')}`);
  });

  test('rejects XML nesting beyond the safe depth limit', async () => {
    const depth = 60;
    let xml = '<?xml version="1.0"?>\n<CheatTable><CheatEntries>';
    for (let i = 0; i < depth; i++) xml += '<CheatEntry><CheatEntries>';
    xml += '<CheatEntry><Description>"deep"</Description><VariableType>4 Bytes</VariableType><Address>1</Address></CheatEntry>';
    for (let i = 0; i < depth; i++) xml += '</CheatEntries></CheatEntry>';
    xml += '</CheatEntries></CheatTable>';

    const result = await parseCheatTableXml(xml, { title: 'Deep Nesting Test' });
    assert.equal(result.accepted.length, 0);
    assert.ok(result.errors.some((e) => /depth|nesting|safety/i.test(e)), `expected a safety error, got: ${result.errors.join(',')}`);
  });

  test('rejects an oversized .CT payload before parsing', async () => {
    const filler = 'A'.repeat(6 * 1024 * 1024);
    const xml = `<?xml version="1.0"?>\n<CheatTable><CheatEntries><CheatEntry><Description>"${filler}"</Description><VariableType>4 Bytes</VariableType><Address>1</Address></CheatEntry></CheatEntries></CheatTable>`;

    const result = await parseCheatTableXml(xml, { title: 'Oversized Test' });
    assert.equal(result.accepted.length, 0);
    assert.ok(result.errors.some((e) => /size|safety/i.test(e)), `expected a safety error, got: ${result.errors.join(',')}`);
  });

  test('still accepts a normal, well-formed .CT payload (no regression)', async () => {
    const ok = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>"Player Health"</Description>
      <VariableType>Float</VariableType>
      <Address>"Game.exe"+1A2B3C</Address>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
    const result = await parseCheatTableXml(ok, { title: 'Regression Test' });
    assert.equal(result.accepted.length, 1);
    assert.equal(result.errors.length, 0);
  });
});
