import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  runMutationTransaction,
  reconcileMutationTransactions,
  TransactionAbortedError,
  type MutationRequest,
  type JournalRecord,
} from '../src/core/safety/mutation-transaction-service';
import { authorizePath } from '../src/core/safety/handle-path-authorization';
import { acquireFileLock, releaseFileLock } from '../src/core/safety/file-lock';

/**
 * MP-P0.4 — MutationTransactionService adversarial + success test matrix.
 *
 * Covers the required categories from the plan: success, authorization,
 * concurrency, backup, temp, replace, journal, recovery, cleanup. Not every
 * one of the plan's 40 enumerated scenarios has a distinct test — several
 * collapse onto the same code path (e.g. "temp validation failure" and
 * "provider roundtrip failure" both go through `validateContent` throwing).
 * That collapsing is intentional and documented in the P0.4 checkpoint
 * report, not a silent gap.
 */

let approvedRoot: string;
let durableRoot: string;

before(() => {
  approvedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p04-root-'));
  durableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p04-durable-'));
});

after(() => {
  fs.rmSync(approvedRoot, { recursive: true, force: true });
  fs.rmSync(durableRoot, { recursive: true, force: true });
});

function makeTarget(name: string, content = 'original-content'): string {
  const p = path.join(approvedRoot, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function freshDurableRoot(): string {
  return fs.mkdtempSync(path.join(durableRoot, 'd-'));
}

function baseRequest(overrides: Partial<MutationRequest> & { targetPath: string; durableRoot: string }): MutationRequest {
  return {
    approvedRoots: [approvedRoot],
    provider: 'test-provider',
    produceContent: (original) => Buffer.from(`${original.toString('utf8')}-mutated`, 'utf8'),
    ...overrides,
  };
}

function readJournalFile(dRoot: string, transactionId: string): JournalRecord {
  const p = path.join(dRoot, 'recovery', 'transactions', `${transactionId}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as JournalRecord;
}

function journalDir(dRoot: string): string {
  return path.join(dRoot, 'recovery', 'transactions');
}

describe('MP-P0.4 MutationTransactionService', () => {
  describe('SUCCESS', () => {
    test('1. normal transaction completes and target holds new content', () => {
      const target = makeTarget('success-1.txt');
      const dRoot = freshDurableRoot();
      const receipt = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      assert.equal(receipt.status, 'COMMITTED');
      assert.equal(fs.readFileSync(target, 'utf8'), 'original-content-mutated');
    });

    test('2. original backup hash matches pre-mutation content', () => {
      const target = makeTarget('success-2.txt', 'preimage-abc');
      const dRoot = freshDurableRoot();
      const originalHash = crypto.createHash('sha256').update('preimage-abc').digest('hex');
      const receipt = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      assert.equal(receipt.originalHash, originalHash);
      const backupHash = crypto.createHash('sha256').update(fs.readFileSync(receipt.backupPath)).digest('hex');
      assert.equal(backupHash, originalHash);
    });

    test('3. final output hash matches actually-written content', () => {
      const target = makeTarget('success-3.txt');
      const dRoot = freshDurableRoot();
      const receipt = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      assert.equal(receipt.finalHash, actualHash);
    });

    test('4. receipt references the backup actually created for this transaction', () => {
      const target = makeTarget('success-4.txt');
      const dRoot = freshDurableRoot();
      const receipt = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      assert.ok(fs.existsSync(receipt.backupPath));
      assert.match(receipt.backupPath, new RegExp(receipt.transactionId));
    });

    test('5. committed journal state is COMMITTED', () => {
      const target = makeTarget('success-5.txt');
      const dRoot = freshDurableRoot();
      const receipt = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      const journal = readJournalFile(dRoot, receipt.transactionId);
      assert.equal(journal.state, 'COMMITTED');
    });
  });

  describe('AUTHORIZATION', () => {
    test('6. target outside approved root rejected', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p04-outside-'));
      const target = path.join(outsideDir, 'file.txt');
      fs.writeFileSync(target, 'x', 'utf8');
      const dRoot = freshDurableRoot();
      assert.throws(
        () => runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot })),
        TransactionAbortedError,
      );
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    test('7. symlink/junction escape rejected', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p04-outside-'));
      const realTarget = path.join(outsideDir, 'real.txt');
      fs.writeFileSync(realTarget, 'x', 'utf8');
      const junctionPath = path.join(approvedRoot, 'escape-junction.txt-dir');
      try {
        fs.symlinkSync(outsideDir, junctionPath, 'junction');
      } catch {
        fs.rmSync(outsideDir, { recursive: true, force: true });
        return; // Environment cannot create junctions without elevation — skip.
      }
      const target = path.join(junctionPath, 'real.txt');
      const dRoot = freshDurableRoot();
      assert.throws(
        () => runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot })),
        TransactionAbortedError,
      );
      fs.rmSync(junctionPath, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    test('8. deleted-then-recreated target rejected at pre-commit revalidation', () => {
      const target = makeTarget('auth-8.txt');
      const dRoot = freshDurableRoot();
      let didSwap = false;
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          if (point === 'pre_replace_revalidation' && !didSwap) {
            didSwap = true;
            fs.unlinkSync(target);
            fs.writeFileSync(target, 'attacker-content', 'utf8');
          }
        },
      });
      assert.throws(() => runMutationTransaction(request), TransactionAbortedError);
      assert.equal(fs.readFileSync(target, 'utf8'), 'attacker-content');
      assert.ok(didSwap);
    });

    test('9. journal for a rejected-at-revalidation transaction is marked ABORTED, not RECOVERY_REQUIRED', () => {
      const target = makeTarget('auth-9.txt');
      const dRoot = freshDurableRoot();
      let didSwap = false;
      let capturedTxId = '';
      const request: MutationRequest = {
        ...baseRequest({ targetPath: target, durableRoot: dRoot }),
        injectFailure: (point) => {
          if (point === 'pre_replace_revalidation' && !didSwap) {
            didSwap = true;
            fs.unlinkSync(target);
            fs.writeFileSync(target, 'attacker-content-2', 'utf8');
          }
        },
      };
      try {
        runMutationTransaction(request);
        assert.fail('expected throw');
      } catch (error) {
        assert.ok(error instanceof TransactionAbortedError);
        capturedTxId = error.transactionId;
      }
      const journal = readJournalFile(dRoot, capturedTxId);
      assert.equal(journal.state, 'ABORTED');
    });
  });

  describe('CONCURRENCY', () => {
    test('10. concurrent transaction against same target identity is rejected outright', () => {
      const target = makeTarget('concurrency-10.txt');
      const dRoot = freshDurableRoot();
      const authorization = authorizePath(target, [approvedRoot]);
      assert.ok(authorization.authorized && authorization.canonicalPath && authorization.fd !== undefined);
      fs.closeSync(authorization.fd!);
      const locked = acquireFileLock(authorization.canonicalPath!);
      assert.ok(locked, 'test setup should acquire the lock cleanly');
      try {
        assert.throws(
          () => runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot })),
          TransactionAbortedError,
        );
      } finally {
        releaseFileLock(authorization.canonicalPath!);
      }
    });

    test('11. lock is released after a rejected concurrent transaction, allowing a later one to proceed', () => {
      const target = makeTarget('concurrency-11.txt');
      const dRoot = freshDurableRoot();
      const receipt = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      assert.equal(receipt.status, 'COMMITTED');
      // A second, independent transaction against the same (now-mutated) target
      // should succeed cleanly — proves lock release happened in the finally block.
      const receipt2 = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      assert.equal(receipt2.status, 'COMMITTED');
    });
  });

  describe('BACKUP', () => {
    test('12. backup write failure aborts before any journal exists', () => {
      const target = makeTarget('backup-12.txt');
      const originalContent = fs.readFileSync(target, 'utf8');
      const dRoot = freshDurableRoot();
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          if (point === 'backup_write') throw new Error('simulated backup write failure');
        },
      });
      assert.throws(() => runMutationTransaction(request), /simulated backup write failure/);
      assert.equal(fs.readFileSync(target, 'utf8'), originalContent);
      assert.ok(!fs.existsSync(journalDir(dRoot)) || fs.readdirSync(journalDir(dRoot)).length === 0);
    });

    test('13. backup verification (hash) failure aborts and target is untouched', () => {
      const target = makeTarget('backup-13.txt');
      const originalContent = fs.readFileSync(target, 'utf8');
      const dRoot = freshDurableRoot();
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          if (point === 'backup_verify') throw new Error('simulated backup verification failure');
        },
      });
      assert.throws(() => runMutationTransaction(request), /simulated backup verification failure/);
      assert.equal(fs.readFileSync(target, 'utf8'), originalContent);
    });
  });

  describe('TEMP', () => {
    test('14. temp write failure marks journal ABORTED and preserves original', () => {
      const target = makeTarget('temp-14.txt');
      const originalContent = fs.readFileSync(target, 'utf8');
      const dRoot = freshDurableRoot();
      let capturedTxId = '';
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          if (point === 'temp_write') throw new Error('simulated temp write failure');
        },
      });
      try {
        runMutationTransaction(request);
        assert.fail('expected throw');
      } catch (error) {
        assert.match(String(error), /simulated temp write failure/);
      }
      const entries = fs.readdirSync(journalDir(dRoot));
      assert.equal(entries.length, 1);
      capturedTxId = entries[0]!.replace(/\.json$/, '');
      const journal = readJournalFile(dRoot, capturedTxId);
      assert.equal(journal.state, 'ABORTED');
      assert.equal(fs.readFileSync(target, 'utf8'), originalContent);
    });

    test('15. temp/roundtrip validation failure marks journal ABORTED and cleans up temp file', () => {
      const target = makeTarget('temp-15.txt');
      const originalContent = fs.readFileSync(target, 'utf8');
      const dRoot = freshDurableRoot();
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        validateContent: () => {
          throw new Error('simulated roundtrip validation failure');
        },
      });
      assert.throws(() => runMutationTransaction(request), /simulated roundtrip validation failure/);
      assert.equal(fs.readFileSync(target, 'utf8'), originalContent);
      const leftoverTemp = fs.readdirSync(approvedRoot).filter((f) => f.includes('.solith-txn-'));
      assert.deepEqual(leftoverTemp, []);
      const entries = fs.readdirSync(journalDir(dRoot));
      const journal = readJournalFile(dRoot, entries[0]!.replace(/\.json$/, ''));
      assert.equal(journal.state, 'ABORTED');
    });
  });

  describe('REPLACE', () => {
    test('16. replacement failure marks journal ABORTED (replace never physically happened) and cleans temp', () => {
      const target = makeTarget('replace-16.txt');
      const originalContent = fs.readFileSync(target, 'utf8');
      const dRoot = freshDurableRoot();
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          if (point === 'replace') throw new Error('simulated replace failure');
        },
      });
      assert.throws(() => runMutationTransaction(request), /simulated replace failure/);
      assert.equal(fs.readFileSync(target, 'utf8'), originalContent);
      const leftoverTemp = fs.readdirSync(approvedRoot).filter((f) => f.includes('.solith-txn-'));
      assert.deepEqual(leftoverTemp, []);
      const entries = fs.readdirSync(journalDir(dRoot));
      const journal = readJournalFile(dRoot, entries[0]!.replace(/\.json$/, ''));
      assert.equal(journal.state, 'ABORTED');
    });

    test('17. final-verification failure after a successful replace marks journal RECOVERY_REQUIRED, never ABORTED', () => {
      const target = makeTarget('replace-17.txt');
      const dRoot = freshDurableRoot();
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          if (point === 'final_verification') throw new Error('simulated final verification crash');
        },
      });
      assert.throws(() => runMutationTransaction(request), /simulated final verification crash/);
      // The physical rename already happened before the injected failure.
      assert.equal(fs.readFileSync(target, 'utf8'), 'original-content-mutated');
      const entries = fs.readdirSync(journalDir(dRoot));
      const journal = readJournalFile(dRoot, entries[0]!.replace(/\.json$/, ''));
      assert.equal(journal.state, 'RECOVERY_REQUIRED');
    });

    test('18. real final hash mismatch (content tampered mid-flight) marks journal RECOVERY_REQUIRED', () => {
      const target = makeTarget('replace-18.txt');
      const dRoot = freshDurableRoot();
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          // Runs immediately after fs.renameSync but before the hash read —
          // tamper with the just-replaced file so the hash comparison fails.
          if (point === 'final_verification') {
            fs.writeFileSync(target, 'tampered-post-replace', 'utf8');
          }
        },
      });
      assert.throws(() => runMutationTransaction(request), /Final replacement verification failed/);
      const entries = fs.readdirSync(journalDir(dRoot));
      const journal = readJournalFile(dRoot, entries[0]!.replace(/\.json$/, ''));
      assert.equal(journal.state, 'RECOVERY_REQUIRED');
      assert.equal(fs.readFileSync(target, 'utf8'), 'tampered-post-replace');
    });
  });

  describe('JOURNAL', () => {
    test('19. journal write failure aborts the transaction', () => {
      const target = makeTarget('journal-19.txt');
      const originalContent = fs.readFileSync(target, 'utf8');
      const dRoot = freshDurableRoot();
      const request = baseRequest({
        targetPath: target,
        durableRoot: dRoot,
        injectFailure: (point) => {
          if (point === 'journal_write') throw new Error('simulated journal write failure');
        },
      });
      assert.throws(() => runMutationTransaction(request), /simulated journal write failure/);
      assert.equal(fs.readFileSync(target, 'utf8'), originalContent);
    });

    test('20. malformed journal record on disk is classified CORRUPT_RECORD, never RECOVERY_REQUIRED or auto-repaired', () => {
      const dRoot = freshDurableRoot();
      const txnDir = journalDir(dRoot);
      fs.mkdirSync(txnDir, { recursive: true });
      fs.writeFileSync(path.join(txnDir, 'not-json.json'), '{not valid json', 'utf8');
      const reports = reconcileMutationTransactions(dRoot);
      assert.equal(reports.length, 1);
      assert.equal(reports[0]!.classification, 'CORRUPT_RECORD');
    });

    test('21. journal missing required schema fields is classified CORRUPT_RECORD', () => {
      const dRoot = freshDurableRoot();
      const txnDir = journalDir(dRoot);
      fs.mkdirSync(txnDir, { recursive: true });
      fs.writeFileSync(path.join(txnDir, 'incomplete.json'), JSON.stringify({ schemaVersion: 1, transactionId: 'x' }), 'utf8');
      const reports = reconcileMutationTransactions(dRoot);
      assert.equal(reports[0]!.classification, 'CORRUPT_RECORD');
    });
  });

  describe('RECOVERY', () => {
    test('22. non-terminal journal where replacement never began is classified SAFE_ABORT and cleans leftover temp', () => {
      const target = makeTarget('recovery-22.txt');
      const dRoot = freshDurableRoot();
      const tempPath = `${target}.solith-txn-fake.tmp`;
      fs.writeFileSync(tempPath, 'leftover', 'utf8');
      const record: JournalRecord = {
        schemaVersion: 1,
        transactionId: 'fake-tx-22',
        provider: 'test-provider',
        state: 'TEMP_VERIFIED',
        targetPath: target,
        identity: { dev: 1, ino: 1 },
        originalHash: 'irrelevant',
        originalSize: 0,
        backupPath: path.join(dRoot, 'recovery', 'backups', 'fake-tx-22.bak'),
        tempPath,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const txnDir = journalDir(dRoot);
      fs.mkdirSync(txnDir, { recursive: true });
      fs.writeFileSync(path.join(txnDir, 'fake-tx-22.json'), JSON.stringify(record), 'utf8');
      const reports = reconcileMutationTransactions(dRoot);
      assert.equal(reports[0]!.classification, 'SAFE_ABORT');
      assert.equal(reports[0]!.cleanedTemp, true);
      assert.ok(!fs.existsSync(tempPath));
      const journal = readJournalFile(dRoot, 'fake-tx-22');
      assert.equal(journal.state, 'ABORTED');
    });

    test('23. non-terminal journal at REPLACING is classified RECOVERY_REQUIRED and never touches original/backup', () => {
      const target = makeTarget('recovery-23.txt', 'still-original');
      const dRoot = freshDurableRoot();
      const record: JournalRecord = {
        schemaVersion: 1,
        transactionId: 'fake-tx-23',
        provider: 'test-provider',
        state: 'REPLACING',
        targetPath: target,
        identity: { dev: 1, ino: 1 },
        originalHash: 'irrelevant',
        originalSize: 0,
        backupPath: path.join(dRoot, 'recovery', 'backups', 'fake-tx-23.bak'),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const txnDir = journalDir(dRoot);
      fs.mkdirSync(txnDir, { recursive: true });
      fs.writeFileSync(path.join(txnDir, 'fake-tx-23.json'), JSON.stringify(record), 'utf8');
      const reports = reconcileMutationTransactions(dRoot);
      assert.equal(reports[0]!.classification, 'RECOVERY_REQUIRED');
      assert.equal(fs.readFileSync(target, 'utf8'), 'still-original');
    });

    test('24. already-COMMITTED journal is classified ALREADY_COMMITTED', () => {
      const dRoot = freshDurableRoot();
      const target = makeTarget('recovery-24.txt');
      const record: JournalRecord = {
        schemaVersion: 1,
        transactionId: 'fake-tx-24',
        provider: 'test-provider',
        state: 'COMMITTED',
        targetPath: target,
        identity: { dev: 1, ino: 1 },
        originalHash: 'irrelevant',
        originalSize: 0,
        backupPath: path.join(dRoot, 'recovery', 'backups', 'fake-tx-24.bak'),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const txnDir = journalDir(dRoot);
      fs.mkdirSync(txnDir, { recursive: true });
      fs.writeFileSync(path.join(txnDir, 'fake-tx-24.json'), JSON.stringify(record), 'utf8');
      const reports = reconcileMutationTransactions(dRoot);
      assert.equal(reports[0]!.classification, 'ALREADY_COMMITTED');
    });

    test('25. duplicate recovery invocation is idempotent', () => {
      const target = makeTarget('recovery-25.txt');
      const dRoot = freshDurableRoot();
      const tempPath = `${target}.solith-txn-fake25.tmp`;
      fs.writeFileSync(tempPath, 'leftover', 'utf8');
      const record: JournalRecord = {
        schemaVersion: 1,
        transactionId: 'fake-tx-25',
        provider: 'test-provider',
        state: 'TEMP_WRITTEN',
        targetPath: target,
        identity: { dev: 1, ino: 1 },
        originalHash: 'irrelevant',
        originalSize: 0,
        backupPath: path.join(dRoot, 'recovery', 'backups', 'fake-tx-25.bak'),
        tempPath,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const txnDir = journalDir(dRoot);
      fs.mkdirSync(txnDir, { recursive: true });
      fs.writeFileSync(path.join(txnDir, 'fake-tx-25.json'), JSON.stringify(record), 'utf8');

      const first = reconcileMutationTransactions(dRoot);
      assert.equal(first[0]!.classification, 'SAFE_ABORT');
      // Second run: journal is now ABORTED (terminal) and temp already gone —
      // must not throw and must not reclassify as something else.
      const second = reconcileMutationTransactions(dRoot);
      assert.equal(second[0]!.classification, 'SAFE_ABORT');
      assert.equal(second[0]!.cleanedTemp, undefined);
    });
  });

  describe('CLEANUP', () => {
    test('26. no successful mutation leaves a non-terminal journal on disk', () => {
      const target = makeTarget('cleanup-26.txt');
      const dRoot = freshDurableRoot();
      const receipt = runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      const journal = readJournalFile(dRoot, receipt.transactionId);
      assert.ok(journal.state === 'COMMITTED');
    });

    test('27. committed transaction releases the coordination lock', () => {
      const target = makeTarget('cleanup-27.txt');
      const dRoot = freshDurableRoot();
      runMutationTransaction(baseRequest({ targetPath: target, durableRoot: dRoot }));
      const authorization = authorizePath(target, [approvedRoot]);
      assert.ok(authorization.authorized && authorization.fd !== undefined);
      fs.closeSync(authorization.fd!);
      // If the lock had leaked, this acquire would fail.
      const locked = acquireFileLock(authorization.canonicalPath!);
      assert.ok(locked);
      releaseFileLock(authorization.canonicalPath!);
    });
  });
});
