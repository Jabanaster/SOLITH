import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { listRegistrySubkeys, readRegistryString } from './registry-win.js';

const GOG_GAMES_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';

interface GogFixtureEntry {
  path?: string;
  PATH?: string;
  exe?: string;
  launchCommand?: string;
  gameName?: string;
  GAMENAME?: string;
}

function resolveFromEntry(entry: GogFixtureEntry, keyFallback = 'unknown'): RawInstalledGame | null {
  const installPath = entry.path?.trim() || entry.PATH?.trim();
  if (!installPath || !fs.existsSync(installPath)) return null;

  const exeName = entry.exe?.trim() || entry.launchCommand?.trim();
  const displayName = entry.gameName?.trim() || entry.GAMENAME?.trim() || keyFallback;

  let executablePath: string | undefined;
  if (exeName) {
    const candidate = path.isAbsolute(exeName) ? exeName : path.join(installPath, exeName);
    if (fs.existsSync(candidate)) executablePath = candidate;
  }

  return {
    platform: 'gog',
    installPath: path.resolve(installPath),
    executablePath: executablePath ? path.resolve(executablePath) : undefined,
    displayName: displayName || undefined,
  };
}

/** Offline/fixture path used by unit tests. */
export function scanGogInstallsFromFixture(fixturePath: string): RawInstalledGame[] {
  if (!fs.existsSync(fixturePath)) return [];
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, '')) as GogFixtureEntry[];
  if (!Array.isArray(raw)) return [];
  const results: RawInstalledGame[] = [];
  for (const entry of raw) {
    const resolved = resolveFromEntry(entry);
    if (resolved) results.push(resolved);
  }
  return results;
}

export function scanGogInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  if (options.gogFixturePath) {
    return scanGogInstallsFromFixture(options.gogFixturePath);
  }

  const subkeys = listRegistrySubkeys(GOG_GAMES_KEY);
  if (subkeys.length === 0) return [];

  const results: RawInstalledGame[] = [];

  for (const subkey of subkeys) {
    const keyPath = `${GOG_GAMES_KEY}\\${subkey}`;
    const installPath = readRegistryString(keyPath, 'path') ?? readRegistryString(keyPath, 'PATH');
    if (!installPath || !fs.existsSync(installPath)) continue;

    const exeName = readRegistryString(keyPath, 'exe') ?? readRegistryString(keyPath, 'launchCommand');
    const displayName =
      readRegistryString(keyPath, 'gameName') ??
      readRegistryString(keyPath, 'GAMENAME') ??
      subkey;

    const resolved = resolveFromEntry(
      {
        path: installPath,
        exe: exeName ?? undefined,
        gameName: displayName ?? undefined,
      },
      subkey,
    );
    if (resolved) results.push(resolved);
  }

  return results;
}
