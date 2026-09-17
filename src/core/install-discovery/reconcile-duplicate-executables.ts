/**
 * Installed-game reconciliation (ROADMAP.md Phase 3 Mandatory Work):
 * detects installed games whose executables are byte-identical — e.g. the
 * same title reachable through two launchers, or copied to a second path —
 * using the Phase 3 two-tier hash architecture as designed: xxHash64 as a
 * cheap pre-filter (group by file size + fast hash) so BLAKE3's authoritative
 * confirmation only runs on candidates that already collide on the cheap
 * check, not on every installed executable on every call.
 *
 * Read-only: never mutates install-discovery state. Callers decide what, if
 * anything, to do with a reported duplicate (e.g. surfacing it for a
 * user-driven merge/cleanup action) — not run automatically during a scan,
 * to avoid adding full-file hashing latency to the interactive discovery
 * path.
 */
import { statSync } from 'node:fs';
import { listInstalledGames } from './store.js';
import type { InstalledGameRecord } from './types.js';
import { computeFastHash, computeContentHash } from '../executable-identity/content-hash.js';

type InstalledGameWithExecutable = InstalledGameRecord & { executablePath: string };

export interface DuplicateExecutableGroup {
  contentHash: string;
  installs: InstalledGameRecord[];
}

export async function findDuplicateInstalledExecutables(): Promise<DuplicateExecutableGroup[]> {
  const withExecutable = listInstalledGames().filter(
    (game): game is InstalledGameWithExecutable => Boolean(game.executablePath),
  );

  const bySizeAndFastHash = new Map<string, InstalledGameWithExecutable[]>();
  for (const game of withExecutable) {
    let size: number;
    try {
      size = statSync(game.executablePath).size;
    } catch {
      continue; // Stale/missing install path — not this function's concern.
    }
    const fastHash = await computeFastHash(game.executablePath);
    if (fastHash == null) continue;
    const key = `${size}:${fastHash}`;
    const bucket = bySizeAndFastHash.get(key) ?? [];
    bucket.push(game);
    bySizeAndFastHash.set(key, bucket);
  }

  const groups: DuplicateExecutableGroup[] = [];
  for (const candidates of bySizeAndFastHash.values()) {
    if (candidates.length < 2) continue;

    // Same size + fast hash is a strong signal but not a guarantee (xxHash64
    // is non-cryptographic); BLAKE3 is the authoritative confirmation before
    // anything is reported as a real duplicate.
    const byContentHash = new Map<string, InstalledGameWithExecutable[]>();
    for (const game of candidates) {
      const contentHash = await computeContentHash(game.executablePath);
      if (contentHash == null) continue;
      const bucket = byContentHash.get(contentHash) ?? [];
      bucket.push(game);
      byContentHash.set(contentHash, bucket);
    }
    for (const [contentHash, installs] of byContentHash) {
      if (installs.length >= 2) groups.push({ contentHash, installs });
    }
  }

  return groups;
}
