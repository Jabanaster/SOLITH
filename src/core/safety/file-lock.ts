import { getCanonicalPath } from './path-safety';

/**
 * In-memory file lock registry.
 * Ensures only one write/restore operation runs on a save/data file at any time.
 */
const activeLocks = new Set<string>();

/**
 * Acquires an exclusive lock on a file path.
 * Returns true if lock was successfully acquired, false if already locked.
 */
export function acquireFileLock(filePath: string): boolean {
  const canonical = getCanonicalPath(filePath);
  if (activeLocks.has(canonical)) {
    return false;
  }
  activeLocks.add(canonical);
  return true;
}

/**
 * Releases the exclusive lock on a file path.
 */
export function releaseFileLock(filePath: string): void {
  const canonical = getCanonicalPath(filePath);
  activeLocks.delete(canonical);
}

/**
 * Checks if a file path is currently locked.
 */
export function isFileLockedInMemory(filePath: string): boolean {
  const canonical = getCanonicalPath(filePath);
  return activeLocks.has(canonical);
}
