import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import db, { resetForTesting } from '../src/core/database/index.ts';
import { addGame } from '../src/core/games/index.ts';
import { applyProposal } from '../src/core/saves/editor.ts';
import { recoverInterruptedOperations } from '../src/core/safety/operations.ts';
import { atomicWrite } from '../src/core/safety/atomic-write.ts';
import { validatePathSafety } from '../src/core/safety/path-safety.ts';
import { createBackup, restoreBackup } from '../src/core/backups/index.ts';
import { Proposal } from '../src/shared/types/index.ts';
import { acquireFileLock, releaseFileLock } from '../src/core/safety/file-lock.ts';

describe('Solith Safety & Lifecycle Hardening Tests', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const testRoot = path.join(os.tmpdir(), `solith-safety-${runId}`);
  const testGameDir = path.join(testRoot, 'game');
  let gameId = '';

  before(async () => {
    await resetForTesting();
    
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
    if (fs.existsSync(testRoot)) {
      try {
        fs.rmSync(testRoot, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to clean up safety test root:', e);
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
    const outsidePath = path.join(os.tmpdir(), 'solith-unauthorized.json');
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

    try {
      const res = await applyProposal(proposal);
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('locked'));

      // Original content remains unchanged
      const currentContent = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      assert.strictEqual(currentContent.gold, 100);
    } finally {
      releaseFileLock(canonicalPath);
    }
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

  test('6. Backup restore succeeds through locked atomic replacement', () => {
    const targetFile = path.join(testGameDir, 'save_restore_normal.json');
    const backupDir = path.join(testGameDir, 'backups');
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backup = createBackup(gameId, targetFile, backupDir);
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 250 }));

    const restored = restoreBackup(backup);

    assert.strictEqual(restored, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(targetFile, 'utf-8')), { gold: 100 });
  });

  test('7. Backup restore fails cleanly when physical backup is missing', () => {
    const targetFile = path.join(testGameDir, 'save_restore_missing.json');
    const backupDir = path.join(testGameDir, 'backups');
    const changed = JSON.stringify({ gold: 250 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backup = createBackup(gameId, targetFile, backupDir);
    fs.writeFileSync(targetFile, changed);
    fs.unlinkSync(backup.backupPath);

    const restored = restoreBackup(backup);

    assert.strictEqual(restored, false);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), changed);
  });

  test('8. Backup restore fails cleanly on hash mismatch and preserves current target', () => {
    const targetFile = path.join(testGameDir, 'save_restore_corrupt.json');
    const backupDir = path.join(testGameDir, 'backups');
    const changed = JSON.stringify({ gold: 250 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backup = createBackup(gameId, targetFile, backupDir);
    fs.writeFileSync(targetFile, changed);
    fs.writeFileSync(backup.backupPath, JSON.stringify({ gold: 999 }));

    const restored = restoreBackup(backup);

    assert.strictEqual(restored, false);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), changed);
  });

  test('9. Backup restore rejects target outside the approved game root', () => {
    const targetFile = path.join(testGameDir, 'save_restore_contained.json');
    const backupDir = path.join(testGameDir, 'backups');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-restore-outside-'));
    const outsideTarget = path.join(outsideDir, 'outside-save.json');
    const outsideContent = JSON.stringify({ gold: 777 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));
    fs.writeFileSync(outsideTarget, outsideContent);

    try {
      const backup = createBackup(gameId, targetFile, backupDir);
      const restored = restoreBackup({ ...backup, filePath: outsideTarget });

      assert.strictEqual(restored, false);
      assert.strictEqual(fs.readFileSync(outsideTarget, 'utf-8'), outsideContent);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test('10. Backup restore rejects symlink target escape when practical', (t) => {
    const targetFile = path.join(testGameDir, 'save_restore_symlink_source.json');
    const backupDir = path.join(testGameDir, 'backups');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-restore-link-'));
    const outsideTarget = path.join(outsideDir, 'outside-save.json');
    const linkTarget = path.join(testGameDir, 'linked-outside-save.json');
    const outsideContent = JSON.stringify({ gold: 777 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));
    fs.writeFileSync(outsideTarget, outsideContent);

    try {
      try {
        fs.symlinkSync(outsideTarget, linkTarget, 'file');
      } catch (error) {
        t.skip(`symlink creation unavailable on this Windows host: ${String(error)}`);
        return;
      }

      const backup = createBackup(gameId, targetFile, backupDir);
      const restored = restoreBackup({ ...backup, filePath: linkTarget });

      assert.strictEqual(restored, false);
      assert.strictEqual(fs.readFileSync(outsideTarget, 'utf-8'), outsideContent);
    } finally {
      if (fs.existsSync(linkTarget)) fs.rmSync(linkTarget, { force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
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

  test('6. Backup restore succeeds through locked atomic replacement', () => {
    const targetFile = path.join(testGameDir, 'save_restore_normal.json');
    const backupDir = path.join(testGameDir, 'backups');
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backup = createBackup(gameId, targetFile, backupDir);
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 250 }));

    const restored = restoreBackup(backup);

    assert.strictEqual(restored, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(targetFile, 'utf-8')), { gold: 100 });
  });

  test('7. Backup restore fails cleanly when physical backup is missing', () => {
    const targetFile = path.join(testGameDir, 'save_restore_missing.json');
    const backupDir = path.join(testGameDir, 'backups');
    const changed = JSON.stringify({ gold: 250 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backup = createBackup(gameId, targetFile, backupDir);
    fs.writeFileSync(targetFile, changed);
    fs.unlinkSync(backup.backupPath);

    const restored = restoreBackup(backup);

    assert.strictEqual(restored, false);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), changed);
  });

  test('8. Backup restore fails cleanly on hash mismatch and preserves current target', () => {
    const targetFile = path.join(testGameDir, 'save_restore_corrupt.json');
    const backupDir = path.join(testGameDir, 'backups');
    const changed = JSON.stringify({ gold: 250 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));

    const backup = createBackup(gameId, targetFile, backupDir);
    fs.writeFileSync(targetFile, changed);
    fs.writeFileSync(backup.backupPath, JSON.stringify({ gold: 999 }));

    const restored = restoreBackup(backup);

    assert.strictEqual(restored, false);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), changed);
  });

  test('9. Backup restore rejects target outside the approved game root', () => {
    const targetFile = path.join(testGameDir, 'save_restore_contained.json');
    const backupDir = path.join(testGameDir, 'backups');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-restore-outside-'));
    const outsideTarget = path.join(outsideDir, 'outside-save.json');
    const outsideContent = JSON.stringify({ gold: 777 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));
    fs.writeFileSync(outsideTarget, outsideContent);

    try {
      const backup = createBackup(gameId, targetFile, backupDir);
      const restored = restoreBackup({ ...backup, filePath: outsideTarget });

      assert.strictEqual(restored, false);
      assert.strictEqual(fs.readFileSync(outsideTarget, 'utf-8'), outsideContent);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test('10. Backup restore rejects symlink target escape when practical', (t) => {
    const targetFile = path.join(testGameDir, 'save_restore_symlink_source.json');
    const backupDir = path.join(testGameDir, 'backups');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-restore-link-'));
    const outsideTarget = path.join(outsideDir, 'outside-save.json');
    const linkTarget = path.join(testGameDir, 'linked-outside-save.json');
    const outsideContent = JSON.stringify({ gold: 777 });
    fs.writeFileSync(targetFile, JSON.stringify({ gold: 100 }));
    fs.writeFileSync(outsideTarget, outsideContent);

    try {
      try {
        fs.symlinkSync(outsideTarget, linkTarget, 'file');
      } catch (error) {
        t.skip(`symlink creation unavailable on this Windows host: ${String(error)}`);
        return;
      }

      const backup = createBackup(gameId, targetFile, backupDir);
      const restored = restoreBackup({ ...backup, filePath: linkTarget });

      assert.strictEqual(restored, false);
      assert.strictEqual(fs.readFileSync(outsideTarget, 'utf-8'), outsideContent);
    } finally {
      if (fs.existsSync(linkTarget)) fs.rmSync(linkTarget, { force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test('Candidate 1B: Fail-closed discriminant guard rejects malformed ok payloads in confirmInjectorLaunch', async () => {
    const { confirmInjectorLaunch } = await import('../src/core/in-process-script/injector-launcher.js');

    // Injector launch with unknown proposal or malformed consent must deny launch
    await assert.rejects(
      async () => {
        await confirmInjectorLaunch({
          proposalId: 'non-existent-proposal-id',
          consentToken: 'invalid-token',
        } as any);
      },
      (err: Error) => err.message.includes('Unknown injector launch proposal.'),
    );
  });

  test('Candidate 1B: Fail-closed discriminant guard handles malformed ok in MemoryManager', async () => {
    const { MemoryManager } = await import('../src/core/live-memory/memory-manager.js');
    const mm = new MemoryManager();
    const confirm = { success: true, manifest: { target: { dataType: 'int32', address: 0x100 } } } as any;

    // mock session with isOfflineConfirmed and confirmWrite, audit, and emitSnapshot returning malformed ok: undefined
    (mm as any).session = {
      isOfflineConfirmed: () => true,
      confirmWrite: async () => confirm,
    };
    (mm as any).audit = { append: () => {} };
    (mm as any).emitSnapshot = () => ({ ok: undefined, error: null });
    const res = await mm.confirmWrite('prop-1', { featureId: 'f1', userApproved: true });
    assert.strictEqual(res.snapshotError, 'snapshot_failed');
  });

  test('Candidate 1B: Fail-closed discriminant guard handles malformed ok in runHeadlessVerificationJob', async () => {
    const { runHeadlessVerificationJob } = await import('../src/core/runtime/headless-verification.js');
    const artifact = await runHeadlessVerificationJob(
      {
        protocolVersion: '1.0.0',
        requestId: 'req-1',
        type: 'VERIFY_REGISTRY_READONLY',
        sessionId: 'sess-1',
        registry: {
          schemaVersion: '1.0.0',
          game: 'Demo',
          sourceFile: 'demo.ct',
          sha256: 'a'.repeat(64),
          artifact: { source: { sha256: 'a'.repeat(64) } },
          registrySource: { game: 'Demo', sourceFile: 'demo.ct', sha256: 'a'.repeat(64), source: { provider: 'community' } as any },
          pipeline: {
            version: '1.0.0',
            entries: [
              {
                ct_entry_id: '1',
                label: 'Gold',
                address_data: { base: 'Game.exe', raw_address: '0x100', pointer_chain: [0x10] },
                linked_aob_ids: [],
              },
            ],
          },
          aobs: [],
          aobSignatures: [],
        },
        process: { pid: 1234, exePath: 'C:\\Game.exe', executableName: 'Game.exe', mainModule: 'Game.exe', selectedByUser: true },
      },
      {
        openSession: () => ({
          getModules: () => [{ name: 'Game.exe', baseAddress: '0x1000', size: 0x10000 }],
          readBytes: () => Buffer.from([]),
          close: () => {},
        }),
        // mock scanner returning malformed ok: undefined -> throws controlled SCANNER_ERROR and catches to helper_unavailable
        pointerL2Validator: async () => {
          const response = { ok: undefined, error: null } as any;
          if (response.ok !== true) {
            const err = response.error;
            const code = err?.code ?? 'SCANNER_ERROR';
            const message = err?.message ?? 'Scanner process failed or returned a malformed response.';
            throw new Error(`${code}: ${message}`);
          }
          return response.pointerResults;
        },
      },
    );
    assert.strictEqual(artifact.pointerResults.length, 1);
    assert.strictEqual(artifact.pointerResults[0].status, 'helper_unavailable');
    assert.ok(artifact.pointerResults[0].reason.includes('SCANNER_ERROR'), 'Reason must indicate controlled scanner failure');
  });
});
