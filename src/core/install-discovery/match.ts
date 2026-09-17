import path from 'node:path';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import type { InstalledGameRecord, RawInstalledGame } from './types.js';
import { createInstallIdentity, INSTALL_IDENTITY_VERSION } from './identity.js';
import { getModPackForGame } from '../trainer-catalog/store.js';
import { hashExecutableFileSHA256 } from '../live-memory/installed-exe-hash.js';
import { normalizeInstallPlatform, normalizeModPackPlatform, sameCanonicalProvider } from './provider-identity.js';
import { checkExecutableRoleApplicability } from './trainer-applicability.js';

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
   * `hashExecutable` for tier-2 disambiguation. Defaults to a real lookup
   * via getModPackForGame(); tests may inject fixtures directly.
   */
  resolveExecutableHashPrefixes?: (catalogGameId: string) => string[];
  /**
   * The canonical provider a catalog game's trainer/mod-pack was built
   * against (ModPack.platform, bridged via provider-identity.ts), used for
   * tier-3 disambiguation. Defaults to a real lookup via getModPackForGame();
   * tests may inject fixtures directly.
   */
  resolveModPackProvider?: (catalogGameId: string) => ReturnType<typeof normalizeModPackPlatform> | undefined;
}

function defaultResolveExecutableHashPrefixes(catalogGameId: string): string[] {
  const pack = getModPackForGame(catalogGameId);
  if (!pack) return [];
  return pack.versions.flatMap((v) => v.executableHashPrefixes ?? []);
}

function defaultResolveModPackProvider(catalogGameId: string): ReturnType<typeof normalizeModPackPlatform> | undefined {
  const pack = getModPackForGame(catalogGameId);
  return pack ? normalizeModPackPlatform(pack.platform) : undefined;
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
 *  3. provider match: the install's own platform (InstallPlatform) bridged
 *     to the same canonical provider (provider-identity.ts) as exactly one
 *     remaining candidate's trainer/mod-pack platform.
 *  4. otherwise FAIL CLOSED — return undefined. An unresolved ambiguous
 *     install is surfaced as "no catalog match" (safe: no trainer can be
 *     misattached to the wrong game/edition) rather than guessed.
 */
function resolveAmbiguousExecutableMatch(
  candidates: TrainerCatalogEntry[],
  game: RawInstalledGame,
  options: Required<
    Pick<MatchInstalledToCatalogOptions, 'hashExecutable' | 'resolveExecutableHashPrefixes' | 'resolveModPackProvider'>
  >,
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

  const installProvider = normalizeInstallPlatform(game.platform);
  const byProvider = candidates.filter((c) => {
    const catalogProvider = options.resolveModPackProvider(c.catalogGameId);
    return catalogProvider != null && sameCanonicalProvider(installProvider, catalogProvider);
  });
  if (byProvider.length === 1) return byProvider[0];

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
    resolveModPackProvider: options.resolveModPackProvider ?? defaultResolveModPackProvider,
  };

  const bySteamId = new Map<number, TrainerCatalogEntry>();
  const byExecutable = new Map<string, TrainerCatalogEntry[]>();

  for (const entry of catalog) {
    // No upper bound on steamAppId — real Steam appids routinely exceed
    // 1,000,000 today (e.g. Starfield 1716740, Palworld 1623730, Crimson
    // Desert Enhanced 3321460, Baldur's Gate 3 1086940, all confirmed
    // against real installs). An earlier `< 1_000_000` ceiling here was
    // this exact D07 defect class recurring inside the fix for D07 itself
    // — it silently dropped Baldur's Gate 3 out of steamAppId-tier
    // matching entirely.
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

    // Trainer-applicability boundary (ROADMAP.md Phase 3): a catalog match
    // is never accepted for an install whose own resolved executable is a
    // launcher/updater/tool/server/benchmark/anti-cheat-bootstrap binary —
    // bad catalog data or a scanner picking up the wrong file must not
    // attach a trainer to the wrong process.
    if (match && game.executablePath && !checkExecutableRoleApplicability(game.executablePath).applicable) {
      match = undefined;
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
