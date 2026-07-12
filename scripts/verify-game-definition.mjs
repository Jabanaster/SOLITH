#!/usr/bin/env node
/**
 * Offline validation of a schema.v1 definition file or catalog payload.
 *
 * Usage:
 *   node scripts/verify-game-definition.mjs --file path/to/definition.json
 *   node scripts/verify-game-definition.mjs --catalog-game-id palworld
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function loadValidator() {
  const mod = await import('../src/core/definitions/schema.v1.ts');
  return mod.validateSolithDefinitionV1;
}

function parseArgs(argv) {
  const args = { file: null, catalogGameId: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--catalog-game-id') args.catalogGameId = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const validate = await loadValidator();
  let raw;

  if (args.file) {
    raw = JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf-8'));
  } else if (args.catalogGameId) {
    console.error('Catalog DB lookup requires running app context; use --file with exported JSON.');
    process.exit(1);
  } else {
    console.error('Usage: node scripts/verify-game-definition.mjs --file <definition.json>');
    process.exit(1);
  }

  const errors = validate(raw);
  const memoryFeatures = raw.memoryFeatures ?? [];
  const CERT_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4'];
  const certified = memoryFeatures.filter((f) => {
    const level = f.certificationLevel ?? 'L0';
    return CERT_ORDER.indexOf(level) >= CERT_ORDER.indexOf('L3');
  }).length;

  const report = {
    id: raw.id,
    title: raw.title,
    valid: errors.length === 0,
    errors,
    memoryFeatureCount: memoryFeatures.length,
    saveFieldCount: raw.saveEditor?.saveFields?.length ?? 0,
    l3PlusFeatures: certified,
    verificationStatus: raw.safety?.verificationStatus,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
