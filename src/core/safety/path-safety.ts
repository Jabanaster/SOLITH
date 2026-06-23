import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Centralized Path Safety Service for ResourceForge.
 * Validates, normalizes, and contains file operations to approved directories.
 */

// Blocked Windows system directories
const SYSTEM_DIRS = [
  'c:\\windows',
  'c:\\winnt',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\system volume information'
];

/**
 * Resolves the absolute canonical path of a target.
 * Resolves symlinks/junctions if the file exists to check its true location.
 */
export function getCanonicalPath(targetPath: string): string {
  const absolutePath = path.resolve(targetPath);
  
  // Resolve symlinks/junctions if file exists to prevent link escape tricks
  try {
    if (fs.existsSync(absolutePath)) {
      return fs.realpathSync(absolutePath).toLowerCase();
    }
  } catch (e) {
    // If realpath fails (e.g. permission or lock), fallback to normalized absolute path
  }
  
  return absolutePath.toLowerCase();
}

/**
 * Checks if a path is contained within an approved root directory.
 * Prevents sibling-prefix escapes (e.g., approved "C:\game" allowing "C:\gamebackup").
 */
export function isContainedWithin(targetPath: string, approvedRoot: string): boolean {
  const canonicalTarget = getCanonicalPath(targetPath);
  const canonicalRoot = getCanonicalPath(approvedRoot);
  
  // Sibling-prefix proof check
  return canonicalTarget.startsWith(canonicalRoot + path.sep) || canonicalTarget === canonicalRoot;
}

/**
 * Validates whether a file path is safe for operations (reads/writes/restores).
 * Checks traversal, drive roots, system directories, homedir, and installation dir.
 */
export function validatePathSafety(
  targetPath: string,
  approvedRoots: string[] = []
): { safe: boolean; reason?: string } {
  try {
    const canonicalTarget = getCanonicalPath(targetPath);
    
    // 1. Reject drive roots directly (length <= 3 e.g. "c:\" or "d:")
    const parsed = path.parse(canonicalTarget);
    if (canonicalTarget === parsed.root.toLowerCase() || canonicalTarget.length <= 3) {
      return { safe: false, reason: 'Operations on drive roots are blocked.' };
    }
    
    // 2. Reject Windows system directories
    for (const sysDir of SYSTEM_DIRS) {
      if (canonicalTarget.startsWith(sysDir + path.sep) || canonicalTarget === sysDir) {
        return { safe: false, reason: `Operations on Windows system directory "${sysDir}" are blocked.` };
      }
    }
    
    // 3. Reject User Profile Root (e.g., "C:\Users\username")
    const userHome = os.homedir().toLowerCase();
    if (canonicalTarget === userHome) {
      return { safe: false, reason: 'Operations directly on the User Profile root are blocked.' };
    }
    
    // 4. Reject ResourceForge installation directory targets
    const appDir = path.resolve(process.cwd()).toLowerCase();
    if (canonicalTarget.startsWith(appDir + path.sep) || canonicalTarget === appDir) {
      return { safe: false, reason: 'Operations within the ResourceForge installation directory are blocked.' };
    }
    
    // 5. Detect symbolic links or junctions at the target path itself
    try {
      if (fs.existsSync(targetPath)) {
        const lstat = fs.lstatSync(targetPath);
        if (lstat.isSymbolicLink()) {
          return { safe: false, reason: 'Target path is a symbolic link or junction.' };
        }
      }
    } catch {
      // Ignore lstat issues
    }

    // 6. Verify containment inside at least one approved root (if roots are supplied)
    if (approvedRoots.length > 0) {
      const isContained = approvedRoots.some(root => isContainedWithin(canonicalTarget, root));
      if (!isContained) {
        return { safe: false, reason: 'Target path is outside of approved directories.' };
      }
    }
    
    return { safe: true };
  } catch (error) {
    return { safe: false, reason: `Path validation error: ${String(error)}` };
  }
}
