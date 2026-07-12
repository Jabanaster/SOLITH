#!/usr/bin/env node
/**
 * Certification level reporter for schema.v1 definitions (offline L0–L1; L2–L4 need live sessions).
 *
 * Usage:
 *   node scripts/certify-cheat.mjs --file definition.json --level L1
 */
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];

function parseArgs(argv) {
  const args = { file: null, level: 'L1', feature: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--level') args.level = argv[++i];
    else if (argv[i] === '--feature') args.feature = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node scripts/certify-cheat.mjs --file <definition.json> [--level L1] [--feature id]');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf-8'));
  const features = (raw.memoryFeatures ?? []).filter((f) => !args.feature || f.id === args.feature);

  const results = features.map((f) => {
    const level = f.certificationLevel ?? 'L0';
    const offlinePass = LEVELS.indexOf(level) >= LEVELS.indexOf(args.level);
    return {
      featureId: f.id,
      name: f.name,
      recordedLevel: level,
      requestedLevel: args.level,
      offlinePass,
      liveRequired: ['L2', 'L3', 'L4'].includes(args.level),
      note:
        args.level === 'L0' || args.level === 'L1'
          ? 'Offline schema/resolution check only'
          : 'Requires live game session — run with game attached',
    };
  });

  const report = {
    definitionId: raw.id,
    title: raw.title,
    results,
    pass: results.every((r) => r.offlinePass || !r.liveRequired),
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
