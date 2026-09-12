import fs from 'node:fs';
import path from 'node:path';
import type { InstallDiscoveryOptions, RawInstalledGame } from './types.js';
import { listRegistrySubkeys, readRegistryString } from './registry-win.js';

/**
 * AppX/MSIX packages (which includes Xbox / Microsoft Store games) are
 * registered per-package under this registry key, with a `PackageRootFolder`
 * string value pointing at the install folder. Reading it requires no
 * elevation and no PowerShell shell-out — just `reg.exe query`, exactly like
 * `listRegistrySubkeys`/`readRegistryString` already do for other providers.
 *
 * This is a genuinely harder signal than Steam/GOG/Epic's: subkey names are
 * opaque `PackageFamilyName_PublisherId`-style identifiers, not human
 * readable, and the same key holds every AppX package on the machine —
 * system components, UI frameworks, and unrelated Store apps alongside
 * actual games, with no reliable field distinguishing "game" from "app".
 *
 * A blacklist of known Microsoft framework/runtime family prefixes
 * (`KNOWN_FRAMEWORK_PACKAGE_RE`) is still applied first, but a blacklist
 * alone is over-broad by construction: it only ever encodes the finitely
 * many families someone thought to list, so any third-party utility,
 * codec, or first-party app not on that list (Calculator, Photos, Camera,
 * a random Store productivity app) passes straight through as a "plausible
 * game." To fix that, `hasGamingCorroboration` below requires a genuine
 * positive signal before a package is accepted: every AppX/MSIX package
 * ships an `AppxManifest.xml` file at the root of its install directory
 * (this is a mandatory, documented part of the package format — not
 * guessed), and that manifest's `<Dependencies>` block lists every other
 * package this one depends on by family name. Real Xbox/Store games use
 * Microsoft's Xbox Live / Gaming Services APIs (achievements, multiplayer,
 * overlay, save sync) and therefore declare a `PackageDependency` on one of
 * the well-known Xbox/Gaming Services runtime families, or declare the
 * `gamingDeviceInformation` `DeviceCapability` (a real, documented AppX
 * manifest capability used by titles that query Xbox/gaming device info).
 * Calculator, Photos, Camera, and generic runtime/codec packages have no
 * reason to declare either and, in practice, do not.
 *
 * This is corroboration, not proof: local, inspectable manifest evidence of
 * "this package integrates with Xbox/Gaming Services," combined with not
 * being itself one of the known non-game frameworks. It intentionally does
 * NOT invent or assume any undocumented Xbox-internal field (no genre/
 * category metadata is read — that data does not exist locally; it only
 * lives in the Microsoft Store's server-side catalog). The tradeoff is
 * named explicitly in provider-capabilities.ts: a handful of real games
 * with no Xbox Live/Gaming Services integration at all (very old or
 * minimal indie UWP titles) could now be missed, trading the prior
 * false-positive-heavy behavior for a more conservative, corroborated one.
 */
const APPX_PACKAGES_KEY =
  'HKCR\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages';

/** Known non-game framework/runtime/system package family prefixes. */
const KNOWN_FRAMEWORK_PACKAGE_RE =
  /^Microsoft\.(VCLibs|NET|UI\.Xaml|WindowsAppRuntime|DesktopAppInstaller|StorePurchaseApp|WindowsStore|XboxGameCallableUI|XboxGameOverlay|XboxIdentityProvider|XboxSpeechToTextOverlay|GamingApp|Advertising|AAD\.BrokerPlugin|BingWeather|GetHelp|Getstarted|People|ScreenSketch|Todos|WindowsCalculator|WindowsCamera|WindowsFeedbackHub|WindowsMaps|WindowsNotepad|WindowsSoundRecorder|WindowsStore|WindowsTerminal|Windows\.Photos|ZuneMusic|ZuneVideo|MicrosoftEdge|MicrosoftStickyNotes)/i;

/**
 * Package families whose presence in a manifest's `<Dependencies>` block
 * corroborates real Xbox/Gaming Services integration — i.e. this package
 * calls into the Xbox Live / Gaming Services / GDK runtime, which non-game
 * apps have no reason to depend on. These are documented, real package
 * family names (several are the very framework packages
 * `KNOWN_FRAMEWORK_PACKAGE_RE` excludes when registered as the candidate
 * itself; here they are read as a *dependency* of the candidate, which is a
 * different, positive signal).
 */
const GAMING_DEPENDENCY_FAMILY_RE =
  /Microsoft\.(GamingServices|XboxGameCallableUI|XboxIdentityProvider|XboxSpeechToTextOverlay|XboxGameOverlay|Xbox\.TCUI)/i;

