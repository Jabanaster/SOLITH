import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { listRegistrySubkeys, readRegistryString } from './registry-win.js';

/**
 * EA's local install metadata genuinely shifted with the Origin -> EA Desktop
 * transition, so this implementation reasons about two independently
 * verifiable, documented signals rather than guessing at EA's own internal
 * formats:
 *
 * 1. The classic Origin registry shape,
 *    `HKLM\SOFTWARE\WOW6432Node\Origin Games\<offerId>` with an `Install Dir`
 *    string value. Many EA Desktop installs still honor/write this key for
 *    backward compatibility with the older Origin client and third-party
 *    tools that expect it — it mirrors how gog.ts reads
 *    `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games`.
 *
 * 2. The standard Windows "Add/Remove Programs" uninstall registry key,
 *    `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\
 *    <ProductCode>` (and the non-WOW6432Node mirror). This is a
 *    Microsoft-documented, OS-level mechanism every Windows installer is
 *    expected to populate — not an EA-specific or reverse-engineered format.
 *    EA Desktop titles register an entry here (as does virtually every
 *    Windows installer, including EA Desktop itself) with `DisplayName`,
 *    `Publisher`, and — for most titles — `InstallLocation`. Filtering to
 *    `Publisher` containing "Electronic Arts" and excluding EA's own client/
 *    service entries by name gives a real, verifiable EA Desktop install
 *    signal without touching any EA-proprietary manifest/database format.
 *
 * Deliberately NOT implemented: parsing `%PROGRAMDATA%\Origin\LocalContent\
 * <offerId>\*.mfst` manifest files or the EA Desktop client's own local
 * database/manifest files under `%PROGRAMDATA%\EA Desktop\`. Both are
 * plausible per publicly discussed EA Desktop behavior, but neither has a
 * publicly documented, stable schema — EA has changed the EA Desktop local
 * manifest shape across client versions without notice, and there is no
 * confirmable field layout to parse with confidence. Treat those as a
 * documented possibility for a future pass, not something this scanner
 * relies on.
 */
const EA_GAMES_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Origin Games';

/**
 * Standard Windows uninstall registry locations. Every installer that wants
 * to show up in "Add or Remove Programs" is expected to write here — this is
 * Microsoft's own documented mechanism, not something EA-specific.
 */
const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

/** Only entries clearly published by EA are candidates at all. */
const EA_PUBLISHER_RE = /electronic arts/i;

/**
 * EA Desktop, the Origin client, and related EA background services/helpers
 * all register their own uninstall entries with Publisher "Electronic Arts"
 * — same as any actual game — so publisher alone is not sufficient. Exclude
 * the launcher/client/service/redistributable entries by name so this
 * scanner does not report EA's own software as an installed "game".
 */
const EA_NON_GAME_NAME_RE = /^(ea (desktop|app|play|origin)|origin)$|anti-?cheat|background service|redistributable|update service|overlay/i;

interface EaFixtureEntry {
  /** Classic Origin registry shape (offerId + Install Dir). */
  offerId?: string;
  installDir?: string;
  'Install Dir'?: string;
  exe?: string;
  displayName?: string;
  /**
   * When set to 'ea-desktop', this entry is treated as a standard Windows
   * uninstall-registry record (see UNINSTALL_KEYS above) rather than the
   * classic Origin Games key, and is subject to the same publisher/name
   * filtering as the live registry scan. Defaults to 'origin' for backward
   * compatibility with existing fixtures.
   */
  source?: 'origin' | 'ea-desktop';
  publisher?: string;
  /** Uninstall registry subkey name (product code / GUID), used as identity for ea-desktop entries. */
  uninstallKey?: string;
}

/**
 * The classic Origin registry key does not reliably carry an executable
 * name, and neither does the generic Windows uninstall key. Fall back to the
 * first top-level `.exe` in the install directory — same shallow-scan
 * heuristic used in ubisoft.ts / resolveSteamExecutable's readdir fallback in
 * steam.ts.
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
  installDirRaw: unknown,
  exeNameRaw: unknown,
  displayNameRaw: unknown,
  launcherAppId: string,
): RawInstalledGame | null {
  const installDir = typeof installDirRaw === 'string' ? installDirRaw.trim() : undefined;
  if (!installDir || !fs.existsSync(installDir)) return null;

  let installDirStat: fs.Stats;
  try {
    installDirStat = fs.statSync(installDir);
  } catch {
    return null;
  }
  if (!installDirStat.isDirectory()) return null;

  const resolvedInstallDir = path.resolve(installDir);

  let executablePath: string | undefined;
  const exeName = typeof exeNameRaw === 'string' ? exeNameRaw.trim() : undefined;
  if (exeName) {
    const candidate = path.isAbsolute(exeName) ? exeName : path.join(resolvedInstallDir, exeName);
    if (fs.existsSync(candidate)) executablePath = candidate;
  }
  if (!executablePath) {
    executablePath = findFirstTopLevelExecutable(resolvedInstallDir);
  }

  const displayNameRawTrimmed = typeof displayNameRaw === 'string' ? displayNameRaw.trim() : '';
  const displayName = displayNameRawTrimmed || path.basename(resolvedInstallDir);

  return {
    platform: 'ea',
    installPath: resolvedInstallDir,
    executablePath: executablePath ? path.resolve(executablePath) : undefined,
    displayName,
    launcherAppId,
  };
}

/**
 * True when a Windows uninstall-registry entry looks like an EA-published
 * game rather than EA's own client/service/redistributable software. Used
 * both by the live registry scan and by fixture-driven tests of the same
 * filtering logic.
 */
