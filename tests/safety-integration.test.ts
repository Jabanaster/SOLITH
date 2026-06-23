import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import db, { initDatabase } from '../src/core/database/index.ts';
import { addGame } from '../src/core/games/index.ts';
import { applyProposal } from '../src/core/saves/editor.ts';
import { recoverInterruptedOperations } from '../src/core/safety/operations.ts';
import { atomicWrite } from '../src/core/safety/atomic-write.ts';
import { validatePathSafety } from '../src/core/safety/path-safety.ts';
import { createBackup } from '../src/core/backups/index.ts';
import { Proposal } from '../src/shared/types/index.ts';
import { acquireFileLock, releaseFileLock } from '../src/core/safety/file-lock.ts';

describe('ResourceForge Safety & Lifecycle Hardening Tests', () => {
  const testGameDir = path.join(os.tmpdir(), 'resourceforge-test-game');
  let gameId = '';

  before(async () => {
    await initDatabase();
    
    // Ensure test game directory exists
    if (!fs.existsSync(testGameDir)) {
      fs.mkdirSync(testGameDir, { recursive: true });
    }

    // Add test game to database
    const game = addGame({
      name: 'Safe Integration Game',
      path: testGameDir,
      engine: 'Unity'
    });
    gameId = game.id;
  });

  after(() => {
    // Clean up test game directory
    if (fs.existsSync(testGameDir)) {
      try {
        fs.rmSync(testGameDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to clean up testGameDir:', e);
      }
    }
  });

  test('1. Path Containment and Safety Validation', () => {
    // 1a. Blocked Windows system folders
    const sysPathResult = validatePathSafety('c:\\windows\\system32\\drivers\\etc\\hosts');
    assert.strictEqual(sysPathResult.safe, false);
    assert.ok(sysPathResult.reason?.includes('blocked'));

    // 1b. Blocked drive root operations
    const driveRootResult = validatePathSafety('d:\\');
    assert.strictEqual(driveRootResult.safe, false);
    assert.ok(driveRootResult.reason?.includes('roots'));

    // 1c. Containment enforcement (outside game directory)
    const outsidePath = path.join(os.tmpdir(), 'resourceforge-unauthorized.json');
    // Write a dummy file to ensure realpath can check it if it exists
    fs.writeFileSync(outsidePath, '{}');
    try {
      const containmentResult = validatePathSafety(outsidePath, [testGameDir]);
      assert.strictEqual(containmentResult.safe, false);
      assert.ok(containmentResult.reason?.includes('outside') || containmentResult.reason?.includes('Containment'));
    } finally {
      if (fs.existsSync(outsidePath)) fs.unlinkSync(outsidePath);
    }
  });

  test('2. Exclusive Write Locking', async () => {
    const targetFile = path.join(testGameDir, 'save_lock.json');
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const canonicalPath = targetFile.toLowerCase();
    
    // Acquire the lock manually
    const lockedFirst = acquireFileLock(canonicalPath);
    assert.strictEqual(lockedFirst, true);

    // Try to apply a proposal while file is locked
    const proposal: Proposal = {
      id: crypto.randomUUID(),
      gameId,
      targetFile,
      operation: 'set',
      path: 'gold',
      oldValue: 100,
      newValue: 200,
      risk: 'Safe',
      preview: 'Change gold to 200',
      validationRule: 'exact_match',
      requiresBackup: true,
      dryRunPassed: true,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    const res = await applyProposal(proposal);
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('locked'));

    // Original content remains unchanged
    const currentContent = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
    assert.strictEqual(currentContent.gold, 100);

    // Release lock
    releaseFileLock(canonicalPath);
  });

  test('3. Stale Value Verification (Concurrent Mod Protection)', async () => {
    const targetFile = path.join(testGameDir, 'save_stale.json');
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const proposal: Proposal = {
      id: crypto.randomUUID(),
      gameId,
      targetFile,
      operation: 'set',
      path: 'gold',
      oldValue: 100,
      newValue: 200,
      risk: 'Safe',
      preview: 'Change gold to 200',
      validationRule: 'exact_match',
      requiresBackup: true,
      dryRunPassed: true,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    // Simulate another process modifying the save file after dry run
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 150 }));

    const res = await applyProposal(proposal);
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('stale') || res.error?.includes('changed') || res.error?.includes('stale edit'));

    // File content remains at the concurrently modified state
    const currentContent = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
    assert.strictEqual(currentContent.gold, 150);
  });

  test('4. Atomic Write Integrity & Hash Validation Mismatch', async () => {
    const targetFile = path.join(testGameDir, 'save_integrity.json');
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backupDir = path.join(testGameDir, 'backups');
    const backup = createBackup(gameId, targetFile, backupDir);

    // Corrupt the backup file manually to simulate integrity violation
    fs.writeFileSync(backup.backupPath, 'corrupted_backup_data');

    // Run atomicWrite directly with the corrupted backup
    const opId = crypto.randomUUID();
    const res = await atomicWrite(
      gameId,
      targetFile,
      JSON.stringify({ gold: 200 }),
      opId,
      backup.id,
      100,
      'gold'
    );

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('integrity') || res.error?.includes('hash'));

    // Verify original file is intact and not corrupted
    const currentContent = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
    assert.strictEqual(currentContent.gold, 100);
  });

  test('5. Interrupted Run (Crash Recovery)', async () => {
    const targetFile = path.join(testGameDir, 'save_crash.json');
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backupDir = path.join(testGameDir, 'backups');
    const backup = createBackup(gameId, targetFile, backupDir);

    // Simulate a crash by manually adding an operation record stuck in 'APPLYING'
    const opId = crypto.randomUUID();
    const propId = crypto.randomUUID();
    
    db.prepare(`
      INSERT INTO proposals (
        id, gameId, targetFile, operation, path, oldValue, newValue, risk, preview, validationRule, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      propId,
      gameId,
      targetFile,
      'set',
      'gold',
      '100',
      '200',
      'Safe',
      'Change gold from 100 to 200',
      'exact_match',
      'pending'
    );

    const stmt = db.prepare(`
      INSERT INTO operations (id, gameId, proposalId, targetFile, type, status, backupId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    stmt.run(opId, gameId, propId, targetFile, 'apply', 'APPLYING', backup.id);

    // Simulate corruption of target file (as if write was interrupted mid-way)
    fs.writeFileSync(targetFile, '{"gold": 999'); // Invalid malformed JSON

    // Run the startup crash recovery routine
    await recoverInterruptedOperations();

    // Verify target file has been restored to the original backup content
    const restoredContent = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
    assert.strictEqual(restoredContent.gold, 100);

    // Verify database operation status has updated to 'RESTORED'
    const opRow = db.prepare('SELECT status FROM operations WHERE id = ?').get(opId);
    assert.ok(opRow);
    assert.strictEqual(opRow.status, 'RESTORED');
  });
});
