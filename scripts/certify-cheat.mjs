#!/usr/bin/env node
/**
 * Certification level reporter for schema.v1 definitions.
 * L0–L1: offline schema + resolution checks. L2–L4: require live sessions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

async function loadValidator() {
  const mod = await import('../src/core/definitions/schema.v1.ts');
  return mod.validateSolithDefinitionV1;
}

function checkBackupPath(definition) {
  const dir = definition.saveEditor?.defaultDirectory ?? '';
  return Boolean(dir) && !dir.includes('..');
}

function checkFeatureResolution(feature) {
  const r = feature.resolution ?? {};
  if (feature.type === 'scan_unknown' || feature.type === 'scan_first') return true;
  return Boolean(r.moduleName) &&
    (Boolean(r.baseOffset) || Boolean(r.signature) || (r.pointerChain?.length ?? 0) > 0);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node scripts/certify-cheat.mjs --file <definition.json> [--level L1] [--feature id]');
    process.exit(1);
  }

  const validate = await loadValidator();
  const raw = JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf-8'));
  const schemaErrors = validate(raw);
  const features = (raw.memoryFeatures ?? []).filter((f) => !args.feature || f.id === args.feature);

  const results = features.map((f) => {
    const level = f.certificationLevel ?? 'L0';
    const resolutionOk = checkFeatureResolution(f);
    const offlineChecks = {
      schemaValid: schemaErrors.length === 0,
      resolutionOk,
      backupPathOk: raw.saveEditor ? checkBackupPath(raw) : true,
    };
    const offlinePass =
      schemaErrors.length === 0 &&
      resolutionOk &&
      offlineChecks.backupPathOk &&
      LEVELS.indexOf(level) >= LEVELS.indexOf(args.level);
    const liveRequired = ['L2', 'L3', 'L4'].includes(args.level);
    return {
      featureId: f.id,
      name: f.name,
      recordedLevel: level,
      requestedLevel: args.level,
      offlineChecks,
      offlinePass: liveRequired ? offlineChecks.schemaValid && resolutionOk : offlinePass,
      liveRequired,
      note: liveRequired
        ? 'L2+ requires live game session — attach, restart-verify, in-game evidence'
        : 'Offline schema/resolution/backup-path check',
    };
  });

  const report = {
    definitionId: raw.id,
    title: raw.title,
    packCertificationLevel: raw.certificationLevel ?? null,
    schemaErrors,
    results,
    pass: schemaErrors.length === 0 && results.every((r) => r.offlinePass || !r.liveRequired),
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
