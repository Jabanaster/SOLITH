/**
 * Deterministic nested executable discovery (ROADMAP.md Phase 3: "Nested
 * executable support"). Many real installations do not place the playable
 * executable at the install root (e.g. a `bin/x64/`, `Binaries/Win64/`, or
 * `client/win64/`-style subdirectory) — this module does not hardcode any
 * such path. It performs a bounded, breadth-first, depth-then-path-sorted
 * recursive scan and classifies every executable it finds
 * (executable-role.ts), so a deterministic PRIMARY_GAME can be resolved (or
 * explicitly none, when genuinely ambiguous) regardless of where the real
 * executable happens to live.
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyExecutableRoles, type ExecutableRole } from './executable-role.js';

const EXECUTABLE_RE = /\.exe$/i;

// Directories that are never a playable-executable's home in a real game
// install — pruning them keeps a deep third-party-SDK tree (e.g. a bundled
// Unreal/Unity redistributable installer set) from exploding the search,
// not "the" discovery algorithm itself.
const IGNORED_DIRECTORY_RE = /^(?:_commonredist|redist(?:ributables?)?|vc_?redist|dotnet|directx|\.git|\.svn|__installer)$/i;

export interface DiscoveredExecutable {
  /** Absolute path. */
  absolutePath: string;
  /** Path relative to the install root, forward-slash normalized. */
  relativePath: string;
  /** Directory depth below the install root (0 = directly in the root). */
  depth: number;
  role: ExecutableRole;
}

export interface DiscoverGameExecutablesOptions {
  /** Maximum directory depth to descend below the install root. Bounded by default so a pathological directory tree cannot hang discovery. */
  maxDepth?: number;
  /** Catalog-declared executable names for this game, when known — passed through to executable-role classification so PRIMARY_GAME is resolved by evidence, not position. */
  knownCatalogExecutables?: string[];
  /**
   * Opt-in only: when true, and 2+ PRIMARY_GAME candidates remain after the
   * Shipping-binary tie-break, `knownCatalogExecutables[0]` is trusted as
   * the curator's declared preferred executable (e.g. Baldur's Gate 3's
   * `bg3.exe` over `bg3_dx11.exe` — both are equally real, independently
   * launchable game binaries with no engine-level naming convention to
   * prefer one). Defaults to false because `executables` array order is
   * only verified meaningful for hand-curated literal source arrays (see
   * `steam-executable-lookup.ts`, `bundled-community-games.ts`) — it is
   * NOT verified safe for catalog data whose order may be an artifact of
   * scrape/ingestion/Set-deduplication order rather than curator intent.
   * Callers must only set this when they know their `knownCatalogExecutables`
   * came from a source where position 0 is a deliberate author choice.
   */
  trustDeclaredExecutableOrder?: boolean;
  /** Override which directory (base)names are pruned entirely. */
  ignoredDirectoryPattern?: RegExp;
}

const DEFAULT_MAX_DEPTH = 6;

// Real, publicly-documented Unreal Engine cooked-binary naming convention
// (e.g. Palworld-Win64-Shipping.exe) — the engine always ships this as the
// actual game process; a shorter root-level stub with the bare game name
// (e.g. Palworld.exe) is a wrapper that merely relaunches it. Used only as
// a tie-break among executables the catalog has ALREADY validated as the
// same known game — never invents a new game identity, and never applies
// when the ambiguity is between unknown candidates.
const SHIPPING_BINARY_RE = /-(?:win64|win32|linux64|linux)-shipping\.exe$/i;

function collectExecutablesRecursive(
  root: string,
  currentDir: string,
  depth: number,
  maxDepth: number,
  ignoredDirectoryPattern: RegExp,
  found: Array<{ absolutePath: string; relativePath: string; depth: number }>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return; // Unreadable directory (permissions, race with uninstall, etc.) — skip, don't fail the whole scan.
  }

  for (const entry of entries) {
    if (entry.isFile() && EXECUTABLE_RE.test(entry.name)) {
      const absolutePath = path.join(currentDir, entry.name);
      found.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
        depth,
      });
      continue;
    }
    if (entry.isDirectory() && depth < maxDepth && !ignoredDirectoryPattern.test(entry.name)) {
      collectExecutablesRecursive(
        root,
        path.join(currentDir, entry.name),
        depth + 1,
        maxDepth,
        ignoredDirectoryPattern,
        found,
      );
    }
  }
}