/** Documented AppX manifest DeviceCapability used by Xbox/gaming-aware titles. */
const GAMING_DEVICE_CAPABILITY_RE = /Name=["']gamingDeviceInformation["']/i;

const APPX_MANIFEST_FILE = 'AppxManifest.xml';

interface XboxFixtureEntry {
  packageFullName?: string;
  installDir?: string;
  PackageRootFolder?: string;
  displayName?: string;
}

function filterPlausibleGamePackage(packageFullName: string): boolean {
  return !KNOWN_FRAMEWORK_PACKAGE_RE.test(packageFullName);
}

/**
 * Reads `AppxManifest.xml` from the package's install root (a mandatory,
 * always-present file for any AppX/MSIX package — not a guess) and checks
 * it for real, documented positive signals that this package is
 * Xbox/Gaming-Services-aware: a `PackageDependency` on a known Xbox/Gaming
 * Services runtime family, or the `gamingDeviceInformation` device
 * capability. Read-only; any I/O or parse failure is treated as "no
 * corroboration" rather than thrown, matching this module's fail-closed
 * posture for an unreadable/malformed manifest.
 */
function hasGamingCorroboration(installDir: string): boolean {
  try {
    const manifestPath = path.join(installDir, APPX_MANIFEST_FILE);
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    return GAMING_DEPENDENCY_FAMILY_RE.test(manifest) || GAMING_DEVICE_CAPABILITY_RE.test(manifest);
  } catch {
    return false;
  }
}

function familyNameFromPackageFullName(packageFullName: string): string {
  // PackageFullName looks like "Microsoft.MinecraftUWP_1.2.3.0_x64__8wekyb3d8bbwe".
  // Family/product segment is everything before the first "_".
  const idx = packageFullName.indexOf('_');
  return idx > 0 ? packageFullName.slice(0, idx) : packageFullName;
}

/**
 * AppX install roots can hold the game executable at various depths. As
 * with ubisoft.ts/ea.ts, there is no reliable per-title executable name
 * list here, so fall back to the first top-level `.exe`. Many real AppX
 * game executables live directly in the package root, but this heuristic
 * can miss deeper ones — accepted as a known limitation.
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
  displayNameRaw: string | undefined,
  packageFullName: string,
): RawInstalledGame | null {
  const installDir = installDirRaw?.trim();
  if (!installDir || !fs.existsSync(installDir)) return null;
  if (!filterPlausibleGamePackage(packageFullName)) return null;

  const resolvedInstallDir = path.resolve(installDir);
  if (!hasGamingCorroboration(resolvedInstallDir)) return null;

  const executablePath = findFirstTopLevelExecutable(resolvedInstallDir);
  const displayName = displayNameRaw?.trim() || familyNameFromPackageFullName(packageFullName);

  return {
    platform: 'xbox',
    installPath: resolvedInstallDir,
    executablePath: executablePath ? path.resolve(executablePath) : undefined,
    displayName,
    launcherAppId: `xbox:${packageFullName}`,
  };
}

/** Offline/fixture path used by unit tests. */
export function scanXboxInstallsFromFixture(fixturePath: string): RawInstalledGame[] {
  if (!fs.existsSync(fixturePath)) return [];
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8').replace(/^﻿/, '')) as XboxFixtureEntry[];
  if (!Array.isArray(raw)) return [];

  const results: RawInstalledGame[] = [];
  for (const entry of raw) {
    const packageFullName = entry.packageFullName ?? '';
    if (!packageFullName) continue;
    const resolved = resolveFromEntry(
      entry.installDir ?? entry.PackageRootFolder,
      entry.displayName,
      packageFullName,
    );
    if (resolved) results.push(resolved);
  }
  return results;
}

export function scanXboxInstalls(options: InstallDiscoveryOptions = {}): RawInstalledGame[] {
  if (options.xboxFixturePath) {
    return scanXboxInstallsFromFixture(options.xboxFixturePath);
  }

  const subkeys = listRegistrySubkeys(APPX_PACKAGES_KEY);
  if (subkeys.length === 0) return [];

  const results: RawInstalledGame[] = [];
  for (const packageFullName of subkeys) {
    const keyPath = `${APPX_PACKAGES_KEY}\\${packageFullName}`;
    const installDir = readRegistryString(keyPath, 'PackageRootFolder');
    const resolved = resolveFromEntry(installDir ?? undefined, undefined, packageFullName);
    if (resolved) results.push(resolved);
  }
  return results;
}
