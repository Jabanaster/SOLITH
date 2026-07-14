import { execSync } from 'node:child_process';

function isWindows(): boolean {
  return process.platform === 'win32';
}

export function readRegistryString(hiveKey: string, valueName: string): string | null {
  if (!isWindows()) return null;
  try {
    const out = execSync(`reg query "${hiveKey}" /v ${valueName}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
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
    const out = execSync(`reg query "${hiveKey}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
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
