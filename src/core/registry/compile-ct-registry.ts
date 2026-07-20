import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseCheatTableXml, type CtImportResult } from '../definitions/ct-import.js';
import {
  extractCheatTableRawScriptCatalog,
  type CtRawScriptCatalog,
} from '../script-research/ct-script-research.js';

export interface SolithUnifiedCtRegistry {
  schemaVersion: '1.0.0';
  game: string;
  sourceFile: string;
  compiledAt: string;
  metadata: {
    totalPointers: number;
    totalScripts: number;
    rejectedPointers: number;
    pointerImportErrors: number;
  };
  pointers: CtImportResult;
  scripts: CtRawScriptCatalog;
}

export interface CompileSolithCtRegistryOptions {
  game?: string;
  title?: string;
  outputJsonPath?: string;
  compiledAt?: string;
}

export async function compileSolithCtRegistry(
  ctFilePath: string,
  options: CompileSolithCtRegistryOptions = {},
): Promise<SolithUnifiedCtRegistry> {
  const xmlText = await fs.readFile(ctFilePath, 'utf8');
  const sourceFile = path.basename(ctFilePath);
  const game = options.game ?? options.title ?? path.basename(ctFilePath, path.extname(ctFilePath));
  const title = options.title ?? game;

  const [pointers, scripts] = await Promise.all([
    parseCheatTableXml(xmlText, { title }),
    extractCheatTableRawScriptCatalog(xmlText, {
      title,
      sourceNote:
        'Raw Cheat Engine script text extracted as inert Solith metadata. Scripts are never executed.',
    }),
  ]);

  const registry: SolithUnifiedCtRegistry = {
    schemaVersion: '1.0.0',
    game,
    sourceFile,
    compiledAt: options.compiledAt ?? new Date().toISOString(),
    metadata: {
      totalPointers: pointers.accepted.length,
      totalScripts: scripts.scripts.length,
      rejectedPointers: pointers.rejected.length,
      pointerImportErrors: pointers.errors.length,
    },
    pointers,
    scripts,
  };

  if (options.outputJsonPath) {
    await fs.mkdir(path.dirname(options.outputJsonPath), { recursive: true });
    await fs.writeFile(options.outputJsonPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  return registry;
}
