import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Backup } from '../../shared/types/index.js';
import db from '../database/index.js';

// Re-export Backup type for consumers
export type { Backup } from '../../shared/types/index.js';

interface BackupManifest {
  backups: Backup[];
  version: string;
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
  const manifestPath = path.join(backupDir, 'manifest.json');
  const tempPath = `${manifestPath}.tmp`;
  
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tempPath, manifestPath);
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
  
  // Update manifest (JSON file for redundancy)
  const manifest = loadManifest(backupDir);
  manifest.backups.push(backup);
  saveManifest(backupDir, manifest);
  
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
  try {
    validatePathSafety(backup.backupPath);
    validatePathSafety(backup.filePath);
    
    // Verify backup exists
    if (!fs.existsSync(backup.backupPath)) {
      throw new Error(`Backup file not found: ${backup.backupPath}`);
    }
    
    // Verify backup integrity
    const currentHash = computeHash(backup.backupPath);
    if (currentHash !== backup.originalHash) {
      throw new Error(`Backup integrity check failed for ${backup.id}: hash mismatch`);
    }
    
    // Restore file (overwrite target)
    fs.copyFileSync(backup.backupPath, backup.filePath);
    
    // Verify restore
    if (!fs.existsSync(backup.filePath)) {
      throw new Error(`Restore failed: ${backup.filePath} was not created`);
    }
    
    const restoredHash = computeHash(backup.filePath);
    if (restoredHash !== backup.originalHash) {
      throw new Error(`Restore verification failed for ${backup.id}: hash mismatch after restore`);
    }
    
    return true;
  } catch (error) {
    console.error('Restore failed:', error);
    return false;
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
