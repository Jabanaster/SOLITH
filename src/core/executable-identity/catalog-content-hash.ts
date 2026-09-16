/**
 * Catalog-scoped authoritative content identity: resolves an installed
 * catalog game's executable path (shared lookup with the SHA-256
 * definition-fingerprint path — see ../live-memory/installed-exe-hash.ts)
 * and computes its BLAKE3 digest. This is SOLITH's own build/version
 * identity signal, distinct from the SHA-256 hash used for CT/definition
 * fingerprint compatibility — the two answer different questions ("is this
 * the exact build a definition's fingerprint expects" vs "is this the exact
 * same build we've seen before, regardless of any definition").
 */
import { findInstalledExecutablePath } from '../install-discovery/store.js';
import { computeContentHash } from './content-hash.js';

export async function resolveInstalledExecutableContentHash(
  catalogGameId: string,
  executableName?: string,
): Promise<string | null> {
  const exePath = findInstalledExecutablePath(catalogGameId, executableName);
  if (!exePath) return null;
  return computeContentHash(exePath);
}
