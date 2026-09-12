#!/usr/bin/env node
/**
 * Mission E — why are pointer-kind records classified UNSUPPORTED
 * (liveResolution !== 'resolvable')? Read-only analysis, no classifier
 * changes. Buckets by concrete field-shape evidence, not guesses.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

const ROOT = process.cwd();
const SUMMARY_PATH = path.join(ROOT, 'data', 'ct-library', 'personal-ct-library.summary.json');

const HEX_OFFSET_RE = /^0x[0-9a-f]+$/i;
const PURE_HEX_RE = /^0x[0-9a-f]+$/i;

function bucketFor(cheat) {
  const m = cheat.metadata;
  if (!m) return 'missing_metadata_object';
  const lr = m.liveResolution;
  if (lr === undefined || lr === null) return 'missing_liveResolution_field';
  if (lr === 'resolvable') return 'resolvable_not_unsupported';
  if (lr === 'absolute_only') return 'absolute_only_not_unsupported';
  if (lr !== 'incomplete') return `unknown_liveResolution_value:${lr}`;

  // lr === 'incomplete' — figure out exactly why.
  const moduleName = m.moduleName;
  const hasRealModule = typeof moduleName === 'string' && moduleName.trim().length > 0 && moduleName.trim().toLowerCase() !== 'unknown-module.exe';
  const baseOffset = m.baseOffset;
  const hasOffset = typeof baseOffset === 'string' && HEX_OFFSET_RE.test(baseOffset);
  const raw = (m.rawAddress ?? '').trim();
  const rawIsPureHex = PURE_HEX_RE.test(raw);

  if (!moduleName && !baseOffset && !raw) return 'incomplete:all_fields_empty';
  if (hasRealModule && !hasOffset && !baseOffset) return 'incomplete:real_module_missing_offset';
  if (hasRealModule && !hasOffset && baseOffset) return 'incomplete:real_module_malformed_offset';
  if (!hasRealModule && hasOffset) return 'incomplete:valid_offset_no_module';
  if (!moduleName && raw) return 'incomplete:no_module_has_raw_nonhex';
  if (moduleName === 'unknown-module.exe' && !rawIsPureHex && raw) return 'incomplete:unknown_module_raw_nonhex';
  if (moduleName === 'unknown-module.exe' && !raw) return 'incomplete:unknown_module_no_raw';
  return 'incomplete:other_unclassified';
}

async function main() {
  const summary = JSON.parse(await fs.readFile(SUMMARY_PATH, 'utf8'));
  const buckets = new Map();
  const samples = new Map();
  let totalPointerRecords = 0;

  for (const shardEntry of summary.shards) {
    const shardPath = path.isAbsolute(shardEntry.path) ? shardEntry.path : path.join(ROOT, shardEntry.path);
    let shard;
    try {
      shard = JSON.parse(await fs.readFile(shardPath, 'utf8'));
    } catch {
      continue;
    }
    for (const table of shard.tables) {
      for (const cheat of table.cheats) {
        if (cheat.kind !== 'pointer') continue;
        totalPointerRecords += 1;
        const bucket = bucketFor(cheat);
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
        if (!samples.has(bucket)) samples.set(bucket, []);
        const arr = samples.get(bucket);
        if (arr.length < 3) {
          arr.push({ game: shardEntry.gameId, table: table.tableName, cheat: { id: cheat.id, name: cheat.name, metadata: cheat.metadata } });
        }
      }
    }
  }

  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  console.log('=== UNSUPPORTED POINTER ANALYSIS ===');
  console.log('total pointer-kind records:', totalPointerRecords);
  for (const [bucket, count] of sorted) {
    const pct = ((count / totalPointerRecords) * 100).toFixed(2);
    console.log(`${bucket}: ${count} (${pct}%)`);
  }

  console.log('\n=== SAMPLES (up to 3 per bucket) ===');
  for (const [bucket] of sorted) {
    console.log(`\n-- ${bucket} --`);
    for (const s of samples.get(bucket)) {
      console.log(JSON.stringify(s));
    }
  }
}

main().catch((error) => {
  console.error('[analyze-unsupported-pointers] Failed:', error);
  process.exitCode = 1;
});
