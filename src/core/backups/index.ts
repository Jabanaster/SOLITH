import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Backup } from '../../shared/types/index.js';
import db from '../database/index.js';
import { getGameById } from '../games/index.js';
import { acquireFileLock, releaseFileLock } from '../safety/file-lock.js';
import { getCanonicalPath, validatePathSafety as validateCentralPathSafety } from '../safety/path-safety.js';

// Re-export Backup type for consumers
export type { Backup } from '../../shared/types/index.js';

interface BackupManifest {
  backups: Backup[];
  version: string;
}

function isManifestLockContention(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY';
}

/**
 * Validates that a file path is safe (no traversal, absolute path).
 */
function validatePathSafety(filePath: string): void {
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) {
    throw new Error(`Unsafe path detected (traversal): ${filePath}`);
  }
  if (!path.isAbsolute(normalized)) {
    throw new Error(`Path must be absolute: ${filePath}`);
  }
}

/**
 * Computes SHA-256 hash of file content.
 */
function computeHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Loads backup manifest from directory, creating if needed.
 */
function loadManifest(backupDir: string): BackupManifest {
  const manifestPath = path.join(backupDir, 'manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    return { backups: [], version: '1.0.0' };
  }
  
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(content) as BackupManifest;
    return parsed;
  } catch (error) {
    throw new Error(`Invalid backup manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Saves backup manifest atomically (temp file + rename).
 */
function saveManifest(backupDir: string, manifest: BackupManifest): void {
  fs.mkdirSync(backupDir, { recursive: true });

  const manifestPath = path.join(backupDir, 'manifest.json');
  const tempPath = path.join(
    backupDir,
    `manifest.${process.pid}.${Date.now()}.${crypto.randomUUID()}.json.tmp`
  );

  try {
    fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.renameSync(tempPath, manifestPath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Preserve the original write/rename failure for callers.
      }
    }
  }
}

/**
 * Creates a backup of the target file.
 * 
 * @param gameId - Game identifier
 * @param targetFile - Absolute path to file being backed up
 * @param backupDir - Directory where backup will be stored
 * @param recipeId - Optional recipe identifier
 * @param proposalId - Optional proposal identifier
 * @param operationId - Optional operation identifier
 * @returns Backup metadata object
 */
export function createBackup(
  gameId: string,
  targetFile: string,
  backupDir: string,
  recipeId?: string,
  proposalId?: string,
  operationId?: string
): Backup {
  // Validate paths
  validatePathSafety(targetFile);
  validatePathSafety(backupDir);
  
  // Verify source file exists
  if (!fs.existsSync(targetFile)) {
    throw new Error(`Source file not found: ${targetFile}`);
  }
  
  // Create backup directory if needed
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  // Generate backup metadata
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const originalHash = computeHash(targetFile);
  const ext = path.extname(targetFile);
  const backupFileName = `${id}${ext}`;
  const backupPath = path.join(backupDir, backupFileName);
  
  // Copy file to backup location
  fs.copyFileSync(targetFile, backupPath);
  
  // Verify backup was written
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file was not created: ${backupPath}`);
  }
  
  // Verify backup hash matches original
  const backupHash = computeHash(backupPath);
  if (backupHash !== originalHash) {
    fs.unlinkSync(backupPath);
    throw new Error('Backup hash mismatch - backup corrupted during copy');
  }
  
  // Create backup record
  const backup: Backup = {
    id,
    timestamp,
    filePath: targetFile,
    originalHash,
    backupPath,
    ...(recipeId && { recipeId })
  };
  
  // Update manifest (JSON file for redundancy). DB remains the primary source.
  try {
    const manifest = loadManifest(backupDir);
    manifest.backups.push(backup);
    saveManifest(backupDir, manifest);
  } catch (error) {
    if (!isManifestLockContention(error)) {
      throw error;
    }
    console.warn(
      'Backup manifest update skipped due to lock contention:',
      error instanceof Error ? error.message : String(error)
    );
  }
  
  // Persist to database (primary storage for crash recovery)
  const metadata = JSON.stringify({
    backupPath,
    originalHash,
    filePath: targetFile
  });
  
  db.prepare(`
    INSERT INTO backups (id, gameId, recipeId, timestamp, files, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    gameId,
    recipeId || null,
    timestamp,
    JSON.stringify([targetFile]),
    metadata
  );
  
  return backup;
}

/**
 * Restores a file from backup.
 * 
 * @param backup - Backup metadata
 * @returns true if restore succeeded, false otherwise
 */
export function restoreBackup(backup: Backup): boolean {
  const targetPath = path.resolve(backup.filePath);
  const backupPath = path.resolve(backup.backupPath);
  const canonicalTarget = getCanonicalPath(targetPath);
  let tmpPath = '';
  let lockAcquired = false;

  try {
    validatePathSafety(backupPath);
    validatePathSafety(targetPath);

    const backupRow = db.prepare(`
      SELECT gameId, metadata
      FROM backups
      WHERE id = ?
    `).get(backup.id) as { gameId: string; metadata: string } | undefined;

    if (!backupRow) {
      throw new Error(`Backup record not found: ${backup.id}`);
    }

    const metadata = JSON.parse(backupRow.metadata || '{}') as {
      backupPath?: string;
      filePath?: string;
      originalHash?: string;
    };
    const ownedBackupPath = metadata.backupPath ? path.resolve(metadata.backupPath) : '';
    const ownedFilePath = metadata.filePath ? path.resolve(metadata.filePath) : '';

    if (
      ownedBackupPath.toLowerCase() !== backupPath.toLowerCase() ||
      ownedFilePath.toLowerCase() !== targetPath.toLowerCase() ||
      metadata.originalHash !== backup.originalHash
    ) {
      throw new Error(`Backup ownership check failed for ${backup.id}`);
    }

    const game = getGameById(backupRow.gameId);
    if (!game) {
      throw new Error(`Game not found for backup: ${backup.id}`);
    }

    const targetSafety = validateCentralPathSafety(targetPath, [game.path]);
    if (!targetSafety.safe) {
      throw new Error(targetSafety.reason || 'Target path failed containment validation.');
    }

    const backupSafety = validateCentralPathSafety(backupPath);
    if (!backupSafety.safe) {
      throw new Error(backupSafety.reason || 'Backup path failed safety validation.');
    }

    lockAcquired = acquireFileLock(canonicalTarget);
    if (!lockAcquired) {
      throw new Error(`File "${path.basename(targetPath)}" is currently locked by another operation.`);
    }
    
    // Verify backup exists
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    // Verify backup integrity
    const currentHash = computeHash(backupPath);
    if (currentHash !== backup.originalHash) {
      throw new Error(`Backup integrity check failed for ${backup.id}: hash mismatch`);
    }

    const targetExists = fs.existsSync(targetPath);
    if (targetExists) {
      const targetStat = fs.statSync(targetPath);
      if (!targetStat.isFile()) {
        throw new Error(`Restore target is not a file: ${targetPath}`);
      }
    }
    
    // Restore through a sibling temp file and atomic replacement.
    tmpPath = path.join(
      path.dirname(targetPath),
      `${path.basename(targetPath)}.resourceforge-restore-${backup.id}.tmp`
    );
    fs.copyFileSync(backupPath, tmpPath);
    if (targetExists) {
      fs.chmodSync(tmpPath, fs.statSync(targetPath).mode);
    }
    fs.renameSync(tmpPath, targetPath);
    tmpPath = '';
    
    // Verify restore
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Restore failed: ${targetPath} was not created`);
    }
    
    const restoredHash = computeHash(targetPath);
    if (restoredHash !== backup.originalHash) {
      throw new Error(`Restore verification failed for ${backup.id}: hash mismatch after restore`);
    }
    
    return true;
  } catch (error) {
    console.error('Restore failed:', error);
    return false;
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure.
      }
    }
    if (lockAcquired) {
      releaseFileLock(canonicalTarget);
    }
  }
}

