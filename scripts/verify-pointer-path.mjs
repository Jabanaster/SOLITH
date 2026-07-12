#!/usr/bin/env node
/**
 * Documents and optionally runs restart pointer-path verification (requires live game).
 *
 * Offline mode (--check-only): validates definition JSON has resolvable pointer fields.
 *
 * Usage:
 *   node scripts/verify-pointer-path.mjs --definition definitions/bundled/palworld.json --check-only
 *   node scripts/verify-pointer-path.mjs --pid 1234 --feature infinite-health --address 0xABC
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { definition: null, checkOnly: false, pid: null, feature: null, address: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check-only') args.checkOnly = true;
    else if (a === '--definition') args.definition = argv[++i];
    else if (a === '--pid') args.pid = Number(argv[++i]);
    else if (a === '--feature') args.feature = argv[++i];
    else if (a === '--address') args.address = argv[++i];
  }
  return args;
}

function checkDefinition(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const features = raw.memoryFeatures ?? [];
  const report = [];
  for (const f of features) {
    const r = f.resolution ?? {};
    const ok =
      Boolean(r.moduleName) &&
      (Boolean(r.baseOffset) || Boolean(r.signature) || (r.pointerChain?.length ?? 0) > 0);
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
  return { definition: path.basename(filePath), features: report, pass: report.every((x) => x.ok || x.type === 'scan_unknown') };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.definition) {
    const result = checkDefinition(path.resolve(args.definition));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }

  if (args.checkOnly) {
    console.log(JSON.stringify({
      mode: 'check-only',
      ritual: [
        '1. Attach to running game',
        '2. Resolve pointer path / read on-screen value',
        '3. Kill game, relaunch (new PID)',
        '4. Resolve again — values must match',
        '5. Safe write + verify + rollback',
        '6. Record executable hash prefix + evidence in game-connection-baselines / schema.v1',
      ],
    }, null, 2));
    return;
  }

  console.error('Provide --definition <path> or --check-only for offline validation.');
  process.exit(1);
}

main();
