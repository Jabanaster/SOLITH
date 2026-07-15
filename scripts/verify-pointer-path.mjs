#!/usr/bin/env node
/**
 * Pointer-path verification helper.
 *
 * Offline:
 *   node scripts/verify-pointer-path.mjs --definition path.json --check-only
 *   node scripts/verify-pointer-path.mjs --check-only
 *
 * Live mode (future): attach + restart ritual — requires running game.
 */
import fs from 'node:fs';
import path from 'node:path';

const RESTART_VERIFY_RITUAL = [
  '1. Attach to running game (solo/offline session)',
  '2. Resolve pointer path / AOB — read value matches on-screen',
  '3. Kill game completely, relaunch (new PID / ASLR)',
  '4. Resolve again — read must match without full scan',
  '5. Safe write + in-game verify + rollback from backup',
  '6. Record executable hash prefix + evidence in schema.v1 / Docs/Certification/',
  '7. Set feature.certificationLevel to L3+ only after steps 1–6 pass',
];

function parseArgs(argv) {
  const args = { definition: null, checkOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check-only') args.checkOnly = true;
    else if (a === '--definition') args.definition = argv[++i];
  }
  return args;
}

function checkDefinition(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const features = raw.memoryFeatures ?? [];
  const report = [];
  for (const f of features) {
    const r = f.resolution ?? {};
    const hasPath =
      Boolean(r.moduleName) &&
      (Boolean(r.baseOffset) || Boolean(r.signature) || (r.pointerChain?.length ?? 0) > 0);
    const ok = f.type === 'scan_unknown' || f.type === 'scan_first' || hasPath;
    report.push({
      id: f.id,
      ok,
      type: f.type,
      moduleName: r.moduleName,
      baseOffset: r.baseOffset,
      pointerChainLength: r.pointerChain?.length ?? 0,
      certificationLevel: f.certificationLevel ?? 'L0',
    });
  }
  return {
    definition: path.basename(filePath),
    definitionId: raw.id,
    features: report,
    pass: report.every((x) => x.ok),
    ritual: RESTART_VERIFY_RITUAL,
    liveMode: 'BLOCKED — run with game attached; this script does not attach to processes',
  };
}

function main() {
  const args = parseArgs(process.argv);

  if (args.checkOnly && !args.definition) {
    console.log(JSON.stringify({ mode: 'check-only', ritual: RESTART_VERIFY_RITUAL }, null, 2));
    return;
  }

  if (args.definition) {
    const result = checkDefinition(path.resolve(args.definition));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }

  console.error('Provide --definition <path> [--check-only] or --check-only alone for ritual checklist.');
  process.exit(1);
}

main();
