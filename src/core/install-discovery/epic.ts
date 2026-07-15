import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { defaultEpicManifestsPath } from './registry-win.js';

interface EpicManifestItem {
  DisplayName?: string;
  InstallLocation?: string;
  LaunchExecutable?: string;
  MainGameAppName?: string;
  AppName?: string;
}

export function scanEpicInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  const manifestsDir = options.epicManifestsPath ?? defaultEpicManifestsPath();
  if (!manifestsDir || !fs.existsSync(manifestsDir)) return [];

  const results: RawInstalledGame[] = [];

  let files: string[] = [];
  try {
    files = fs.readdirSync(manifestsDir).filter((name) => name.endsWith('.item'));
  } catch {
    return [];
  }

  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(manifestsDir, file), 'utf8').replace(/^\uFEFF/, '');
      const raw = JSON.parse(text) as EpicManifestItem;
      const installPath = raw.InstallLocation?.trim();
      if (!installPath || !fs.existsSync(installPath)) continue;

      const launchExe = raw.LaunchExecutable?.trim();
      const executablePath =
        launchExe && fs.existsSync(path.join(installPath, launchExe))
          ? path.join(installPath, launchExe)
          : undefined;

      results.push({
        platform: 'epic',
        installPath: path.resolve(installPath),
        executablePath: executablePath ? path.resolve(executablePath) : undefined,
        displayName: raw.DisplayName ?? raw.AppName ?? raw.MainGameAppName ?? path.basename(installPath),
      });
    } catch {
      // Skip malformed manifest
    }
  }

  return results;
}
