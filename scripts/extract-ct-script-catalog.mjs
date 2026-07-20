import fs from 'node:fs';
import path from 'node:path';
import { extractCheatTableRawScriptCatalog } from '../src/core/script-research/ct-script-research.ts';

const ctFilePath = process.argv[2];
const outFilePath = process.argv[3] ?? 'Avowed_Scripts_Catalog.json';

if (!ctFilePath) {
  console.error('Usage: npx tsx scripts/extract-ct-script-catalog.mjs <path-to.ct> [output.json]');
  process.exit(1);
}

const xmlData = fs.readFileSync(ctFilePath, 'utf8');
const catalog = await extractCheatTableRawScriptCatalog(xmlData, {
  title: path.basename(ctFilePath, path.extname(ctFilePath)),
  sourceNote:
    'Raw Cheat Engine script text extracted as inert Solith metadata. This catalog is not executable and must not be used to run AutoAssembler or Lua content.',
});

fs.writeFileSync(outFilePath, JSON.stringify(catalog.scripts, null, 4));
console.log(`Extracted ${catalog.scripts.length} raw scripts as metadata.`);
console.log(`Output: ${outFilePath}`);
