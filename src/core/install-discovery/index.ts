import fs from 'node:fs';
import path from 'node:path';
import { searchCatalog } from '../trainer-catalog/store.js';
import { setSetting } from '../settings/index.js';
import { scanEpicInstalls } from './epic.js';
import { scanGogInstalls } from './gog.js';
import { countMatchedCatalog, matchInstalledToCatalog } from './match.js';
import { scanSteamInstalls } from './steam.js';
import { countInstalledGames, getInstalledCatalogGameIds, listInstalledGames, upsertInstalledGames } from './store.js';
import { runTrainerHealthCheck } from '../trainer-health/index.js';
import {
  createInstallIdentity,
  createPreviewCandidateId,
  sameConcreteInstall,
} from './identity.js';
import type {
  InstallDiscoveryCommitSelection,
  InstallDiscoveryFailure,
  InstallDiscoveryOptions,
  InstallDiscoveryPreviewRecord,
  InstallDiscoveryRejectedCandidate,
  InstallDiscoveryPreviewResult,
  InstallDiscoveryScanResult,
  InstalledGameRecord,
  RawInstalledGame,
} from './types.js';

const EXECUTABLE_RE = /\.(exe)$/i;
const NON_GAME_PATH_RE = /(?:common[ _-]?redistributables?|steamworks|redist|redistributable|sdk|engine|plugins?|launcher|editor|tools?|realityscan|source|intermediate|deriveddatacache|marketplace|samples|templates|unreal|ue[_-]?\d|game[ _-]?project|\.git|\.svn)/i;
const NON_GAME_EXE_RE = /(?:setup|install|uninstall|crashreport|launcher|editor|updat(?:e|er)|bootstrap)/i;
const SHARED_RUNTIME_RE = /(?:steamworks(?:[ _-](?:common|shared|sdk|redist(?:ributables?)?))?|common[ _-]?redistributables?|directx(?:[ _-]?(?:redist|runtime))?|vc(?:\+\+)?[ _-]?redist|visual[ _-]?c\+\+[ _-]?redistributable|shared[ _-]?(?:launcher[ _-]?)?runtime)/i;
const NON_GAME_APPLICATION_RE = /(?:\bide\b|source[ _-]?control|\bgit\b|playnite|library[ _-]?manager|realityscan|photogrammetry|wallpapers?|desktop[ _-]?app|asset[ _-]?(?:tool|editor|generator)|project[ _-]?(?:tool|manager)|build[ _-]?(?:tool|system))/i;
const DEVELOPMENT_PRODUCT_RE = /(?:plugins?|marketplace|editor[ _-]?extension|inventory[ _-]?(?:system|plugin)|narrative[ _-]?(?:system|interaction|navigator)|conversation[ _-]?(?:system|plugin)|material[ _-]?(?:system|plugin)|landscape[ _-]?(?:system|plugin)|destructible[ _-]?(?:system|glass)|\bconvai\b|\bmetahuman\b)/i;
const STEAMWORKS_REDISTRIBUTABLE_APP_ID = 228980;

function sharedRuntimeReason(game: RawInstalledGame): string | undefined {
  const evidence = [
    game.displayName,
    game.installPath,
    game.executablePath,
    game.launcherAppId,
  ].filter(Boolean).join(' ');
  if (game.platform === 'steam' && game.steamAppId === STEAMWORKS_REDISTRIBUTABLE_APP_ID) {
    return 'shared_runtime_or_redistributable';
  }
  return SHARED_RUNTIME_RE.test(evidence) ? 'shared_runtime_or_redistributable' : undefined;
}

function obviousNonGameReason(game: RawInstalledGame): string | undefined {
  const combinedName = `${game.displayName ?? ''} ${game.installPath} ${game.executablePath ?? ''}`;
  const executableName = path.basename(game.executablePath ?? '');
  const sharedRuntime = sharedRuntimeReason(game);
  if (sharedRuntime) return sharedRuntime;
  if (NON_GAME_PATH_RE.test(game.installPath)) return 'non_game_directory_structure';
  if (NON_GAME_EXE_RE.test(executableName)) return 'helper_or_tool_executable';
  if (NON_GAME_APPLICATION_RE.test(combinedName)) return 'known_tool_or_application';
  if (DEVELOPMENT_PRODUCT_RE.test(combinedName)) return 'development_plugin_or_asset_product';
  return undefined;
}

