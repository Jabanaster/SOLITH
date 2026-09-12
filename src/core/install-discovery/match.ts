import path from 'node:path';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import type { InstalledGameRecord, RawInstalledGame } from './types.js';
import { createInstallIdentity, INSTALL_IDENTITY_VERSION } from './identity.js';

function normalizeExe(name: string): string {
  return path.basename(name).toLowerCase();
}

/**
 * Result of resolving one installed game against the trainer catalog.
 *
 *   EXACT      — a trusted, platform-issued identifier (today: Steam's steamAppId,
 *                the only such identifier available at match time — see types.ts's
 *                RawInstalledGame) matched exactly one catalog entry.
 *   HIGH       — no trusted identifier was available, but the evidence still narrows
 *                to exactly one candidate without guessing: either the installed
 *                executable's basename is registered by exactly one catalog entry,
 *                or (when multiple entries share that basename) exactly one of them
 *                has a displayName that exact-matches the installed game's reported
 *                display name.
 *   AMBIGUOUS  — two or more catalog entries remain plausible after applying every
 *                available evidence tier above (e.g. a generic basename like
 *                `game.exe` shared by unrelated catalog entries, or a title-family
 *                collision such as "Dark Souls" vs "Dark Souls II" both shipping the
 *                same generic exe name). This replaces the old `candidates[0]`
 *                arbitrary pick — no single candidate is ever chosen out of a
 *                genuinely ambiguous set.
 *   NO_MATCH   — zero candidates: no steamAppId hit and either no executablePath, or
 *                an executablePath whose basename no catalog entry registers.
 */
export type CatalogMatchStatus = 'EXACT' | 'HIGH' | 'AMBIGUOUS' | 'NO_MATCH';

export interface CatalogMatchResult {
  status: CatalogMatchStatus;
  entry?: TrainerCatalogEntry;
  /** Present only for AMBIGUOUS — the full set of plausible candidates, for diagnostics/manual review. */
  candidates?: TrainerCatalogEntry[];
}

/**
 * Ranking order (see CatalogMatchStatus doc above for the full rationale):
 *   1. EXACT — trusted steamAppId, matched via the catalog's steamAppId index.
 *   2. HIGH  — unique executable-basename match, or a single displayName exact match
 *              narrowing a basename collision to one candidate.
 *   3. AMBIGUOUS — multiple candidates remain after every tier above; never resolved
 *              to a single winner.
 *   4. NO_MATCH — no evidence at all, or evidence that matches zero catalog entries.
 *
 * Only real, already-available evidence is used (RawInstalledGame's steamAppId,
 * executablePath, displayName against TrainerCatalogEntry's steamAppId, executables,
 * displayName) — no evidence is invented. Notably, catalog entries carry no
 * install-path/executable-path of their own (they are launcher-agnostic game
 * metadata, not per-install records), so an "exact install-folder/executable-path"
 * signal against the catalog does not exist in the current data model; the closest
 * real analog — an executable basename unique among catalog entries — is what tier 2
 * (HIGH) actually checks.
 */
export function resolveCatalogMatch(
  game: RawInstalledGame,
  bySteamId: ReadonlyMap<number, TrainerCatalogEntry>,
  byExecutable: ReadonlyMap<string, TrainerCatalogEntry[]>,
): CatalogMatchResult {
  if (game.steamAppId != null) {
    const steamMatch = bySteamId.get(game.steamAppId);
    if (steamMatch) {
      return { status: 'EXACT', entry: steamMatch };
    }
  }

  if (!game.executablePath) {
    return { status: 'NO_MATCH' };
  }

  const candidates = byExecutable.get(normalizeExe(game.executablePath)) ?? [];

  if (candidates.length === 0) {
    return { status: 'NO_MATCH' };
  }

  if (candidates.length === 1) {
    return { status: 'HIGH', entry: candidates[0] };
  }

  // Multiple catalog entries share this executable basename (a generic name like
  // game.exe / shipping.exe, or a real title-family collision). The basename alone
  // is never sufficient to pick a winner — narrow using an exact, single-match
  // display name instead of guessing.
  if (game.displayName) {
    const lower = game.displayName.toLowerCase();
    const titleMatches = candidates.filter((c) => c.displayName.toLowerCase() === lower);
    if (titleMatches.length === 1) {
      return { status: 'HIGH', entry: titleMatches[0] };
    }
  }

  return { status: 'AMBIGUOUS', candidates };
}

export function matchInstalledToCatalog(
  installed: RawInstalledGame[],
  catalog: TrainerCatalogEntry[],
  scannedAt: string,
): InstalledGameRecord[] {
  const bySteamId = new Map<number, TrainerCatalogEntry>();
  const byExecutable = new Map<string, TrainerCatalogEntry[]>();

  for (const entry of catalog) {
    if (entry.steamAppId != null) {
      bySteamId.set(entry.steamAppId, entry);
    }
    for (const exe of entry.executables) {
      const key = normalizeExe(exe);
      const list = byExecutable.get(key) ?? [];
      list.push(entry);
      byExecutable.set(key, list);
    }
  }

  const records: InstalledGameRecord[] = [];

  for (const game of installed) {
    const resolution = resolveCatalogMatch(game, bySteamId, byExecutable);
    const match = resolution.status === 'EXACT' || resolution.status === 'HIGH' ? resolution.entry : undefined;

    const identity = createInstallIdentity(game);
    records.push({
      ...game,
      id: identity.installIdentity,
      installIdentity: identity.installIdentity,
      canonicalInstallPath: identity.canonicalInstallPath,
      canonicalExecutablePath: identity.canonicalExecutablePath,
      launcherAppId: identity.launcherAppId,
      identityVersion: INSTALL_IDENTITY_VERSION,
      identityStatus: identity.identityStatus,
      needsReverification: identity.needsReverification,
      catalogGameId: match?.catalogGameId,
      catalogDisplayName: match?.displayName,
      catalogMatchStatus: resolution.status,
      detectedAt: scannedAt,
      lastSeenAt: scannedAt,
    });
  }

  return records;
}

export function countMatchedCatalog(records: InstalledGameRecord[]): number {
  return records.filter((r) => r.catalogGameId).length;
}
