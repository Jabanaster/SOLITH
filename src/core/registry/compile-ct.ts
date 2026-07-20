import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compileSolithCtRegistry, type CompileSolithCtRegistryOptions, type SolithUnifiedCtRegistry } from './compile-ct-registry.js';

export type CompiledCtRegistry = SolithUnifiedCtRegistry;

export interface CompileCtOptions extends CompileSolithCtRegistryOptions {}

export async function compileCtFile(
  ctFilePath: string,
  options: CompileCtOptions = {},
): Promise<CompiledCtRegistry> {
  return compileSolithCtRegistry(ctFilePath, options);
}

export async function compileCtDirectory(
  directoryPath: string,
  options: Omit<CompileCtOptions, 'outputJsonPath'> & { outputDir?: string } = {},
): Promise<CompiledCtRegistry[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const ctFiles = entries
    .filter((entry) => entry.isFile() && /\.ct$/i.test(entry.name))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((a, b) => a.localeCompare(b));

  const registries: CompiledCtRegistry[] = [];
  for (const ctFile of ctFiles) {
    const outputJsonPath = options.outputDir
      ? path.join(options.outputDir, `${path.basename(ctFile, path.extname(ctFile))}.registry.json`)
      : undefined;
    registries.push(await compileCtFile(ctFile, { ...options, outputJsonPath }));
  }
  return registries;
}
