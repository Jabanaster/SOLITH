/**
 * Xbox / Microsoft Store install discovery (ROADMAP.md Phase 3 — Atomfall
 * scope closure). Authoritative source: the OS's own AppX package
 * registration (`Get-AppxPackage`), not filesystem crawling — mirrors the
 * `reg.exe`-shelling pattern already established in registry-win.ts.
 * `InstallLocation` for a Microsoft GDK package resolves (transparently,
 * through any reparse-point/junction the Xbox app used to relocate the
 * install to another drive) to the package's real content root, which is
 * where `appxmanifest.xml` / `MicrosoftGame.config` and the game's own
 * executables live — confirmed against a real installed Atomfall
 * (`Rebellion.Windscale`, moved to a custom `Z:\Games\Atomfall` root by the
 * Xbox app, reachable only via a two-hop NTFS junction chain from
 * `C:\Program Files\WindowsApps\...`; plain directory enumeration through
 * the reported `InstallLocation` reaches the real files without this module
 * having to resolve or even know about the junction chain itself).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { systemPowerShellPath } from '../safety/system-binary.js';
import { parseAppxManifest, parseMicrosoftGameConfig } from './xbox-manifest.js';
import { discoverGameExecutables, resolvePrimaryExecutable } from './nested-executable-discovery.js';

export interface XboxPackageInfo {
  name: string;
  packageFamilyName: string;
  packageFullName: string;
  publisher: string;
  version: string;
  installLocation: string;
}

// Any executable living under a directory literally named Launcher/Bootstrap
// is real, generalizable evidence it is a thin relaunch stub, not the actual
// game process — this is the standard Microsoft GDK packaging shape (the
// package's own declared "Play" entry point re-execs the true engine binary
// from a sibling location), not a per-title guess. Confirmed against the
// real Atomfall install: MicrosoftGame.config/appxmanifest.xml both declare
// `Launcher/Atomfall.exe` (a 1.8MB bootstrap stub) as "the" executable, while
// the actual playable engine binary is `bin/Atomfall_dx12.exe` (332MB) — the
// same binary SOLITH's own live-memory baseline for Atomfall already
// resolves against (game-connection-baselines.ts, bundled-definition-seed.ts).
const PACKAGE_LAUNCHER_DIR_RE = /(?:^|\/)(?:launcher|bootstrap(?:per)?)(?:\/|$)/i;

function isWindows(): boolean {
  return process.platform === 'win32';
}

function queryAppxPackages(): XboxPackageInfo[] {
  if (!isWindows()) return [];
  const script = [
    `$ErrorActionPreference = 'Continue'`,
    `Get-AppxPackage | ForEach-Object {`,
    `  Write-Output (($_.Name) + [char]9 + ($_.PackageFamilyName) + [char]9 + ($_.PackageFullName) + [char]9 + ($_.Publisher) + [char]9 + ($_.Version) + [char]9 + ($_.InstallLocation))`,
    `}`,
  ].join('; ');

  try {
    const raw = execFileSync(
      systemPowerShellPath(),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, packageFamilyName, packageFullName, publisher, version, installLocation] = line.split('\t');
        return {
          name: name ?? '',
          packageFamilyName: packageFamilyName ?? '',
          packageFullName: packageFullName ?? '',
          publisher: publisher ?? '',
          version: version ?? '',
          installLocation: installLocation ?? '',
        };
      })
      .filter((pkg) => pkg.name && pkg.installLocation);
  } catch {
    // Package enumeration unavailable (non-Windows, PowerShell missing,
    // AppX subsystem error) — fail closed to no Xbox installs, never crash
    // the whole discovery scan.
    return [];
  }
}

/**
 * Resolves the one playable executable for an Xbox/MS Store content root.
 * Package metadata (`MicrosoftGame.config`'s ExecutableList, the manifest's
 * `<Application Executable>`) is real evidence and is passed through as
 * `knownCatalogExecutables` — but any declared executable sitting inside a
 * Launcher/Bootstrap directory is demoted first (see PACKAGE_LAUNCHER_DIR_RE)
 * so a bootstrap stub the package itself "declares" as primary can never win
 * over a real, non-launcher-directory sibling game binary. Falls back to the
 * full declared-executable resolution only when no non-launcher game-like
 * candidate exists at all (e.g. a title that genuinely ships a single
 * executable inside a folder that happens to be named Launcher).
 */