function isEaDesktopGameCandidate(publisherRaw: unknown, displayNameRaw: unknown): boolean {
  const publisher = typeof publisherRaw === 'string' ? publisherRaw.trim() : '';
  const displayName = typeof displayNameRaw === 'string' ? displayNameRaw.trim() : '';
  if (!EA_PUBLISHER_RE.test(publisher)) return false;
  if (!displayName) return false;
  if (EA_NON_GAME_NAME_RE.test(displayName)) return false;
  return true;
}

/** Offline/fixture path used by unit tests. */
export function scanEaInstallsFromFixture(fixturePath: string): RawInstalledGame[] {
  if (!fs.existsSync(fixturePath)) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8').replace(/^﻿/, ''));
  } catch {
    // Malformed fixture JSON degrades to "no installs found", never a crash.
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const results: RawInstalledGame[] = [];
  for (const [index, entryRaw] of (raw as unknown[]).entries()) {
    if (!entryRaw || typeof entryRaw !== 'object') continue;
    const entry = entryRaw as EaFixtureEntry;

    if (entry.source === 'ea-desktop') {
      if (!isEaDesktopGameCandidate(entry.publisher, entry.displayName)) continue;
      const uninstallKey = entry.uninstallKey ?? String(index);
      const resolved = resolveFromEntry(
        entry.installDir ?? entry['Install Dir'],
        entry.exe,
        entry.displayName,
        `ea-desktop:${uninstallKey}`,
      );
      if (resolved) results.push(resolved);
      continue;
    }

    const offerId = entry.offerId ?? String(index);
    const resolved = resolveFromEntry(
      entry.installDir ?? entry['Install Dir'],
      entry.exe,
      entry.displayName,
      `ea:${offerId}`,
    );
    if (resolved) results.push(resolved);
  }
  return results;
}

/** Classic Origin registry shape: one subkey per offerId, `Install Dir` value. */
function scanClassicOriginInstalls(): RawInstalledGame[] {
  const subkeys = listRegistrySubkeys(EA_GAMES_KEY);
  if (subkeys.length === 0) return [];

  const results: RawInstalledGame[] = [];
  for (const subkey of subkeys) {
    const keyPath = `${EA_GAMES_KEY}\\${subkey}`;
    const installDir = readRegistryString(keyPath, 'Install Dir');
    const resolved = resolveFromEntry(installDir ?? undefined, undefined, undefined, `ea:${subkey}`);
    if (resolved) results.push(resolved);
  }
  return results;
}

/**
 * Standard Windows uninstall-registry shape: enumerate every subkey under
 * each UNINSTALL_KEYS root, read DisplayName/Publisher/InstallLocation, and
 * keep only entries that look like EA-published games (see
 * isEaDesktopGameCandidate). This is the same generic mechanism every
 * installed-program lister on Windows relies on — nothing EA-specific is
 * guessed at here.
 */
function scanEaDesktopUninstallInstalls(): RawInstalledGame[] {
  const results: RawInstalledGame[] = [];
  for (const uninstallRoot of UNINSTALL_KEYS) {
    let subkeys: string[];
    try {
      subkeys = listRegistrySubkeys(uninstallRoot);
    } catch {
      continue;
    }
    for (const subkey of subkeys) {
      const keyPath = `${uninstallRoot}\\${subkey}`;
      let publisher: string | null;
      let displayName: string | null;
      let installLocation: string | null;
      try {
        publisher = readRegistryString(keyPath, 'Publisher');
        displayName = readRegistryString(keyPath, 'DisplayName');
        installLocation = readRegistryString(keyPath, 'InstallLocation');
      } catch {
        continue;
      }
      if (!isEaDesktopGameCandidate(publisher ?? undefined, displayName ?? undefined)) continue;
      const resolved = resolveFromEntry(
        installLocation ?? undefined,
        undefined,
        displayName ?? undefined,
        `ea-desktop:${subkey}`,
      );
      if (resolved) results.push(resolved);
    }
  }
  return results;
}

export function scanEaInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  if (options.eaFixturePath) {
    return scanEaInstallsFromFixture(options.eaFixturePath);
  }

  // Both sources are independently read-only and best-effort; a failure in
  // one must never suppress results from the other. Downstream dedup across
  // sources/platforms already happens centrally in index.ts's
  // deduplicateConcreteInstalls, so this simply concatenates raw results.
  const results: RawInstalledGame[] = [];
  try {
    results.push(...scanClassicOriginInstalls());
  } catch {
    // Best-effort — the EA Desktop uninstall-registry source is still tried below.
  }
  try {
    results.push(...scanEaDesktopUninstallInstalls());
  } catch {
    // Best-effort — classic Origin results (if any) are still returned.
  }
  return results;
}
