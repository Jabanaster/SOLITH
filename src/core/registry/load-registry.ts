import { promises as fs } from 'node:fs';
import type { SolithUnifiedCtRegistry } from './compile-ct-registry.js';

export type CompiledCtRegistry = SolithUnifiedCtRegistry;

const SUPPORTED_SCHEMA_VERSION = '1.0.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

export function validateLoadedRegistry(value: unknown): CompiledCtRegistry {
  if (!isRecord(value)) throw new Error('Registry artifact must be a JSON object.');
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`Unsupported registry schema version: ${String(value.schemaVersion ?? 'missing')}`);
  }
  if (typeof value.game !== 'string') throw new Error('Registry artifact is missing game.');
  if (typeof value.sourceFile !== 'string') throw new Error('Registry artifact is missing sourceFile.');
  if (typeof value.compiledAt !== 'string') throw new Error('Registry artifact is missing compiledAt.');
  if (!isRecord(value.metadata)) throw new Error('Registry artifact is missing metadata.');
  if (!isRecord(value.pointers)) throw new Error('Registry artifact is missing pointers.');
  if (!isRecord(value.scripts)) throw new Error('Registry artifact is missing scripts.');
  if (!Array.isArray(value.aobSignatures)) throw new Error('Registry artifact is missing aobSignatures.');
  if (!Array.isArray(value.rejections)) throw new Error('Registry artifact is missing rejections.');

  const pointers = value.pointers;
  if (!Array.isArray(pointers.accepted)) throw new Error('Registry pointers.accepted must be an array.');
  if (!Array.isArray(pointers.rejected)) throw new Error('Registry pointers.rejected must be an array.');

  const scripts = value.scripts;
  if (!Array.isArray(scripts.scripts)) throw new Error('Registry scripts.scripts must be an array.');

  return value as CompiledCtRegistry;
}
