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
  /** Override which directory (base)names are pruned entirely. */
  ignoredDirectoryPattern?: RegExp;
}

const DEFAULT_MAX_DEPTH = 6;

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

  const roles = classifyExecutableRoles(
    found.map((f) => path.basename(f.absolutePath)),
    { knownCatalogExecutables: options.knownCatalogExecutables },
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
  return primaries.length === 1 ? primaries[0] : undefined;
}
