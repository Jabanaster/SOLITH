import path from 'node:path';
import { compileSolithCtRegistry } from '../src/core/registry/compile-ct-registry.ts';

const ctFilePath = process.argv[2];
const outputJsonPath =
  process.argv[3] ?? path.join(process.cwd(), 'data', 'registry', 'Avowed_Master_Registry.json');
const game = process.argv[4] ?? 'Avowed';

if (!ctFilePath) {
  console.error('Usage: npx tsx scripts/compile-ct-registry.mjs <path-to.ct> [output.json] [game]');
  process.exit(1);
}

const registry = await compileSolithCtRegistry(ctFilePath, {
  game,
  title: game,
  outputJsonPath,
});

console.log(`[Solith Registry] Compiled ${registry.sourceFile} -> ${outputJsonPath}`);
console.log(
  `[Solith Registry] pointers=${registry.metadata.totalPointers} scripts=${registry.metadata.totalScripts} aobSignatures=${registry.metadata.totalAobSignatures} rejected=${registry.metadata.rejectedPointers} aobWarnings=${registry.metadata.aobWarnings} aobDuplicates=${registry.metadata.duplicateAobSignatures}`,
);
