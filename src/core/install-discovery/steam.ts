import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { parseVdf, vdfStringValue } from './vdf.js';
import { defaultSteamInstallPath } from './registry-win.js';
import { executablesForSteamAppId } from '../trainer-catalog/steam-executable-lookup.js';

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

function resolveSteamExecutable(installDir: string, steamAppId: number): string | undefined {
  const known = executablesForSteamAppId(steamAppId);
  if (known) {
    for (const exe of known) {
      const candidate = path.join(installDir, exe);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    const exes = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
      .map((e) => path.join(installDir, e.name));
    return exes[0];
  } catch {
    return undefined;
  }
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
