import { loadRegistry } from '../src/core/registry/load-registry.ts';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const registryPath = arg('registry') ?? (process.argv[2]?.startsWith('--') ? undefined : process.argv[2]);

if (!registryPath || registryPath === process.argv[0]) {
  console.error('Usage: npx tsx scripts/inspect-registry.mjs --registry registry.json');
  process.exit(1);
}

const registry = await loadRegistry(registryPath);
const counts = registry.artifact.counts;

console.log(`Registry: ${registry.game}`);
console.log(`Source: ${registry.artifact.source.filename}`);
console.log(`Source SHA-256: ${registry.artifact.source.sha256}`);
console.log(`Schema: ${registry.artifact.schemaVersion} (${registry.schemaVersion})`);
console.log(`Generated: ${registry.artifact.generatedAt}`);
console.log(`Pointers: ${counts.pointers}`);
console.log(`Scripts: ${counts.scripts}`);
console.log(`AOB signatures: ${counts.aobSignatures}`);
console.log(`Rejections: ${counts.rejections}`);
console.log(`Warnings: ${counts.warnings}`);
console.log(`Duplicates: ${counts.duplicates}`);
