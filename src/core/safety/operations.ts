import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../database';
import { logEvent } from '../journal';
import { restoreBackup } from '../backups';
import { getAdapterForFile } from '../adapters/index';

export type OperationStatus =
  | 'DRAFT'
  | 'PROPOSED'
  | 'DRY_RUN_PASSED'
  | 'AWAITING_APPROVAL'
  | 'BACKUP_CREATED'
  | 'APPLYING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RESTORING'
  | 'RESTORED'
  | 'RESTORE_FAILED'
  | 'CANCELLED';

export interface Operation {
  id: string;
  gameId: string;
  proposalId?: string;
  recipeId?: string;
  targetFile: string;
  type: 'apply' | 'rollback';
  status: OperationStatus;
  backupId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

const ALLOWED_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  DRAFT: ['PROPOSED', 'CANCELLED'],
  PROPOSED: ['DRY_RUN_PASSED', 'FAILED', 'CANCELLED'],
  DRY_RUN_PASSED: ['AWAITING_APPROVAL', 'FAILED', 'CANCELLED'],
  AWAITING_APPROVAL: ['BACKUP_CREATED', 'CANCELLED'],
  BACKUP_CREATED: ['APPLYING', 'FAILED'],
  APPLYING: ['VALIDATING', 'FAILED'],
  VALIDATING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['RESTORING'],
  FAILED: ['RESTORING'],
  RESTORING: ['RESTORED', 'RESTORE_FAILED'],
  RESTORED: [],
  RESTORE_FAILED: [],
  CANCELLED: []
};

/**
 * Creates a new operation in the database.
 */
