import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { parseVdf, vdfStringValue } from './vdf.js';
import { defaultSteamInstallPath } from './registry-win.js';
import { executablesForSteamAppId } from '../trainer-catalog/steam-executable-lookup.js';
import { resolvePrimaryExecutable } from './nested-executable-discovery.js';

function listSteamLibraryRoots(steamRoot: string): string[] {
  const roots = new Set<string>();
  const normalized = path.resolve(steamRoot);
  roots.add(normalized);

  const foldersFile = path.join(normalized, 'steamapps', 'libraryfolders.vdf');
  if (!fs.existsSync(foldersFile)) return [...roots];

  try {
    const parsed = parseVdf(fs.readFileSync(foldersFile, 'utf8'));
    const libraryfolders = parsed.libraryfolders as Record<string, unknown> | undefined;
    if (!libraryfolders) return [...roots];

    for (const value of Object.values(libraryfolders)) {
      if (typeof value === 'string' && value.trim()) {
        roots.add(path.resolve(value.trim()));
      } else if (value && typeof value === 'object') {
        const pathValue = vdfStringValue(value as Record<string, unknown>, 'path');
        if (pathValue) roots.add(path.resolve(pathValue.trim()));
      }
    }
  } catch {
    // Best-effort — primary steam root still scanned
  }

  return [...roots];
}

/**
 * Resolves the one playable executable for a real Steam install. Real-game
 * validation (ROADMAP.md Phase 3 Exit Gate curated titles) found the
 * previous implementation here — a root-directory-only existence check
 * against `STEAM_EXECUTABLE_LOOKUP`, falling back to the first `.exe` found
 * in filesystem enumeration order — silently wrong for any title whose real
 * executable is nested (this is the exact "Crimson Desert resolution gap"
 * ROADMAP.md Phase 3 names: `bin64/CrimsonDesert.exe`), and for Palworld it
 * resolved to the root-level launcher stub (`Palworld.exe`) instead of the
 * real Unreal Engine binary (`Pal/Binaries/Win64/Palworld-Win64-Shipping.exe`)
 * because the known name was never found at root and the shallow fallback
 * arbitrarily returned whatever `.exe` happened to be first. Delegates to
 * the bounded recursive discovery + role classification already used by the
 * manual/Xbox library scanner, seeded with the curated known-executable
 * names as evidence, and fails closed (`undefined`) rather than guessing an
 * arbitrary `.exe` when no confident primary can be resolved.
 */
function resolveSteamExecutable(installDir: string, steamAppId: number): string | undefined {
  const known = executablesForSteamAppId(steamAppId) ?? undefined;
  // STEAM_EXECUTABLE_LOOKUP is a hand-authored literal source array (see
  // steam-executable-lookup.ts) — its declared order is a verified curator
  // choice, so it is safe to opt into trustDeclaredExecutableOrder here
  // (e.g. Baldur's Gate 3's ['bg3.exe', 'bg3_dx11.exe']). This is NOT
  // extended to the trainer catalog's own executables list, whose order is
  // not verified to carry the same meaning.
  const primary = resolvePrimaryExecutable(installDir, {
    knownCatalogExecutables: known,
    trustDeclaredExecutableOrder: true,
  });
  return primary?.absolutePath;
}

function parseSteamManifest(manifestPath: string, libraryRoot: string): RawInstalledGame | null {
  try {
    const parsed = parseVdf(fs.readFileSync(manifestPath, 'utf8'));
    const state = (parsed.AppState ?? parsed) as Record<string, unknown>;
    const appIdRaw = vdfStringValue(state, 'appid');
    const installdir = vdfStringValue(state, 'installdir');
    if (!appIdRaw || !installdir) return null;

    const steamAppId = Number.parseInt(appIdRaw, 10);
    if (!Number.isFinite(steamAppId)) return null;

    const installPath = path.join(libraryRoot, 'steamapps', 'common', installdir);
    if (!fs.existsSync(installPath)) return null;

    const displayName = vdfStringValue(state, 'name') ?? installdir;
    const executablePath = resolveSteamExecutable(installPath, steamAppId);

    return {
      platform: 'steam',
      installPath,
      executablePath,
      displayName,
      steamAppId,
    };
  } catch {
    return null;
  }
}

export function scanSteamInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  const steamRoot = options.steamInstallPath ?? defaultSteamInstallPath();
  if (!steamRoot || !fs.existsSync(steamRoot)) return [];

  const results: RawInstalledGame[] = [];
  const libraries = listSteamLibraryRoots(steamRoot);

  for (const libraryRoot of libraries) {
    const steamapps = path.join(libraryRoot, 'steamapps');
    if (!fs.existsSync(steamapps)) continue;

    let manifests: string[] = [];
    try {
      manifests = fs
        .readdirSync(steamapps)
        .filter((name) => /^appmanifest_\d+\.acf$/i.test(name))
        .map((name) => path.join(steamapps, name));
    } catch {
      continue;
    }

    for (const manifestPath of manifests) {
      const game = parseSteamManifest(manifestPath, libraryRoot);
      if (game) results.push(game);
    }
  }

  return results;
}
