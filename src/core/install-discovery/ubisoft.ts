import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { listRegistrySubkeys, readRegistryString } from './registry-win.js';

/**
 * Ubisoft Connect (formerly Uplay) writes one subkey per installed title
 * under this registry key. Each subkey name is an internal numeric game id
 * (not human-readable) and carries an `InstallDir` string value pointing at
 * the install folder. This is the most stable local signal Ubisoft Connect
 * exposes — mirrors how gog.ts reads `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games`.
 *
 * Deliberately NOT relied upon: `%LOCALAPPDATA%\Ubisoft Game
 * Launcher\settings.yml` / `cache\` — format and reliability vary by client
 * version and are not documented, so parsing them would be guessing. If a
 * future pass wants richer metadata (real display names), that cache is the
 * place to look, but it should be treated as optional/best-effort only.
 */
const UBISOFT_INSTALLS_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs';

interface UbisoftFixtureEntry {
  gameId?: string;
  installDir?: string;
  InstallDir?: string;
  exe?: string;
  displayName?: string;
}

/**
 * Ubisoft's registry key alone rarely names an executable, unlike GOG's
 * `exe` value. Fall back to the first top-level `.exe` found directly in the
 * install directory — the same shallow-scan pattern `resolveSteamExecutable`
 * uses in steam.ts when no known executable list applies. There is no
 * reliable per-title executable name list for Ubisoft titles in this
 * codebase, so this is a best-effort heuristic, not a guarantee of picking
 * the correct launch executable for multi-exe installs.
 */
function findFirstTopLevelExecutable(installDir: string): string | undefined {
  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    const exe = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'));
    return exe ? path.join(installDir, exe.name) : undefined;
  } catch {
    return undefined;
  }
}

function resolveFromEntry(
  installDirRaw: string | undefined,
  exeNameRaw: string | undefined,
  displayNameRaw: string | undefined,
  gameId: string,
): RawInstalledGame | null {
  const installDir = installDirRaw?.trim();
  if (!installDir || !fs.existsSync(installDir)) return null;

  const resolvedInstallDir = path.resolve(installDir);

  let executablePath: string | undefined;
  const exeName = exeNameRaw?.trim();
  if (exeName) {
    const candidate = path.isAbsolute(exeName) ? exeName : path.join(resolvedInstallDir, exeName);
    if (fs.existsSync(candidate)) executablePath = candidate;
  }
  if (!executablePath) {
    executablePath = findFirstTopLevelExecutable(resolvedInstallDir);
  }

  const displayName = displayNameRaw?.trim() || path.basename(resolvedInstallDir);

  return {
    platform: 'ubisoft',
    installPath: resolvedInstallDir,
    executablePath: executablePath ? path.resolve(executablePath) : undefined,
    displayName,
    launcherAppId: `ubisoft:${gameId}`,
  };
}

/** Offline/fixture path used by unit tests. */
export function scanUbisoftInstallsFromFixture(fixturePath: string): RawInstalledGame[] {
  if (!fs.existsSync(fixturePath)) return [];
  const raw = JSON.parse(
    fs.readFileSync(fixturePath, 'utf8').replace(/^﻿/, ''),
  ) as UbisoftFixtureEntry[];
  if (!Array.isArray(raw)) return [];

  const results: RawInstalledGame[] = [];
  for (const [index, entry] of raw.entries()) {
    const gameId = entry.gameId ?? String(index);
    const resolved = resolveFromEntry(
      entry.installDir ?? entry.InstallDir,
      entry.exe,
      entry.displayName,
      gameId,
    );
    if (resolved) results.push(resolved);
  }
  return results;
}

export function scanUbisoftInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  if (options.ubisoftFixturePath) {
    return scanUbisoftInstallsFromFixture(options.ubisoftFixturePath);
  }

  const subkeys = listRegistrySubkeys(UBISOFT_INSTALLS_KEY);
  if (subkeys.length === 0) return [];

  const results: RawInstalledGame[] = [];
  for (const subkey of subkeys) {
    const keyPath = `${UBISOFT_INSTALLS_KEY}\\${subkey}`;
    const installDir = readRegistryString(keyPath, 'InstallDir');
    const resolved = resolveFromEntry(installDir ?? undefined, undefined, undefined, subkey);
    if (resolved) results.push(resolved);
  }
  return results;
}