type GameEvidence = {
  score: number;
  reasons: string[];
  rejectionReason?: string;
};

function inspectGameEvidence(installPath: string, executablePath: string): GameEvidence {
  try {
    const entries = fs.readdirSync(installPath, { withFileTypes: true });
    const names = entries.map((entry) => entry.name);
    const combinedName = `${path.basename(installPath)} ${path.basename(executablePath)}`;
    if (NON_GAME_APPLICATION_RE.test(combinedName)) {
      return { score: 0, reasons: [], rejectionReason: 'known_tool_or_application' };
    }
    if (DEVELOPMENT_PRODUCT_RE.test(combinedName)) {
      return { score: 0, reasons: [], rejectionReason: 'development_plugin_or_asset_product' };
    }

    let score = 0;
    const reasons: string[] = [];
    const executableBase = path.basename(executablePath, path.extname(executablePath)).replace(/[^a-z0-9]/gi, '').toLowerCase();
    const folderBase = path.basename(installPath).replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (
      executableBase.length >= 4
      && folderBase.length >= 4
      && (executableBase.includes(folderBase) || folderBase.includes(executableBase))
    ) {
      score += 2;
      reasons.push('executable_folder_name_agreement');
    }
    if (names.some((entry) => /_Data$/i.test(entry))) {
      score += 3;
      reasons.push('unity_data_directory');
    }
    if (names.some((entry) => /\.(pak|ucas|utoc)$/i.test(entry))) {
      score += 3;
      reasons.push('packaged_game_archive');
    }
    if (names.some((entry) => /^(Data|GameData|Content|StreamingAssets)$/i.test(entry))) {
      score += 2;
      reasons.push('game_data_directory');
    }
    const paksPath = path.join(installPath, 'Content', 'Paks');
    if (fs.existsSync(paksPath) && fs.readdirSync(paksPath).some((entry) => /\.(pak|ucas|utoc)$/i.test(entry))) {
      score += 3;
      reasons.push('unreal_packaged_content');
    }
    if (score < 3) {
      return { score, reasons, rejectionReason: 'insufficient_game_evidence' };
    }
    return { score, reasons };
  } catch {
    return { score: 0, reasons: [], rejectionReason: 'unreadable_candidate' };
  }
}
function rejectManualCandidate(installPath: string, executablePath: string): string | undefined {
  try {
    const entries = fs.readdirSync(installPath);
    if (entries.some((entry) => /\.uproject$/i.test(entry))) return 'unreal_project';
    if (entries.some((entry) => /\.uplugin$/i.test(entry))) return 'unreal_plugin';
  } catch { return 'unreadable_candidate'; }
  if (NON_GAME_PATH_RE.test(installPath)) return 'non_game_directory_structure';
  if (NON_GAME_EXE_RE.test(path.basename(executablePath))) return 'helper_or_tool_executable';
  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function safeReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deduplicateConcreteInstalls(records: InstalledGameRecord[]): InstalledGameRecord[] {
  const unique: InstalledGameRecord[] = [];
  for (const record of records) {
    const existingIndex = unique.findIndex((candidate) => Boolean(sameConcreteInstall(candidate, record)));
    if (existingIndex < 0) {
      unique.push(record);
      continue;
    }
    const existing = unique[existingIndex];
    const recordIsStronger = Boolean(record.catalogGameId) && !existing.catalogGameId;
    if (recordIsStronger) unique[existingIndex] = record;
  }
  return unique;
}

function commonInstallRoots(): string[] {
  if (process.platform !== 'win32') return [];
  const systemDrive = process.env.SystemDrive || 'C:';
  return [
    path.join(systemDrive, 'XboxGames'),
    path.join(systemDrive, 'Games'),
    'D:\\Games',
    'G:\\Games',
  ];
}

/**
 * Bounded search depth/breadth for `findGameExecutable` below (catalog
 * -reconciliation closeout, Requirement 2 root-cause fix). Depth 5 and an
 * 8,000-entry cap comfortably cover real Xbox/Game-Pass package layouts
 * (verified against a real installed title: ~2,000 files total under its
 * `Content/` tree, real binary 2 levels deep) without becoming an
 * unbounded recursive filesystem walk.
 */
const GAME_EXECUTABLE_SEARCH_MAX_DEPTH = 5;
const GAME_EXECUTABLE_SEARCH_MAX_ENTRIES = 8000;

/**
 * Finds the real game executable inside an install folder, searching
 * bounded-depth subdirectories — NOT just the top level.
 *
 * Root cause fix (catalog-reconciliation closeout): the previous
 * single-level `findFirstExecutable` never found executables nested under
 * a game's own subfolders, which is exactly how Xbox/Microsoft Store
 * package installs are laid out (an `appxmanifest.xml`/
 * `MicrosoftGame.config` at the install root, with the actual game and
 * launcher binaries under `Content/bin/` and `Content/Launcher/`
 * respectively) — confirmed against a real installed title during this
 * closeout. A shallow, single-directory scan structurally cannot find such
 * a layout regardless of which library roots are configured.
 *
 * When multiple real executables are found (a launcher stub alongside the
 * actual game binary is common), the LARGEST by file size is preferred —
 * a small helper/launcher executable is reliably orders of magnitude
 * smaller than the real packaged game binary in every case inspected
 * during this closeout (a ~100KB launch helper and a ~1.8MB launcher
 * alongside a ~330MB real game binary for the one real title verified).
 * This is a size heuristic on REAL discovered files, not an assumption
 * about any specific game's filename.
 */
function findGameExecutable(installPath: string): string | undefined {
  const candidates: Array<{ path: string; size: number }> = [];
  let scanned = 0;

  function walk(dir: string, depth: number): void {
    if (depth > GAME_EXECUTABLE_SEARCH_MAX_DEPTH || scanned > GAME_EXECUTABLE_SEARCH_MAX_ENTRIES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned > GAME_EXECUTABLE_SEARCH_MAX_ENTRIES) return;
      scanned += 1;
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        if (!EXECUTABLE_RE.test(entry.name)) continue;
        try {
          candidates.push({ path: full, size: fs.statSync(full).size });
        } catch { /* unreadable — skip, do not fail the whole scan */ }
        continue;
      }
      if (entry.isDirectory() && !NON_GAME_PATH_RE.test(entry.name)) {
        walk(full, depth + 1);
      }
    }
  }

  walk(installPath, 0);
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.size - a.size);
  return candidates[0].path;
}

