/**
 * Avowed Xbox PC Game Pass (WinGDK) save/config snapshot helpers.
 *
 * READ + COPY only from AppData sources into Solith userData backups.
 * Never writes into Packages\*, Alabama\*, or other game directories.
 */

import fs from 'node:fs';
import path from 'node:path';

export const AVOWED_WINGDK_EXE = 'Avowed-WinGDK-Shipping.exe';
export const AVOWED_STEAM_EXE = 'Avowed.exe';
export const AVOWED_PACKAGE_PREFIX = 'Microsoft.Avowed';
export const AVOWED_UE_PROJECT_CODENAME = 'Alabama';
export const AVOWED_WINGDK_BACKUP_SEGMENT = 'avowed-wingdk';

export type AvowedWingdkSnapshotKind = 'saves' | 'config';

export interface AvowedWingdkSnapshotResult {
  success: boolean;
  kind: AvowedWingdkSnapshotKind;
  sourceDir: string | null;
  destDir: string | null;
  filesCopied: number;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export function isAvowedWingdkExecutable(executableName: string): boolean {
  return executableName.trim().toLowerCase() === AVOWED_WINGDK_EXE.toLowerCase();
}

export function isAvowedAttachExecutable(executableName: string): boolean {
  const name = executableName.trim().toLowerCase();
  return name === AVOWED_WINGDK_EXE.toLowerCase() || name === AVOWED_STEAM_EXE.toLowerCase();
}

/** Resolve %LOCALAPPDATA% (Windows). */
export function resolveLocalAppData(env: NodeJS.ProcessEnv = process.env): string | null {
  const local = env.LOCALAPPDATA?.trim();
  if (local) return path.resolve(local);
  const userProfile = env.USERPROFILE?.trim();
  if (userProfile) return path.resolve(userProfile, 'AppData', 'Local');
  return null;
}

/**
 * Fuzzy-match Microsoft.Avowed* under Packages (suffix / publisher id varies).
 * Prefers directories that already contain SystemAppData\wgs.
 */
export function findAvowedWingdkPackageDir(
  localAppData: string | null = resolveLocalAppData(),
): string | null {
  if (!localAppData) return null;
  const packagesRoot = path.join(localAppData, 'Packages');
  if (!fs.existsSync(packagesRoot)) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(AVOWED_PACKAGE_PREFIX.toLowerCase()))
    .map((e) => path.join(packagesRoot, e.name))
    .sort((a, b) => a.localeCompare(b));

  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const wgs = path.join(candidate, 'SystemAppData', 'wgs');
    if (fs.existsSync(wgs)) return candidate;
  }
  return candidates[0] ?? null;
}

export function resolveAvowedWingdkWgsDir(
  localAppData: string | null = resolveLocalAppData(),
): string | null {
  const packageDir = findAvowedWingdkPackageDir(localAppData);
  if (!packageDir) return null;
  const wgs = path.join(packageDir, 'SystemAppData', 'wgs');
  return fs.existsSync(wgs) ? wgs : null;
}

/** UE project codename "Alabama" — WinGDK config root. */
export function resolveAvowedAlabamaConfigDir(
  localAppData: string | null = resolveLocalAppData(),
): string | null {
  if (!localAppData) return null;
  const configDir = path.join(
    localAppData,
    AVOWED_UE_PROJECT_CODENAME,
    'Saved',
    'Config',
    'WinGDK',
  );
  return fs.existsSync(configDir) ? configDir : null;
}

export function resolveAvowedWingdkBackupRoots(userDataRoot: string): {
  root: string;
  saves: string;
  config: string;
} {
  const root = path.join(path.resolve(userDataRoot), 'backups', AVOWED_WINGDK_BACKUP_SEGMENT);
  return {
    root,
    saves: path.join(root, 'saves'),
    config: path.join(root, 'config'),
  };
}

function assertPathInsideRoot(candidate: string, root: string, label: string): void {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${label} escapes approved root: ${resolvedCandidate}`);
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Recursively copy files from sourceDir → destDir (create dest).
 * Source is opened read-only; never writes into sourceDir.
 */
export function copyDirectoryContents(sourceDir: string, destDir: string): number {
  const resolvedSource = path.resolve(sourceDir);
  const resolvedDest = path.resolve(destDir);
  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory()) {
    throw new Error(`Source directory missing: ${resolvedSource}`);
  }

  fs.mkdirSync(resolvedDest, { recursive: true });
  let filesCopied = 0;

  const walk = (src: string, dest: string): void => {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        walk(from, to);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      // Copy file bytes only — do not follow links outside source tree via write.
      const data = fs.readFileSync(from);
      fs.writeFileSync(to, data);
      filesCopied += 1;
    }
  };

  walk(resolvedSource, resolvedDest);
  return filesCopied;
}

export function snapshotAvowedWingdkSaves(options: {
  userDataRoot: string;
  localAppData?: string | null;
  label?: string;
}): AvowedWingdkSnapshotResult {
  const sourceDir = resolveAvowedWingdkWgsDir(options.localAppData ?? resolveLocalAppData());
  if (!sourceDir) {
    return {
      success: false,
      kind: 'saves',
      sourceDir: null,
      destDir: null,
      filesCopied: 0,
      skipped: true,
      reason: 'wgs_not_found',
      error: 'Avowed WinGDK wgs directory not found under Packages\\Microsoft.Avowed*',
    };
  }

  const roots = resolveAvowedWingdkBackupRoots(options.userDataRoot);
  const destDir = path.join(roots.saves, options.label ?? `autosave-${stamp()}`);
  try {
    assertPathInsideRoot(destDir, roots.saves, 'saves dest');
    const filesCopied = copyDirectoryContents(sourceDir, destDir);
    return { success: true, kind: 'saves', sourceDir, destDir, filesCopied };
  } catch (err) {
    return {
      success: false,
      kind: 'saves',
      sourceDir,
      destDir,
      filesCopied: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * One-time launch snapshot of Alabama WinGDK config (GameUserSettings.ini, etc.).
 */
export function snapshotAvowedAlabamaConfig(options: {
  userDataRoot: string;
  localAppData?: string | null;
  label?: string;
}): AvowedWingdkSnapshotResult {
  const sourceDir = resolveAvowedAlabamaConfigDir(options.localAppData ?? resolveLocalAppData());
  if (!sourceDir) {
    return {
      success: false,
      kind: 'config',
      sourceDir: null,
      destDir: null,
      filesCopied: 0,
      skipped: true,
      reason: 'config_not_found',
      error: 'Alabama\\Saved\\Config\\WinGDK not found under LOCALAPPDATA',
    };
  }

  const roots = resolveAvowedWingdkBackupRoots(options.userDataRoot);
  const destDir = path.join(roots.config, options.label ?? `launch-${stamp()}`);
  try {
    assertPathInsideRoot(destDir, roots.config, 'config dest');
    const filesCopied = copyDirectoryContents(sourceDir, destDir);
    return { success: true, kind: 'config', sourceDir, destDir, filesCopied };
  } catch (err) {
    return {
      success: false,
      kind: 'config',
      sourceDir,
      destDir,
      filesCopied: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