function resolveXboxPrimaryExecutable(contentRoot: string, declaredExecutables: string[]): string | undefined {
  const discovered = discoverGameExecutables(contentRoot, { knownCatalogExecutables: declaredExecutables });

  const nonLauncherPrimaries = discovered.filter(
    (exe) => exe.role === 'PRIMARY_GAME' && !PACKAGE_LAUNCHER_DIR_RE.test(exe.relativePath),
  );
  if (nonLauncherPrimaries.length === 1) return nonLauncherPrimaries[0].absolutePath;

  const nonLauncherGameCandidates = discovered.filter(
    (exe) =>
      (exe.role === 'PRIMARY_GAME' || exe.role === 'ALTERNATE_GAME')
      && !PACKAGE_LAUNCHER_DIR_RE.test(exe.relativePath),
  );
  if (nonLauncherGameCandidates.length === 1) return nonLauncherGameCandidates[0].absolutePath;
  if (nonLauncherGameCandidates.length > 1) return undefined; // genuinely ambiguous — fail closed.

  // No non-launcher game-like candidate exists at all — fall back to full
  // declared-executable resolution (may still resolve inside a Launcher/
  // directory when that is genuinely the only executable the package ships).
  return resolvePrimaryExecutable(contentRoot, { knownCatalogExecutables: declaredExecutables })?.absolutePath;
}

function resolveXboxPackage(pkg: XboxPackageInfo): RawInstalledGame | null {
  if (!pkg.installLocation) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(pkg.installLocation);
  } catch {
    return null; // Stale package registration / content root unreadable — fail closed, don't crash the scan.
  }
  if (!stat.isDirectory()) return null;

  const contentRoot = path.resolve(pkg.installLocation);

  const gameConfig = parseMicrosoftGameConfig(path.join(contentRoot, 'MicrosoftGame.config'));
  if (!gameConfig) return null; // Not a Microsoft GDK game package — out of scope (e.g. a non-game Store app).

  const manifest = parseAppxManifest(path.join(contentRoot, 'appxmanifest.xml'));

  const declaredExecutables = [...gameConfig.executables, ...(manifest?.applicationExecutables ?? [])]
    .map((rel) => path.basename(rel.replace(/\\/g, '/')))
    .filter(Boolean);

  const executablePath = resolveXboxPrimaryExecutable(contentRoot, declaredExecutables);
  const displayName = gameConfig.displayName || manifest?.displayName || pkg.name;

  return {
    platform: 'xbox',
    installPath: contentRoot,
    executablePath,
    displayName,
    launcherAppId: `xbox:${pkg.packageFamilyName || pkg.packageFullName || pkg.name}`,
  };
}

/** Offline/fixture path used by unit tests: a JSON array of XboxPackageInfo, bypassing Get-AppxPackage. */
export function scanXboxInstallsFromFixture(fixturePath: string): RawInstalledGame[] {
  if (!fs.existsSync(fixturePath)) return [];
  let packages: XboxPackageInfo[];
  try {
    packages = JSON.parse(fs.readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  if (!Array.isArray(packages)) return [];

  const results: RawInstalledGame[] = [];
  for (const pkg of packages) {
    const resolved = resolveXboxPackage(pkg);
    if (resolved) results.push(resolved);
  }
  return results;
}

export function scanXboxInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  if (options.xboxFixturePath) {
    return scanXboxInstallsFromFixture(options.xboxFixturePath);
  }

  const results: RawInstalledGame[] = [];
  for (const pkg of queryAppxPackages()) {
    const resolved = resolveXboxPackage(pkg);
    if (resolved) results.push(resolved);
  }
  return results;
}
