import fs from 'node:fs';
import path from 'node:path';
import type { RawInstalledGame } from './types.js';
import { listRegistrySubkeys, readRegistryString } from './registry-win.js';

const GOG_GAMES_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';

export function scanGogInstalls(): RawInstalledGame[] {
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

    let executablePath: string | undefined;
    if (exeName) {
      const candidate = path.isAbsolute(exeName) ? exeName : path.join(installPath, exeName);
      if (fs.existsSync(candidate)) executablePath = candidate;
    }

    results.push({
      platform: 'gog',
      installPath: path.resolve(installPath),
      executablePath: executablePath ? path.resolve(executablePath) : undefined,
      displayName: displayName ?? undefined,
    });
  }

  return results;
}