export function createOperation(op: Omit<Operation, 'status' | 'createdAt' | 'updatedAt'>): Operation {
  const timestamp = new Date().toISOString();
  const initialStatus: OperationStatus = 'DRAFT';
  
  const stmt = db.prepare(`
    INSERT INTO operations (id, gameId, proposalId, recipeId, targetFile, type, status, backupId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    op.id,
    op.gameId,
    op.proposalId || null,
    op.recipeId || null,
    op.targetFile,
    op.type,
    initialStatus,
    op.backupId || null,
    timestamp,
    timestamp
  );
  
  return {
    ...op,
    status: initialStatus,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/**
 * Transitions an operation to a new state after validating allowed transitions.
 */
export function transitionOperation(
  operationId: string,
  nextStatus: OperationStatus,
  failureReason?: string
): void {
  const selectStmt = db.prepare('SELECT * FROM operations WHERE id = ?');
  const row = selectStmt.get(operationId);
  if (!row) {
    throw new Error(`Operation "${operationId}" not found.`);
  }
  
  const currentStatus = row.status as OperationStatus;
  
  // Validate transition
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(nextStatus)) {
    throw new Error(`Invalid state transition: cannot move operation from "${currentStatus}" to "${nextStatus}".`);
  }
  
  // Update DB
  const updateStmt = db.prepare(`
    UPDATE operations
    SET status = ?, failureReason = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  updateStmt.run(nextStatus, failureReason || null, operationId);
  
  // Log transition to journal
  logEvent({
    gameId: row.gameId,
    recipeId: row.recipeId || undefined,
    type: nextStatus === 'FAILED' || nextStatus === 'RESTORE_FAILED' ? 'error' : 'proposal',
    description: `Operation ${operationId} transitioned from ${currentStatus} to ${nextStatus}.${failureReason ? ` Reason: ${failureReason}` : ''}`,
    details: JSON.stringify({ operationId, currentStatus, nextStatus, failureReason })
  });
}

function parseTypedValue(valStr: string | null): any {
  if (valStr === null || valStr === undefined) return valStr;
  try {
    return JSON.parse(valStr);
  } catch {
    return valStr;
  }
}

function removeRecoveryTempFile(tmpPath: string, operationId: string): void {
  try {
    fs.unlinkSync(tmpPath);
  } catch (error) {
    console.error(`[Crash Recovery] Failed to remove temp file for operation ${operationId}: ${tmpPath}`, error);
  }
}

/**
 * Startup Crash Recovery routine.
 * Detects operations interrupted in critical states and recovers them automatically if possible.
 */
export async function recoverInterruptedOperations(): Promise<void> {
  try {
    // Find operations stuck in APPLYING, VALIDATING, or RESTORING
    const stmt = db.prepare(`
      SELECT * FROM operations 
      WHERE status IN ('APPLYING', 'VALIDATING', 'RESTORING')
    `);
    
    const stuckOps = stmt.all();
    if (stuckOps.length === 0) return;
    
    console.log(`[Crash Recovery] Found ${stuckOps.length} interrupted operations.`);
    
    for (const op of stuckOps) {
      const opId = op.id;
      const targetFile = op.targetFile;
      const status = op.status as OperationStatus;
      
      console.log(`[Crash Recovery] Recovering operation ${opId} (stuck in ${status}) for target: ${targetFile}`);
      
      const tmpPath = path.join(
        path.dirname(targetFile),
        `${path.basename(targetFile)}.solith-${opId}.tmp`
      );
      const tmpExists = fs.existsSync(tmpPath);
      
      const targetExists = fs.existsSync(targetFile);
      const currentHash = targetExists ? crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex') : null;
      
      // Look up backup metadata
      if (!op.backupId) {
        // Case E: No backupId recorded
        console.log(`[Crash Recovery] Case E: Operation interrupted without recorded backup.`);
        db.prepare("UPDATE operations SET status = 'FAILED', failureReason = 'Interrupted without recorded backup' WHERE id = ?").run(opId);
        if (tmpExists) {
          removeRecoveryTempFile(tmpPath, opId);
        }
        continue;
      }
      
      const backupRow = db.prepare('SELECT * FROM backups WHERE id = ?').get(op.backupId);
      if (!backupRow) {
        // Case E: Backup row missing
        console.log(`[Crash Recovery] Case E: Backup record not found in database.`);
        db.prepare("UPDATE operations SET status = 'RESTORE_FAILED', failureReason = 'Backup record not found in database' WHERE id = ?").run(opId);
        if (tmpExists) {
          removeRecoveryTempFile(tmpPath, opId);
        }
        continue;
      }
      
      const metadata = JSON.parse(backupRow.metadata || '{}');
      const backupPath = metadata.backupPath;
      const originalHash = metadata.originalHash;
      
      const backupExists = backupPath && fs.existsSync(backupPath);
      const backupHashValid = backupExists && crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex') === originalHash;
      
      if (!backupExists || !backupHashValid) {
        // Case E: Physical backup file missing or invalid hash
        console.log(`[Crash Recovery] Case E: Physical backup file is invalid or missing.`);
        db.prepare("UPDATE operations SET status = 'RESTORE_FAILED', failureReason = 'Backup is invalid or unavailable for recovery' WHERE id = ?").run(opId);
        if (tmpExists) {
          removeRecoveryTempFile(tmpPath, opId);
        }
        continue;
      }
      
      // Load proposal to compute expected final hash
      const proposalRow = db.prepare('SELECT * FROM proposals WHERE id = ?').get(op.proposalId);
      let expectedFinalHash: string | null = null;
      let adapter = getAdapterForFile(targetFile);
      
      if (proposalRow && adapter) {
        const newValue = parseTypedValue(proposalRow.newValue);
        const buildRes = await adapter.buildOutput(backupPath, proposalRow.path, newValue);
        if (buildRes.success) {
          expectedFinalHash = crypto.createHash('sha256').update(Buffer.from(buildRes.content, 'utf-8')).digest('hex');
        }
      }
      
      // Case evaluation
      if (targetExists && currentHash === originalHash) {
        // Case A: Target matches original hash
        console.log(`[Crash Recovery] Case A: Current target matches original hash. Original was not replaced.`);
        db.prepare("UPDATE operations SET status = 'FAILED', failureReason = 'Interrupted prior to file replacement' WHERE id = ?").run(opId);
        if (tmpExists) {
          removeRecoveryTempFile(tmpPath, opId);
        }
      } else if (targetExists && expectedFinalHash !== null && currentHash === expectedFinalHash) {
        // Case B: Target matches expected final hash
        // Validate target
        const content = fs.readFileSync(targetFile, 'utf-8');
        const validation = adapter ? await adapter.validateContent(content, targetFile) : { valid: true };
        if (validation.valid) {
          console.log(`[Crash Recovery] Case B: Current target matches expected final hash and is valid.`);
          db.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = ?").run(opId);
        } else {
          // If invalid, fallback to Case C (Restore)
          console.log(`[Crash Recovery] Case B fallback: Final content exists but validation failed. Restoring...`);
          const backupObj = {
            id: backupRow.id,
            timestamp: backupRow.timestamp,
            filePath: targetFile,
            originalHash,
            backupPath,
            recipeId: op.recipeId || undefined
          };
          const restored = restoreBackup(backupObj);
          db.prepare("UPDATE operations SET status = ? WHERE id = ?").run(restored ? 'RESTORED' : 'RESTORE_FAILED', opId);
        }
        if (tmpExists) {
          removeRecoveryTempFile(tmpPath, opId);
        }
      } else if (expectedFinalHash === null && currentHash !== originalHash) {
        // Case D: Ambiguous state
        console.log(`[Crash Recovery] Case D: Ambiguous target state (proposal missing or expected final hash uncomputable).`);
        db.prepare("UPDATE operations SET status = 'FAILED', failureReason = 'Ambiguous target state: requires recovery review' WHERE id = ?").run(opId);
        if (tmpExists) {
          removeRecoveryTempFile(tmpPath, opId);
        }
      } else {
        // Case C: Target is invalid (or missing) and verified backup exists
        console.log(`[Crash Recovery] Case C: Target is invalid/missing, but verified backup exists. Restoring...`);
        const backupObj = {
          id: backupRow.id,
          timestamp: backupRow.timestamp,
          filePath: targetFile,
          originalHash,
          backupPath,
          recipeId: op.recipeId || undefined
        };
        const restored = restoreBackup(backupObj);
        if (restored) {
          console.log(`[Crash Recovery] Restoration successful. Marking operation as RESTORED.`);
          db.prepare("UPDATE operations SET status = 'RESTORED' WHERE id = ?").run(opId);
        } else {
          console.error(`[Crash Recovery] Restoration failed.`);
          db.prepare("UPDATE operations SET status = 'RESTORE_FAILED', failureReason = 'Restoration failed during recovery' WHERE id = ?").run(opId);
        }
        if (tmpExists) {
          removeRecoveryTempFile(tmpPath, opId);
        }
      }
    }
  } catch (error) {
    console.error('[Crash Recovery] Error during operation recovery:', error);
  }
}