/**
 * Single-level executable lookup for the "root itself is one game's install
 * folder" case ONLY (see `scanShallowRoot`). Deliberately NOT the bounded
 * -depth `findGameExecutable` — that recursive search must never be run
 * against a LIBRARY root (many sibling game folders, e.g. `Z:\Games`),
 * because it would walk across every sibling folder and could pick up an
 * executable belonging to a completely different game (a real defect this
 * closeout found and fixed: scanning a library root that recursed found
 * one game's real binary and mis-attributed it to the library root itself,
 * which then shadowed that game's own correct per-child record during
 * deduplication by `canonicalExecutablePath` equality).
 */
function findImmediateExecutable(installPath: string): string | undefined {
  try {
    const entries = fs.readdirSync(installPath, { withFileTypes: true });
    const exe = entries.find((entry) => entry.isFile() && EXECUTABLE_RE.test(entry.name));
    return exe ? path.resolve(installPath, exe.name) : undefined;
  } catch {
    return undefined;
  }
}

function scanShallowRoot(root: string, failures: InstallDiscoveryFailure[]): RawInstalledGame[] {
  const resolvedRoot = path.resolve(root);
  const results: RawInstalledGame[] = [];
  try {
    const rootStat = fs.statSync(resolvedRoot);
    if (!rootStat.isDirectory()) {
      failures.push({ location: resolvedRoot, reason: 'not_a_directory' });
      return results;
    }

    const rootExe = findImmediateExecutable(resolvedRoot);
    if (rootExe) {
      const rejected = rejectManualCandidate(resolvedRoot, rootExe);
      if (rejected) { failures.push({ location: resolvedRoot, reason: 'rejected_non_game:' + rejected }); } else results.push({
        platform: 'manual',
        installPath: resolvedRoot,
        executablePath: rootExe,
        displayName: path.basename(resolvedRoot),
      });
    }

    const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(resolvedRoot, entry.name);
      const executablePath = findGameExecutable(child);
      if (!executablePath) continue;
      const rejected = rejectManualCandidate(child, executablePath);
      if (rejected) { failures.push({ location: child, reason: 'rejected_non_game:' + rejected }); continue; }
      results.push({
        platform: resolvedRoot.toLowerCase().includes('xboxgames') ? 'xbox' : 'manual',
        installPath: path.resolve(child),
        executablePath,
        displayName: entry.name,
      });
    }
  } catch (error) {
    failures.push({ location: resolvedRoot, reason: safeReason(error) });
  }
  return results;
}

