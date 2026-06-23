import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../database';
import { getCanonicalPath, validatePathSafety } from './path-safety';
import { acquireFileLock, releaseFileLock } from './file-lock';
import { getGameById } from '../games';
import { getAdapterForFile } from '../adapters/index';

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
      `${path.basename(canonicalTarget)}.resourceforge-${operationId}.tmp`
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

    // 10. Preserve target permissions
    fs.chmodSync(tmpPath, stat.mode);

    // 11. Atomically replace original
    fs.renameSync(tmpPath, canonicalTarget);
    
    // Clear tmpPath so finally block doesn't try to delete it
    tmpPath = '';

    // 12. Verify the final target hash matches the written content hash
    const expectedHash = crypto.createHash('sha256').update(newContent).digest('hex');
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(canonicalTarget)).digest('hex');
    if (expectedHash !== actualHash) {
      throw new Error('Atomic replacement verification failed: final file hash mismatch.');
    }

    return { success: true };
  } catch (error) {
    console.error('Atomic write failed:', error);
    return { success: false, error: String(error) };
  } finally {
    // 13. Remove ResourceForge-owned temporary file if it remains (on failure)
    if (tmpPath && fs.existsSync(tmpPath)) {
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
 * Scans a directory and cleans up any abandoned ResourceForge temporary files.
 */
export function cleanupAbandonedTempFiles(dirPath: string): void {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    entries.forEach(entry => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        cleanupAbandonedTempFiles(fullPath);
      } else if (entry.isFile() && entry.name.includes('.resourceforge-') && entry.name.endsWith('.tmp')) {
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