/**
 * Finds every executable under `installPath` (bounded, deterministic —
 * never dependent on filesystem directory-entry enumeration order) and
 * classifies each one's role. Result is sorted by (depth ascending, then
 * relativePath ascending) — a fixed, reproducible total order, not an
 * artifact of `readdir`'s OS/filesystem-dependent ordering.
 */
export function discoverGameExecutables(
  installPath: string,
  options: DiscoverGameExecutablesOptions = {},
): DiscoveredExecutable[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const ignoredDirectoryPattern = options.ignoredDirectoryPattern ?? IGNORED_DIRECTORY_RE;

  const found: Array<{ absolutePath: string; relativePath: string; depth: number }> = [];
  collectExecutablesRecursive(installPath, installPath, 0, maxDepth, ignoredDirectoryPattern, found);

  found.sort((a, b) => a.depth - b.depth || a.relativePath.localeCompare(b.relativePath));

  // Real path context (the immediate containing directory), not just the
  // bare filename — a packaged install's launcher/bootstrap binary commonly
  // shares the game's own name (e.g. GDK/Xbox titles) and only signals its
  // role via the folder it ships in (Launcher\Atomfall.exe vs the real
  // engine bin\Atomfall_dx12.exe). Keyed by basename, first-occurrence-wins,
  // matching the existing basename-keyed `roles` Map below.
  const parentDirectoryByName: Record<string, string> = {};
  for (const f of found) {
    const base = path.basename(f.absolutePath);
    if (!(base in parentDirectoryByName)) {
      parentDirectoryByName[base] = path.basename(path.dirname(f.absolutePath));
    }
  }

  const roles = classifyExecutableRoles(
    found.map((f) => path.basename(f.absolutePath)),
    { knownCatalogExecutables: options.knownCatalogExecutables, parentDirectoryByName },
  );

  return found.map((f) => ({
    ...f,
    role: roles.get(path.basename(f.absolutePath)) ?? 'UNKNOWN',
  }));
}

/**
 * Convenience wrapper: resolves the single PRIMARY_GAME executable for an
 * install, or `undefined` when none is found or the result is genuinely
 * ambiguous (2+ PRIMARY_GAME candidates — fails closed rather than picking
 * the first one discovered, replacing the previous `entries.find(...)`
 * first-match behavior).
 */
export function resolvePrimaryExecutable(
  installPath: string,
  options: DiscoverGameExecutablesOptions = {},
): DiscoveredExecutable | undefined {
  const primaries = discoverGameExecutables(installPath, options).filter((e) => e.role === 'PRIMARY_GAME');
  if (primaries.length === 1) return primaries[0];

  if (primaries.length > 1) {
    const shipping = primaries.filter((e) => SHIPPING_BINARY_RE.test(path.basename(e.absolutePath)));
    if (shipping.length === 1) return shipping[0];

    // Second tier, opt-in only (see trustDeclaredExecutableOrder doc) — the
    // catalog's own declared preferred executable. Reuses an existing,
    // already-established codebase convention — index 0 of an `executables`
    // list is treated as the primary executable elsewhere
    // (mod-pack-adapter.ts's `primaryExecutable`, import-definition-ct.ts,
    // bundled-definition-seed.ts) — rather than inventing new
    // renderer-preference infrastructure. Never picks by filesystem or
    // alphabetical order — only a caller-verified, curator-declared name.
    if (options.trustDeclaredExecutableOrder) {
      const firstKnown = options.knownCatalogExecutables?.[0]?.toLowerCase();
      if (firstKnown) {
        const declared = primaries.filter((e) => path.basename(e.absolutePath).toLowerCase() === firstKnown);
        if (declared.length === 1) return declared[0];
      }
    }
  }

  return undefined;
}