export function discoverRawInstalls(
  options: InstallDiscoveryOptions = {},
  failures: InstallDiscoveryFailure[] = [],
): RawInstalledGame[] {
  const results: RawInstalledGame[] = [];
  const run = (location: string, scan: () => RawInstalledGame[]) => {
    try {
      results.push(...scan());
    } catch (error) {
      failures.push({ location, reason: safeReason(error) });
    }
  };

  run(options.steamInstallPath ?? 'steam:libraries', () => scanSteamInstalls(options));
  if (!options.offlineRootsOnly || options.epicManifestsPath) {
    run(options.epicManifestsPath ?? 'epic:manifests', () => scanEpicInstalls(options));
  }
  if (options.gogFixturePath || !options.offlineRootsOnly) {
    run(options.gogFixturePath ?? 'gog:registry', () => scanGogInstalls(options));
  }
  return results;
}
export function previewInstallDiscoveryScan(options: InstallDiscoveryOptions = {}): InstallDiscoveryPreviewResult {
  const scannedAt = new Date().toISOString();

  const failures: InstallDiscoveryFailure[] = [];
  const locationsChecked = uniqueStrings([
    options.steamInstallPath ? path.resolve(options.steamInstallPath) : 'steam:libraries',
    options.epicManifestsPath ? path.resolve(options.epicManifestsPath) : 'epic:manifests',
    options.gogFixturePath ? path.resolve(options.gogFixturePath) : 'gog:registry',
    ...(options.userSelectedRoots ?? []).map((root) => path.resolve(root)),
    ...(options.includeCommonRoots ? commonInstallRoots() : []),
  ]);

  const platformRaw = discoverRawInstalls(options, failures);
  const selectedRootRaw = [
    ...(options.userSelectedRoots ?? []),
    ...(options.includeCommonRoots ? commonInstallRoots() : []),
  ].flatMap((root) => scanShallowRoot(root, failures));

  const discoveredRaw = [...platformRaw, ...selectedRootRaw];
  const rejected: InstallDiscoveryRejectedCandidate[] = failures
    .filter((failure) => failure.reason.startsWith('rejected_non_game:'))
    .map((failure) => ({
      installPath: failure.location,
      reason: failure.reason.slice('rejected_non_game:'.length),
    }));
  const raw = discoveredRaw.filter((game) => {
    const reason = obviousNonGameReason(game);
    if (!reason) return true;
    rejected.push({
      installPath: game.installPath,
      executablePath: game.executablePath,
      displayName: game.displayName,
      reason,
    });
    return false;
  });
  const catalog = searchCatalog('', 5000, 0).entries;
  const matched = deduplicateConcreteInstalls(matchInstalledToCatalog(raw, catalog, scannedAt));
  const classificationReasons = new Map<string, string>();
  const addable = matched.filter((record) => {
    if (record.catalogGameId || (record.platform !== 'manual' && record.platform !== 'xbox')) return true;
    const evidence = inspectGameEvidence(record.installPath, record.executablePath ?? '');
    if (evidence.rejectionReason) {
      rejected.push({
        installPath: record.installPath,
        executablePath: record.executablePath,
        displayName: record.displayName,
        reason: evidence.rejectionReason,
      });
      return false;
    }
    classificationReasons.set(record.id, `weighted_game_evidence:${evidence.score}:${evidence.reasons.join(',')}`);
    return true;
  });
  const existingRecords = listInstalledGames();
  const records: InstallDiscoveryPreviewRecord[] = addable.map((record) => ({
    ...record,
    previewCandidateId: createPreviewCandidateId(record),
    ...(() => {
      const duplicate = existingRecords.find((existing) => {
        if (existing.identityStatus === 'ambiguous' || existing.identityStatus === 'legacy') return false;
        return Boolean(sameConcreteInstall(existing, createInstallIdentity(record)));
      });
      const duplicateReason = duplicate
        ? sameConcreteInstall(duplicate, createInstallIdentity(record))
        : undefined;
      return {
        duplicate: Boolean(duplicate),
        duplicateReason,
        duplicateOfId: duplicate?.id,
      };
    })(),
    source: record.platform,
    unsupportedReason: record.catalogGameId ? undefined : 'no_catalog_match',
    classification: record.catalogGameId || (record.platform !== 'manual' && record.platform !== 'xbox')
      ? 'likely_game'
      : 'uncertain',
    classificationReason: record.catalogGameId
      ? 'catalog_match'
      : record.platform !== 'manual' && record.platform !== 'xbox'
        ? 'launcher_manifest_match'
        : classificationReasons.get(record.id) ?? 'weighted_game_evidence',
  }));
  const unsupported = records.filter((record) => record.unsupportedReason);

  const platforms = {
    steam: raw.filter((g) => g.platform === 'steam').length,
    epic: raw.filter((g) => g.platform === 'epic').length,
    gog: raw.filter((g) => g.platform === 'gog').length,
    xbox: raw.filter((g) => g.platform === 'xbox').length,
    // Ubisoft Connect, EA app, and Battle.net have no auto-discovery scanner yet
    // (Step 11) — always 0 here; manually-known installations for these launchers
    // are counted separately from the `games` table, not from this scan result.
    ubisoft: raw.filter((g) => g.platform === 'ubisoft').length,
    ea: raw.filter((g) => g.platform === 'ea').length,
    battlenet: raw.filter((g) => g.platform === 'battlenet').length,
    manual: raw.filter((g) => g.platform === 'manual').length,
  };

  return {
    discovered: records.length,
    matched: countMatchedCatalog(records),
    platforms,
    scannedAt,
    records,
    locationsChecked,
    duplicatesSkipped: records.filter((record) => record.duplicate).length,
    unsupported,
    rejected,
    failures,
  };
}

