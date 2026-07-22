import { promises as fs } from 'node:fs';
import { validateLoadedRegistry, type CompiledCtRegistry } from './loaded-registry.js';

export async function loadRegistry(registryPath: string): Promise<CompiledCtRegistry> {
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Registry file could not be read: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Registry file is not valid JSON: ${message}`);
  }

  return validateLoadedRegistry(parsed);
}

export { validateLoadedRegistry, type CompiledCtRegistry } from './loaded-registry.js';
