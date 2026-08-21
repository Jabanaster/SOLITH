import { execFileSync } from 'node:child_process';
import { systemBinaryPath } from '../safety/system-binary.js';

function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * execFileSync (array args, no shell, absolute System32 path) — no PATH
 * lookup and no shell interpolation of hiveKey/valueName, unlike the prior
 * `execSync(\`reg query "${hiveKey}" ...\`)` form (Phase 7 hardening).
 */
function regQuery(args: string[]): string {
  return execFileSync(systemBinaryPath('reg.exe'), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
}

export function readRegistryString(hiveKey: string, valueName: string): string | null {
  if (!isWindows()) return null;
  try {
    const out = regQuery(['query', hiveKey, '/v', valueName]);
    const line = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().includes(valueName.toLowerCase()));
    if (!line) return null;
    const parts = line.split(/\s{2,}/);
    return parts.length >= 3 ? parts.slice(2).join(' ').trim() : null;
  } catch {
    return null;
  }
}

export function listRegistrySubkeys(hiveKey: string): string[] {
  if (!isWindows()) return [];
  try {
    const out = regQuery(['query', hiveKey]);
    const prefix = hiveKey.replace(/\\/g, '\\\\');
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('HKEY_') && l.includes(prefix) && l !== hiveKey)
      .map((l) => l.split('\\').pop()!)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function defaultSteamInstallPath(): string | null {
  return (
    readRegistryString('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath') ??
    readRegistryString('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath')
  );
}

export function defaultEpicManifestsPath(): string | null {
  const appDataPath = readRegistryString(
    'HKCU\\Software\\Epic Games\\EpicGamesLauncher',
    'AppDataPath',
  );
  if (appDataPath) {
    const manifests = `${appDataPath}\\Data\\Manifests`;
    return manifests;
  }
  return 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
}
