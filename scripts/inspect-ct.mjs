import fs from 'node:fs';
import { parseStringPromise } from 'xml2js';
import { parseCheatTableXml } from '../src/core/definitions/ct-import.ts';

const filePath = process.argv[2];
const mode = process.argv[3] ?? 'full';
if (!filePath) {
  console.error('Usage: node scripts/inspect-ct.mjs <path-to.ct>');
  process.exit(1);
}

const xml = fs.readFileSync(filePath, 'utf8');

function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return String(v[0] ?? '');
  if (typeof v === 'object' && '_' in v) return String(v._);
  return String(v);
}

function walk(node, depth = 0, out = []) {
  if (!node || typeof node !== 'object') return out;
  const desc = text(node.Description).replace(/^"|"$/g, '').trim();
  const hasScript = !!(node.AutoAssemblerScript || node.AssemblerScript || node.LuaScript);
  const vt = text(node.VariableType);
  const addr = text(node.Address);
  if (desc) out.push({ depth, desc, hasScript, vt, addr: addr.slice(0, 120) });
  const kids = node.CheatEntry;
  if (kids) {
    const list = Array.isArray(kids) ? kids : [kids];
    for (const k of list) walk(k, depth + 1, out);
  }
  if (node.CheatEntries) walk(node.CheatEntries, depth, out);
  return out;
}

const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
const table = parsed.CheatTable || parsed.cheatTable;
const rows = walk(table);
const importResult = await parseCheatTableXml(xml, { title: 'Crimson Desert' });

const topLevelCheats = rows
  .filter(
    (r) =>
      r.depth === 1 &&
      !/^Toggle (Scripts|Compact View)$/i.test(r.desc) &&
      !/^Old scripts/i.test(r.desc) &&
      !/opencheattables\.com/i.test(r.desc),
  )
  .map((r) => ({ name: r.desc, script: r.hasScript, variableType: r.vt || null }));

if (mode === 'names') {
  for (const cheat of topLevelCheats) {
    console.log(cheat.name);
  }
  process.exit(0);
}

if (mode === 'scripts') {
  function findScripts(node, pathLabel = '') {
    if (!node || typeof node !== 'object') return [];
    const record = node;
    const out = [];
    const desc = text(record.Description).replace(/^"|"$/g, '').trim();
    const aa = text(record.AutoAssemblerScript);
    if (aa && desc) {
      out.push({ path: pathLabel, desc, len: aa.length, preview: aa.slice(0, 600) });
    }
    const kids = record.CheatEntry;
    if (kids) {
      for (const child of Array.isArray(kids) ? kids : [kids]) {
        out.push(...findScripts(child, pathLabel ? `${pathLabel} > ${desc}` : desc));
      }
    }
    return out;
  }
  const scripts = findScripts(parsed.CheatTable || parsed.cheatTable)
    .filter((s) => s.len > 50)
    .sort((a, b) => b.len - a.len);
  console.log('SCRIPT_COUNT', scripts.length);
  for (const s of scripts.slice(0, 6)) {
    console.log(`--- ${s.desc} (${s.len} bytes)`);
    console.log(s.preview);
    console.log('');
  }
  process.exit(0);
}

console.log(JSON.stringify({
  filePath,
  bytes: xml.length,
  treeRows: rows.length,
  scriptRows: rows.filter((r) => r.hasScript).length,
  importAccepted: importResult.accepted.length,
  importRejected: importResult.rejected.length,
  rejectedReasons: importResult.rejected.reduce((acc, r) => {
    acc[r.reason] = (acc[r.reason] ?? 0) + 1;
    return acc;
  }, {}),
  topLevelCheats,
  tree: rows.map((r) => ({
    depth: r.depth,
    name: r.desc,
    script: r.hasScript,
    variableType: r.vt || null,
    addressPreview: r.addr || null,
  })),
}, null, 2));
