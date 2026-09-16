import path from 'node:path';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import type { InstalledGameRecord, RawInstalledGame } from './types.js';
import { createInstallIdentity, INSTALL_IDENTITY_VERSION } from './identity.js';
import { getModPackForGame } from '../trainer-catalog/store.js';
import { hashExecutableFileSHA256 } from '../live-memory/installed-exe-hash.js';

function normalizeExe(name: string): string {
  return path.basename(name).toLowerCase();
}

export interface MatchInstalledToCatalogOptions {
  /**
   * Real on-disk SHA-256 of an installed candidate's executable, used only
   * to disambiguate when 2+ catalog entries share the same executable
   * filename and displayName alone cannot decide (tier 3 below). Defaults
   * to a real, cached, streaming hash (installed-exe-hash.ts) — tests may
   * inject a fixed lookup instead of touching real files.
   */
  hashExecutable?: (executablePath: string) => string | null;
  /**
   * SHA-256 prefixes recorded against a catalog game's trainer/mod-pack
   * versions (schema.v1 `executableHashPrefixes`), used alongside
   * `hashExecutable` for tier-3 disambiguation. Defaults to a real lookup
   * via getModPackForGame(); tests may inject fixtures directly.
   */
  resolveExecutableHashPrefixes?: (catalogGameId: string) => string[];
}

function defaultResolveExecutableHashPrefixes(catalogGameId: string): string[] {
  const pack = getModPackForGame(catalogGameId);
  if (!pack) return [];
  return pack.versions.flatMap((v) => v.executableHashPrefixes ?? []);
}

function defaultHashExecutable(executablePath: string): string | null {
  return hashExecutableFileSHA256(executablePath);
}

/**
 * Resolves which single catalog entry (if any) a game whose executable
 * filename matches 2+ catalog entries actually is. Explicit hierarchy —
 * never an arbitrary/first/alphabetical/installation-order pick:
 *
 *  1. exact displayName match (installer/launcher-reported title, when
 *     exactly one candidate's displayName matches).
 *  2. authoritative content identity: the installed executable's real
 *     SHA-256 against each remaining candidate's known trainer/mod-pack
 *     executableHashPrefixes, when exactly one candidate's prefix matches.
 *  3. otherwise FAIL CLOSED — return undefined. An unresolved ambiguous
 *     install is surfaced as "no catalog match" (safe: no trainer can be
 *     misattached to the wrong game/edition) rather than guessed.
 */
function resolveAmbiguousExecutableMatch(
  candidates: TrainerCatalogEntry[],
  game: RawInstalledGame,
  options: Required<Pick<MatchInstalledToCatalogOptions, 'hashExecutable' | 'resolveExecutableHashPrefixes'>>,
): TrainerCatalogEntry | undefined {
  if (game.displayName) {
    const lower = game.displayName.toLowerCase();
    const byDisplayName = candidates.filter((c) => c.displayName.toLowerCase() === lower);
    if (byDisplayName.length === 1) return byDisplayName[0];
  }

  if (game.executablePath) {
    const installedHash = options.hashExecutable(game.executablePath);
    if (installedHash) {
      const byContentFingerprint = candidates.filter((c) =>
        options.resolveExecutableHashPrefixes(c.catalogGameId).some((prefix) => installedHash.startsWith(prefix)),
      );
      if (byContentFingerprint.length === 1) return byContentFingerprint[0];
    }
  }

  return undefined;
}

export function matchInstalledToCatalog(
  installed: RawInstalledGame[],
  catalog: TrainerCatalogEntry[],
  scannedAt: string,
  options: MatchInstalledToCatalogOptions = {},
): InstalledGameRecord[] {
  const resolvedOptions = {
    hashExecutable: options.hashExecutable ?? defaultHashExecutable,
    resolveExecutableHashPrefixes: options.resolveExecutableHashPrefixes ?? defaultResolveExecutableHashPrefixes,
  };

  const bySteamId = new Map<number, TrainerCatalogEntry>();
  const byExecutable = new Map<string, TrainerCatalogEntry[]>();

  for (const entry of catalog) {
    if (entry.steamAppId != null && entry.steamAppId < 1_000_000) {
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
    let match: TrainerCatalogEntry | undefined;

    if (game.steamAppId != null) {
      match = bySteamId.get(game.steamAppId);
    }

    if (!match && game.executablePath) {
      const candidates = byExecutable.get(normalizeExe(game.executablePath)) ?? [];
      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        match = resolveAmbiguousExecutableMatch(candidates, game, resolvedOptions);
      }
    }

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
      detectedAt: scannedAt,
      lastSeenAt: scannedAt,
    });
  }

  return records;
}

export function countMatchedCatalog(records: InstalledGameRecord[]): number {
  return records.filter((r) => r.catalogGameId).length;
}
