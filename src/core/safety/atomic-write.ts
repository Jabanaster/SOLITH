import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../database';
import { getCanonicalPath, validatePathSafety } from './path-safety';
import { acquireFileLock, releaseFileLock } from './file-lock';
import { getGameById } from '../games';
import { getAdapterForFile } from '../adapters/index';
import { renameOrCopyAcrossDevices } from './exdev-safe-rename';

/**
 * Centralized Atomic File Replacement Service.
 * Ensures save/data edits are written atomically and safely.
 */

/**
 * Executes a safe, atomic write to a target file.
 * Returns true if successful, throws or returns false with error otherwise.
 */
export async function atomicWrite(
  gameId: string,
  targetPath: string,
  newContent: string,
  operationId: string,
  backupId: string,
  expectedOldValue?: any,
  valuePath?: string
): Promise<{ success: boolean; error?: string }> {
  const canonicalTarget = getCanonicalPath(targetPath);
  
  // 1. Acquire canonical target lock
  const locked = acquireFileLock(canonicalTarget);
  if (!locked) {
    return { success: false, error: `File "${path.basename(targetPath)}" is currently locked by another operation.` };
  }

  let tmpPath = '';
  // Finding 3 (independent security review, ef254d1): only becomes true once
  // tmpPath holds content-validated data (step 9). Before that, tmpPath (if
  // it exists at all) is not a "known good copy" — it may be malformed or
  // never written — so cleaning it up on an early failure is safe. After
  // that point tmpPath is the only known-good copy until canonicalTarget is
  // proven correct (step 12), so the finally block must never delete it on
  // a later failure — see rationale at the atomicWriteFileSync fix this
  // mirrors, src/core/database/index.ts.
  let tmpPathIsRecoverableCopy = false;

  try {
    // Get game root directory for containment check
    const game = getGameById(gameId);
    if (!game) {
      return { success: false, error: 'Game not found in database.' };
    }

    // Check if target is blocked due to ambiguous recovery state
    const blockedRows = db.prepare(`
      SELECT id FROM operations 
      WHERE LOWER(targetFile) = LOWER(?) AND failureReason = 'Ambiguous target state: requires recovery review'
    `).all(canonicalTarget);
    if (blockedRows.length > 0) {
      return { success: false, error: 'Target file is locked due to ambiguous crash state requiring review.' };
    }
    
    // 2. Revalidate target containment (allowing target file inside game root or backup root)
    const safety = validatePathSafety(canonicalTarget, [game.path]);
    if (!safety.safe) {
      return { success: false, error: safety.reason || 'Containment check failed.' };
    }

    // 3. Verify target exists
    if (!fs.existsSync(canonicalTarget)) {
      return { success: false, error: 'Target file does not exist.' };
    }

    // 4. Verify target is not blocked (e.g. executables/system files)
    const stat = fs.statSync(canonicalTarget);
    if (!stat.isFile()) {
      return { success: false, error: 'Target is not a file.' };
    }

    // 5. Verify expected old value at path (if supplied) to prevent stale edits
    if (valuePath && expectedOldValue !== undefined) {
      const adapter = getAdapterForFile(canonicalTarget);
      if (!adapter) {
        return { success: false, error: 'Unsupported file: no trainer adapter registered for stale check.' };
      }
      const readRes = await adapter.readCurrentValue(canonicalTarget, valuePath);
      if (!readRes.success) {
        return { success: false, error: `Failed to read stale verification value: ${readRes.error}` };
      }
      if (String(readRes.value) !== String(expectedOldValue)) {
        return { success: false, error: 'Target file content has changed since dry run (stale edit blocked).' };
      }
    }

    // 6. Verify backup exists and its hash is valid
    const backupRow = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId);
    if (!backupRow) {
      return { success: false, error: 'Backup record not found in database.' };
    }
    const backupMeta = JSON.parse(backupRow.metadata || '{}');
    const backupPath = backupMeta.backupPath;
    
    if (!backupPath || !fs.existsSync(backupPath)) {
      return { success: false, error: 'Physical backup file does not exist.' };
    }
    
    const currentBackupHash = crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex');
    if (currentBackupHash !== backupMeta.originalHash) {
      return { success: false, error: 'Backup integrity verification failed (hash mismatch).' };
    }

    // 7. Write to uniquely named sibling temporary file on the same volume
    tmpPath = path.join(
      path.dirname(canonicalTarget),
      `${path.basename(canonicalTarget)}.solith-${operationId}.tmp`
    );
    
    // 8. Flush and close the temporary file
    fs.writeFileSync(tmpPath, newContent, 'utf-8');

    // 9. Validate the temporary file using the correct adapter
    const adapter = getAdapterForFile(canonicalTarget);
    if (!adapter) {
      throw new Error(`Unsupported file: no trainer adapter registered for "${path.basename(canonicalTarget)}"`);
    }
    const valResult = await adapter.validateContent(newContent, tmpPath);
    if (!valResult.valid) {
      throw new Error(`Temporary file validation failed: ${valResult.error || 'file is malformed'}`);
    }

    // From here on, tmpPath holds validated, correct data — it is a
    // recoverable copy and must survive any failure in the steps below.
    tmpPathIsRecoverableCopy = true;

    // 10. Preserve target permissions
    fs.chmodSync(tmpPath, stat.mode);

    // 11. Atomically replace original. renameOrCopyAcrossDevices falls back
    // to copy when the filesystem reports EXDEV — observed even for a
    // same-directory rename on a OneDrive-redirected/Files-On-Demand game
    // save or Documents folder (same class of failure seen against a
    // OneDrive-redirected AppData\Roaming, see atomicWriteFileSync in
    // src/core/database/index.ts).
    renameOrCopyAcrossDevices(tmpPath, canonicalTarget);

    // 12. Verify the final target hash matches the written content hash
    // BEFORE deleting tmpPath — tmpPath remains the only known-good copy
    // until this verification proves canonicalTarget itself is correct.
    const expectedHash = crypto.createHash('sha256').update(newContent).digest('hex');
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(canonicalTarget)).digest('hex');
    if (expectedHash !== actualHash) {
      throw new Error('Atomic replacement verification failed: final file hash mismatch.');
    }

    // Only now is it safe to discard tmpPath — canonicalTarget is proven correct.
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // canonicalTarget write is already verified correct — a leftover
        // temp file is a harmless recovery artifact, not a reason to fail.
      }
    }
    tmpPath = '';

    return { success: true };
  } catch (error) {
    console.error('Atomic write failed:', error);
    return { success: false, error: String(error) };
  } finally {
    // 13. Remove Solith-owned temporary file if it remains (on failure) —
    // but only when it was never proven to hold validated, correct data.
    // Once tmpPathIsRecoverableCopy is true, tmpPath is the last known-good
    // copy of the edit (see Finding 3, independent security review,
    // ef254d1) and must be left on disk for recovery rather than deleted.
    if (tmpPath && fs.existsSync(tmpPath) && !tmpPathIsRecoverableCopy) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (e) {
        // Ignore cleanup failure
      }
    }
    // 14. Release the file lock
    releaseFileLock(canonicalTarget);
  }
}

/**
 * Scans a directory and cleans up any abandoned Solith temporary files.
 */
export function cleanupAbandonedTempFiles(dirPath: string): void {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    entries.forEach(entry => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        cleanupAbandonedTempFiles(fullPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.tmp') &&
          entry.name.includes('.solith-')
      ) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`Cleaned up abandoned temporary file: ${entry.name}`);
        } catch {
          // Ignore lock/permission failures
        }
      }
    });
  } catch {
    // Ignore traversal issues
  }
}