export function commitInstallDiscoveryRecords(records: InstallDiscoveryCommitSelection[]): { added: number; skipped: number; rejected: number } {
  const committedAt = new Date().toISOString();
  const catalog = searchCatalog('', 5000, 0).entries;
  const validRaw: RawInstalledGame[] = [];

  for (const record of records) {
    const installPath = path.resolve(record.installPath);
    try {
      if (!fs.statSync(installPath).isDirectory()) continue;
      let executablePath: string | undefined;
      if (record.executablePath) {
        executablePath = path.resolve(record.executablePath);
        const relative = path.relative(installPath, executablePath);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(executablePath).isFile()) continue;
      }
      validRaw.push({
        platform: record.platform,
        installPath,
        executablePath,
        displayName: record.displayName,
        steamAppId: record.steamAppId,
        launcherAppId: record.launcherAppId,
      });
    } catch {
      // A submitted record is committed only when its local paths still exist
      // and remain internally consistent at confirmation time.
    }
  }

  const revalidated = deduplicateConcreteInstalls(matchInstalledToCatalog(validRaw, catalog, committedAt));
  const existingRecords = listInstalledGames();
  const selected = revalidated.filter((record) => !existingRecords.some((existing) => {
    if (existing.identityStatus === 'ambiguous' || existing.identityStatus === 'legacy') return false;
    return Boolean(sameConcreteInstall(existing, record));
  }));
  if (selected.length > 0) {
    upsertInstalledGames(selected);
    setSetting('installDiscoveryLastScan', committedAt);
    try {
      runTrainerHealthCheck();
    } catch (error) {
      console.warn('[install-discovery] Health check skipped after commit:', error);
    }
  }
  const rejected = records.length - revalidated.length;
  return { added: selected.length, skipped: revalidated.length - selected.length, rejected };
}
export function runInstallDiscoveryScan(
  options: InstallDiscoveryOptions = {},
): InstallDiscoveryScanResult & { records: InstalledGameRecord[] } {
  // Compatibility entry point for older callers. Discovery is preview-only;
  // persistence requires a separate, explicit user-confirmed commit.
  return previewInstallDiscoveryScan(options);
}

export function listInstalledGamesWithCatalog(): InstalledGameRecord[] {
  return listInstalledGames();
}

export function installedCatalogIdSet(): Set<string> {
  return getInstalledCatalogGameIds();
}

export function installedGameCount(): number {
  return countInstalledGames();
}
