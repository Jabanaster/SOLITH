import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { listRegistrySubkeys, readRegistryString } from './registry-win.js';

/**
 * Battle.net re-investigation (read-only local evidence only; product.db
 * stays rejected as an undocumented protobuf format — see
 * provider-capabilities.ts for the full history).
 *
 * Blizzard installs each Battle.net-managed title through the shared
 * `C:\ProgramData\Battle.net\Agent\Blizzard Uninstaller.exe`, and — like any
 * conventional Windows installer-driven product — that uninstaller registers
 * a standard "Programs and Features" entry per title under the well-known,
 * fully documented Windows Uninstall registry location:
 *
 *   HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\<GameDisplayName>
 *   HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\<GameDisplayName>
 *
 * Unlike Ubisoft's/EA's registry shape, the subkey name IS the game's literal
 * display name (e.g. "StarCraft II", "World of Warcraft") rather than an
 * opaque numeric/offer id, and the values present are plain strings:
 * `DisplayName`, `Publisher`, `UninstallString` (observed as the shared
 * `...\Battle.net\Agent\Blizzard Uninstaller.exe` for every Blizzard title),
 * and — critically — `DisplayIcon`, which is set to the full path of the
 * game's actual launch executable (e.g. `D:\Games\World of Warcraft\
 * Wow.exe`), and/or `InstallLocation` pointing at the install folder. These
 * are the same plain string values Steam/GOG-style installers write; nothing
 * here is protobuf, undocumented, or guessed-at wire format.
 *
 * This is the mechanism the owner asked to be investigated, and it is real:
 * it is the standard Windows Installer "Uninstall" contract (see
 * https://learn.microsoft.com/windows/win32/msi/uninstall-registry-key),
 * simply populated by Blizzard's own installer rather than MSI directly.
 *
 * Reliability caveat (why this stays 'partial', not 'supported'): this key
 * enumerates every installed Windows application on the machine, not just
 * Blizzard titles, so a per-subkey corroboration check is required (see
 * `looksLikeBattleNetEntry` below — requires the shared Blizzard uninstaller
 * path and/or the literal "Blizzard Entertainment" publisher string).
 * Community reports also describe titles occasionally missing from
 * Programs-and-Features after certain repair/update flows, so — unlike
 * Ubisoft's Installs registry key, which is written directly by the launcher
 * for every tracked install — this signal cannot be treated as exhaustive.
 * That fragility, not any format-safety concern, is why this scanner is
 * marked 'partial' in provider-capabilities.ts, matching ea.ts's precedent.
 *
 * Deliberately NOT implemented: `%PROGRAMDATA%\Battle.net\Agent\product.db`
 * (undocumented protobuf — reverse-engineering it stays out of scope per
 * explicit instruction) and per-title `.build.info`/`.flavor.info` files
 * (only useful to confirm identity for a path already suspected to be a
 * Battle.net title — no central enumeration value, and would require
 * already knowing the install path this scanner exists to discover).
 */
const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

const BLIZZARD_UNINSTALLER_RE = /battle\.net\\agent\\blizzard uninstaller\.exe/i;
const BLIZZARD_PUBLISHER_RE = /^blizzard entertainment$/i;

interface BattleNetFixtureEntry {
  displayName?: string;
  DisplayName?: string;
  publisher?: string;
  Publisher?: string;
  uninstallString?: string;
  UninstallString?: string;
  displayIcon?: string;
  DisplayIcon?: string;
  installLocation?: string;
  InstallLocation?: string;
}

interface UninstallEntryFields {
  displayName?: string;
  publisher?: string;
  uninstallString?: string;
  displayIcon?: string;
  installLocation?: string;
}

/**
 * Corroboration gate: the Windows Uninstall key holds every installed
 * application, so a subkey must show a real Blizzard-specific marker before
 * being trusted as a Battle.net title. Requires the shared Blizzard
 * uninstaller path and/or the exact "Blizzard Entertainment" publisher
 * string — an entry that merely mentions "battle.net" or "blizzard" in its
 * display name without either marker is excluded, not guessed at.
 */
