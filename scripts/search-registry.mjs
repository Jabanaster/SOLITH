import { loadRegistry } from '../src/core/registry/load-registry.ts';
import { searchRegistry } from '../src/core/registry/query-registry.ts';

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toRows(results) {
  return results.map((result) => ({
    id: result.id,
    type: result.type,
    title: result.title,
    module: result.module ?? '',
    scanType: result.scanType ?? '',
    valueType: result.valueType ?? '',
    pattern: result.normalizedPattern ?? result.pattern ?? '',
    executable: String(result.executable),
    warnings: result.warnings.join('; '),
    source: result.source.sourceEntryDescription,
  }));
}

function output(results, format) {
  const rows = toRows(results);
  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (format === 'compact-json') {
    console.log(JSON.stringify(results));
    return;
  }
  if (format === 'csv') {
    const headers = ['id', 'type', 'title', 'module', 'scanType', 'valueType', 'pattern', 'executable', 'warnings', 'source'];
    console.log(headers.join(','));
    for (const row of rows) console.log(headers.map((header) => csvEscape(row[header])).join(','));
    return;
  }
  if (format === 'markdown') {
    console.log('| Type | Title | Module | Pattern / Pointer | Source | Executable |');
    console.log('|---|---|---|---|---|---|');
    for (const row of rows) {
      console.log(`| ${row.type} | ${row.title} | ${row.module || '—'} | ${row.pattern || row.valueType || '—'} | ${row.source} | ${row.executable} |`);
    }
    return;
  }

  for (const row of rows) {
    const detail = row.pattern || row.valueType || row.scanType || row.warnings || '';
    console.log(`${row.type}\t${row.title}\t${row.module || '-'}\t${detail}\t${row.source}\texecutable=${row.executable}`);
  }
}

const registryPath = arg('registry');
if (!registryPath) {
  console.error('Usage: npx tsx scripts/search-registry.mjs --registry registry.json [--type aob] [--query health] [--module Game.exe] [--format json|compact-json|csv|markdown|text]');
  process.exit(1);
}

const registry = await loadRegistry(registryPath);
const results = searchRegistry(registry, {
  text: arg('query'),
  type: arg('type'),
  module: arg('module'),
  valueType: arg('value-type'),
  source: arg('source'),
  symbol: arg('symbol'),
  scanType: arg('scan-type'),
  pattern: arg('pattern'),
  warnings: has('warnings') ? true : undefined,
  duplicate: has('duplicates') ? true : undefined,
  excludeRejected: has('exclude-rejected') ? true : undefined,
});

output(results, arg('format', 'text'));
