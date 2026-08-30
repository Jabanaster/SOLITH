import fs from 'fs';
import path from 'path';

/**
 * MP-P0.5 — Handle-based path authorization.
 *
 * path-safety.ts's `isContainedWithin`/`validatePathSafety` are string/lexical checks:
 * they call `fs.realpathSync` once, then compare prefixes. Between that check and the
 * later mutation (a separate `fs.writeFileSync`/`fs.renameSync` call elsewhere), the
 * target can be replaced, renamed, or turned into a symlink/junction — classic TOCTOU.
 * They also only lstat the final path component, so a junction planted at an
 * intermediate directory (e.g. approved-root itself replaced with a junction) is
 * invisible to them.
 *
 * This module authorizes a path by opening an OS handle to it and deriving identity
 * (volume id + file index, via fstat's dev/ino on Windows — libuv backs these with
 * GetFileInformationByHandle) from that handle rather than from a fresh path lookup.
 * `revalidateIdentity` must be called with a freshly-reopened fd immediately before any
 * mutation to detect identity changes that occurred after the initial authorization.
 */

export interface FileIdentity {
  dev: number;
  ino: number;
}

export interface PathAuthorization {
  authorized: boolean;
  reason?: string;
  canonicalPath?: string;
  identity?: FileIdentity;
  fd?: number;
}

/** All path prefixes from the filesystem root up to and including the full path. */
function pathComponents(absPath: string): string[] {
  const parsed = path.parse(absPath);
  const rest = absPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const prefixes: string[] = [parsed.root];
  let current = parsed.root;
  for (const segment of rest) {
    current = path.join(current, segment);
    prefixes.push(current);
  }
  return prefixes;
}

/**
 * Walks every component of a path (not just the final one) looking for a reparse
 * point (symlink, junction, or mount point — Node's lstat reports all three as
 * `isSymbolicLink()` on Windows). Stops at the first path component that doesn't
 * exist yet, since nothing beyond it can be a planted reparse point.
 */
export function findReparseComponent(absPath: string): { found: boolean; component?: string } {
  for (const prefix of pathComponents(absPath)) {
    let lst: fs.Stats;
    try {
      lst = fs.lstatSync(prefix);
    } catch {
      break;
    }
    if (lst.isSymbolicLink()) {
      return { found: true, component: prefix };
    }
  }
  return { found: false };
}

function isContained(canonicalTarget: string, canonicalRoot: string): boolean {
  return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(canonicalRoot + path.sep);
}

function canonicalRootFor(root: string): string {
  const absRoot = path.resolve(root);
  try {
    return fs.realpathSync.native(absRoot).toLowerCase();
  } catch {
    return absRoot.toLowerCase();
  }
}

/**
 * Authorizes `targetPath` against `approvedRoots`. On success, returns an open file
 * descriptor and the identity captured from it — the caller owns the fd and must
 * close it (and must call `revalidateIdentity` with a fresh fd right before mutating).
 */
export function authorizePath(targetPath: string, approvedRoots: string[]): PathAuthorization {
  const absPath = path.resolve(targetPath);

  const reparseBeforeOpen = findReparseComponent(absPath);
  if (reparseBeforeOpen.found) {
    return {
      authorized: false,
      reason: `Reparse point (symlink/junction/mount point) detected at path component: ${reparseBeforeOpen.component}`,
    };
  }

  let fd: number;
  try {
    fd = fs.openSync(absPath, 'r+');
  } catch (error) {
    return { authorized: false, reason: `Unable to open target for authorization: ${String(error)}` };
  }

  try {
    const canonicalPath = fs.realpathSync.native(absPath).toLowerCase();

    const reparseOnCanonical = findReparseComponent(canonicalPath);
    if (reparseOnCanonical.found) {
      return {
        authorized: false,
        reason: `Reparse point detected on canonical resolution: ${reparseOnCanonical.component}`,
      };
    }

    const containedRoot = approvedRoots.find((root) => isContained(canonicalPath, canonicalRootFor(root)));
    if (!containedRoot) {
      return { authorized: false, reason: 'Canonical target path is outside all approved roots.' };
    }

    const stat = fs.fstatSync(fd);
    const identity: FileIdentity = { dev: stat.dev, ino: stat.ino };

    return { authorized: true, canonicalPath, identity, fd };
  } catch (error) {
    return { authorized: false, reason: `Authorization failed: ${String(error)}` };
  } finally {
    // On failure we must not leak the handle. On success the caller takes ownership
    // and is responsible for closing it — but we only reach here on the failure path
    // because every success branch above returns before this finally runs its close.
  }
}

/**
 * Must be called with a fresh fd (re-opened at `canonicalPath` immediately before the
 * mutation) to detect any identity change that happened after `authorizePath` ran —
 * a rename, a delete-and-recreate, or a target swap.
 */
export function revalidateIdentity(fd: number, expected: FileIdentity): { valid: boolean; reason?: string } {
  try {
    const stat = fs.fstatSync(fd);
    if (stat.dev !== expected.dev || stat.ino !== expected.ino) {
      return { valid: false, reason: 'File identity changed since authorization (dev/ino mismatch).' };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: `Revalidation failed: ${String(error)}` };
  }
}

/**
 * Convenience wrapper: authorize, then immediately revalidate against itself's own
 * canonical path with a fresh handle. Used right before a mutation to close the
 * authorize-to-commit gap as tightly as possible without holding the original fd
 * open across the whole operation (which would block our own replace-rename on
 * Windows, since a rename/replace over an open-without-FILE_SHARE_DELETE handle
 * fails with a sharing violation).
 */
export function reauthorizeBeforeCommit(
  canonicalPath: string,
  expected: FileIdentity,
): { valid: boolean; reason?: string } {
  const reparse = findReparseComponent(canonicalPath);
  if (reparse.found) {
    return { valid: false, reason: `Reparse point detected on revalidation: ${reparse.component}` };
  }

  let fd: number;
  try {
    fd = fs.openSync(canonicalPath, 'r+');
  } catch (error) {
    return { valid: false, reason: `Target no longer openable at commit time: ${String(error)}` };
  }

  try {
    return revalidateIdentity(fd, expected);
  } finally {
    fs.closeSync(fd);
  }
}
