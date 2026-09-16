/**
 * Real content-addressed identity for executables (ROADMAP.md Phase 3 hash
 * architecture): xxHash64 as a fast, non-security pre-filter/cache key,
 * BLAKE3 as SOLITH's own authoritative content identity. SHA-256 remains the
 * separate, unrelated external-compatibility hash used for CT/definition
 * fingerprint matching (see ../live-memory/installed-exe-hash.ts) — this
 * module never substitutes for that; the two serve different consumers.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash as createBlake3Hash } from 'blake3';
import createXxhash64, { type XXHashAPI } from 'xxhash-wasm';

const READ_CHUNK_BYTES = 1024 * 1024;

interface CachedHash {
  size: number;
  mtimeMs: number;
  hash: string;
}

const fastHashCache = new Map<string, CachedHash>();
const contentHashCache = new Map<string, CachedHash>();

let xxhashApiPromise: Promise<XXHashAPI> | null = null;
function getXxhashApi(): Promise<XXHashAPI> {
  if (!xxhashApiPromise) xxhashApiPromise = createXxhash64();
  return xxhashApiPromise;
}

/** Streams a file in fixed-size chunks, calling `onChunk` for each. Never loads the whole file into memory. */
function streamFile(resolved: string, onChunk: (chunk: Buffer) => void): void {
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  const fd = openSync(resolved, 'r');
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) onChunk(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
}

function withCache(
  cache: Map<string, CachedHash>,
  filePath: string,
  compute: (resolved: string) => string,
): string | null {
  const resolved = path.resolve(filePath);
  try {
    const stat = statSync(resolved);
    if (!stat.isFile()) return null;
    const cached = cache.get(resolved);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.hash;
    }
    const hash = compute(resolved);
    cache.set(resolved, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
    return hash;
  } catch {
    return null;
  }
}

/**
 * Fast, non-cryptographic xxHash64 of a file's full content. Intended as a
 * cheap pre-filter/cache-invalidation key — e.g. grouping candidates before
 * paying for an authoritative BLAKE3 pass (see reconcile-duplicates.ts) —
 * never as a security or uniqueness guarantee on its own.
 */
export async function computeFastHash(filePath: string): Promise<string | null> {
  const xxhash = await getXxhashApi();
  return withCache(fastHashCache, filePath, (resolved) => {
    const state = xxhash.create64();
    streamFile(resolved, (chunk) => state.update(chunk));
    return state.digest().toString(16).padStart(16, '0');
  });
}

/**
 * Authoritative SOLITH content identity: full-file BLAKE3 digest. Used to
 * distinguish executable builds/versions deterministically — two files are
 * the same build iff their BLAKE3 digest matches, independent of filename or
 * install path. Not used for CT/definition fingerprint compatibility (that
 * stays SHA-256 — see installed-exe-hash.ts).
 */
export async function computeContentHash(filePath: string): Promise<string | null> {
  return withCache(contentHashCache, filePath, (resolved) => {
    const hasher = createBlake3Hash();
    streamFile(resolved, (chunk) => hasher.update(chunk));
    return Buffer.from(hasher.digest()).toString('hex');
  });
}

export function resetContentHashCachesForTesting(): void {
  fastHashCache.clear();
  contentHashCache.clear();
}
