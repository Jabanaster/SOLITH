/**
 * Resolve SHA-256 of an installed catalog game executable when discovery knows the path.
 */

import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { listInstalledGames } from '../install-discovery/store.js';

interface CachedExecutableHash {
  size: number;
  mtimeMs: number;
  hash: string;
}

const hashCache = new Map<string, CachedExecutableHash>();
const HASH_BUFFER_BYTES = 1024 * 1024;

/**
 * Full-file SHA-256. Unlike profile hashing, this never substitutes metadata
 * for large binaries: definition fingerprints require the actual file digest.
 */
export function hashExecutableFileSHA256(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  try {
    const stat = statSync(resolved);
    if (!stat.isFile()) return null;

    const cached = hashCache.get(resolved);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.hash;
    }

    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    const fd = openSync(resolved, 'r');
    try {
      let bytesRead = 0;
      do {
        bytesRead = readSync(fd, buffer, 0, buffer.length, null);
        if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      closeSync(fd);
    }

    const hash = digest.digest('hex');
    hashCache.set(resolved, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
    return hash;
  } catch {
    return null;
  }
}

export function hashInstalledExecutableForCatalog(
  catalogGameId: string,
  executableName?: string,
): string | null {
  const candidates = listInstalledGames().filter((game) => game.catalogGameId === catalogGameId);
  const installed = executableName
    ? candidates.find(
      (game) =>
        game.executablePath != null &&
        path.basename(game.executablePath).toLowerCase() === executableName.toLowerCase(),
    )
    : candidates[0];
  const exePath = installed?.executablePath;
  if (!exePath) return null;
  return hashExecutableFileSHA256(exePath);
}

export function resetInstalledExecutableHashCacheForTesting(): void {
  hashCache.clear();
}