/**
 * Gets all backups for a specific game.
 * 
 * @param gameId - Game identifier
 * @returns Array of backup records, sorted by timestamp (newest first)
 */
export function getBackupsForGame(gameId: string): Backup[] {
  const rows = db.prepare(`
    SELECT id, gameId, recipeId, timestamp, metadata
    FROM backups
    WHERE gameId = ?
    ORDER BY timestamp DESC
  `).all(gameId);
  
  return rows.map((row: any) => {
    const metadata = JSON.parse(row.metadata || '{}');
    return {
      id: row.id,
      timestamp: row.timestamp,
      filePath: metadata.filePath || '',
      originalHash: metadata.originalHash || '',
      backupPath: metadata.backupPath || '',
      ...(row.recipeId && { recipeId: row.recipeId })
    };
  });
}

/**
 * Restores a backup by its ID.
 * 
 * @param backupId - Backup identifier
 * @returns true if restore succeeded
 */
export function restoreBackupById(backupId: string): boolean {
  const row = db.prepare(`
    SELECT id, gameId, recipeId, timestamp, metadata
    FROM backups
    WHERE id = ?
  `).get(backupId);
  
  if (!row) {
    throw new Error(`Backup not found: ${backupId}`);
  }
  
  const metadata = JSON.parse((row as any).metadata || '{}');
  const backup: Backup = {
    id: (row as any).id,
    timestamp: (row as any).timestamp,
    filePath: metadata.filePath || '',
    originalHash: metadata.originalHash || '',
    backupPath: metadata.backupPath || '',
    ...((row as any).recipeId && { recipeId: (row as any).recipeId })
  };
  
  return restoreBackup(backup);
}