function looksLikeBattleNetEntry(fields: UninstallEntryFields): boolean {
  const uninstallerMatch = Boolean(fields.uninstallString && BLIZZARD_UNINSTALLER_RE.test(fields.uninstallString));
  const publisherMatch = Boolean(fields.publisher && BLIZZARD_PUBLISHER_RE.test(fields.publisher.trim()));
  return uninstallerMatch || publisherMatch;
}

function findFirstTopLevelExecutable(installDir: string): string | undefined {
  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    const exe = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'));
    return exe ? path.join(installDir, exe.name) : undefined;
  } catch {
    return undefined;
  }
}

function resolveFromEntry(fields: UninstallEntryFields, subkeyName: string): RawInstalledGame | null {
  if (!looksLikeBattleNetEntry(fields)) return null;

  let executablePath: string | undefined;
  const displayIcon = fields.displayIcon?.trim();
  if (displayIcon && fs.existsSync(displayIcon) && fs.statSync(displayIcon).isFile()) {
    executablePath = path.resolve(displayIcon);
  }

  let installPath: string | undefined;
  const installLocation = fields.installLocation?.trim();
  if (installLocation && fs.existsSync(installLocation) && fs.statSync(installLocation).isDirectory()) {
    installPath = path.resolve(installLocation);
  } else if (executablePath) {
    installPath = path.dirname(executablePath);
  }

  if (!installPath || !fs.existsSync(installPath)) return null;

  if (!executablePath) {
    executablePath = findFirstTopLevelExecutable(installPath);
  }

  const displayName = fields.displayName?.trim() || subkeyName;

  return {
    platform: 'battlenet',
    installPath,
    executablePath: executablePath ? path.resolve(executablePath) : undefined,
    displayName,
    launcherAppId: `battlenet:${subkeyName}`,
  };
}

/** Offline/fixture path used by unit tests. */
export function scanBattleNetInstallsFromFixture(fixturePath: string): RawInstalledGame[] {
  if (!fs.existsSync(fixturePath)) return [];
  const raw = JSON.parse(
    fs.readFileSync(fixturePath, 'utf8').replace(/^﻿/, ''),
  ) as BattleNetFixtureEntry[];
  if (!Array.isArray(raw)) return [];

  const results: RawInstalledGame[] = [];
  for (const [index, entry] of raw.entries()) {
    const displayName = entry.displayName ?? entry.DisplayName;
    const subkeyName = displayName ?? `entry-${index}`;
    const resolved = resolveFromEntry(
      {
        displayName,
        publisher: entry.publisher ?? entry.Publisher,
        uninstallString: entry.uninstallString ?? entry.UninstallString,
        displayIcon: entry.displayIcon ?? entry.DisplayIcon,
        installLocation: entry.installLocation ?? entry.InstallLocation,
      },
      subkeyName,
    );
    if (resolved) results.push(resolved);
  }
  return results;
}

export function scanBattleNetInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  if (options.battleNetFixturePath) {
    return scanBattleNetInstallsFromFixture(options.battleNetFixturePath);
  }

  const results: RawInstalledGame[] = [];
  const seenSubkeys = new Set<string>();

  for (const uninstallKey of UNINSTALL_KEYS) {
    const subkeys = listRegistrySubkeys(uninstallKey);
    for (const subkey of subkeys) {
      if (seenSubkeys.has(subkey)) continue;
      const keyPath = `${uninstallKey}\\${subkey}`;
      const uninstallString = readRegistryString(keyPath, 'UninstallString');
      if (!uninstallString || !BLIZZARD_UNINSTALLER_RE.test(uninstallString)) {
        const publisher = readRegistryString(keyPath, 'Publisher');
        if (!publisher || !BLIZZARD_PUBLISHER_RE.test(publisher.trim())) continue;
      }
      seenSubkeys.add(subkey);

      const fields: UninstallEntryFields = {
        displayName: readRegistryString(keyPath, 'DisplayName') ?? undefined,
        publisher: readRegistryString(keyPath, 'Publisher') ?? undefined,
        uninstallString: uninstallString ?? undefined,
        displayIcon: readRegistryString(keyPath, 'DisplayIcon') ?? undefined,
        installLocation: readRegistryString(keyPath, 'InstallLocation') ?? undefined,
      };
      const resolved = resolveFromEntry(fields, subkey);
      if (resolved) results.push(resolved);
    }
  }
  return results;
}
