import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { reconcileStorageClasses } from '../src/shared/storage-classes';

let workRoot: string;

before(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p03-'));
});

after(() => {
  fs.rmSync(workRoot, { recursive: true, force: true });
});

function freshUserDataRoot(): string {
  const dir = fs.mkdtempSync(path.join(workRoot, 'userdata-'));
  return dir;
}

describe('MP-P0.3 disposable/durable recovery storage split', () => {
  test('creates disposable and durable roots on a fresh install', () => {
    const userDataRoot = freshUserDataRoot();
    const roots = reconcileStorageClasses(userDataRoot);
    assert.ok(fs.existsSync(roots.disposableRoot));
    assert.ok(fs.existsSync(roots.durableRoot));
  });

  test('migrates an existing legacy logs/ directory into disposable/logs', () => {
    const userDataRoot = freshUserDataRoot();
    const legacyLogs = path.join(userDataRoot, 'logs');
    fs.mkdirSync(legacyLogs, { recursive: true });
    fs.writeFileSync(path.join(legacyLogs, 'crash_report.txt'), 'boom', 'utf8');
    fs.mkdirSync(path.join(legacyLogs, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(legacyLogs, 'nested', 'audit.jsonl'), '{}', 'utf8');

    const roots = reconcileStorageClasses(userDataRoot);

    assert.equal(fs.existsSync(legacyLogs), false, 'legacy logs directory should be removed after migration');
    const migrated = path.join(roots.disposableRoot, 'logs', 'crash_report.txt');
    assert.equal(fs.readFileSync(migrated, 'utf8'), 'boom');
    const migratedNested = path.join(roots.disposableRoot, 'logs', 'nested', 'audit.jsonl');
    assert.equal(fs.readFileSync(migratedNested, 'utf8'), '{}');
  });

  test('missing legacy directory is a no-op, not an error', () => {
    const userDataRoot = freshUserDataRoot();
    assert.doesNotThrow(() => reconcileStorageClasses(userDataRoot));
  });

  test('re-running reconciliation on an already-migrated install is idempotent', () => {
    const userDataRoot = freshUserDataRoot();
    fs.mkdirSync(path.join(userDataRoot, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(userDataRoot, 'logs', 'a.txt'), '1', 'utf8');

    const first = reconcileStorageClasses(userDataRoot);
    const second = reconcileStorageClasses(userDataRoot);

    assert.equal(first.disposableRoot, second.disposableRoot);
    assert.equal(fs.readFileSync(path.join(second.disposableRoot, 'logs', 'a.txt'), 'utf8'), '1');
  });

  test('interrupted migration (content moved, marker never written) resumes safely on next call', () => {
    const userDataRoot = freshUserDataRoot();
    const legacyLogs = path.join(userDataRoot, 'logs');
    fs.mkdirSync(legacyLogs, { recursive: true });
    fs.writeFileSync(path.join(legacyLogs, 'partial.txt'), 'data', 'utf8');

    // Simulate a completed-but-unmarked migration: content already moved by
    // a prior process that crashed before writing the state file, AND the
    // legacy directory was never cleaned up (worst case: crash mid-move,
    // some files already copied to destination, legacy dir still present).
    const disposableRoot = path.join(userDataRoot, 'disposable');
    fs.mkdirSync(path.join(disposableRoot, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(disposableRoot, 'logs', 'partial.txt'), 'data', 'utf8');
    // legacy file still exists too (the copy-then-unlink never reached unlink)

    const roots = reconcileStorageClasses(userDataRoot);

    assert.equal(fs.existsSync(legacyLogs), false);
    assert.equal(fs.readFileSync(path.join(roots.disposableRoot, 'logs', 'partial.txt'), 'utf8'), 'data');
  });

  test('corrupt migration-state marker is treated as no-migrations-done, not fatal', () => {
    const userDataRoot = freshUserDataRoot();
    const durableRoot = path.join(userDataRoot, 'durable');
    fs.mkdirSync(durableRoot, { recursive: true });
    fs.writeFileSync(path.join(durableRoot, '.storage-migration-state.json'), '{not valid json', 'utf8');

    const legacyLogs = path.join(userDataRoot, 'logs');
    fs.mkdirSync(legacyLogs, { recursive: true });
    fs.writeFileSync(path.join(legacyLogs, 'x.txt'), 'y', 'utf8');

    assert.doesNotThrow(() => reconcileStorageClasses(userDataRoot));
    const roots = reconcileStorageClasses(userDataRoot);
    assert.equal(fs.readFileSync(path.join(roots.disposableRoot, 'logs', 'x.txt'), 'utf8'), 'y');
  });

  test('uninstall/reinstall simulation: durable root survives a disposable-only wipe', () => {
    const userDataRoot = freshUserDataRoot();
    const roots = reconcileStorageClasses(userDataRoot);
    fs.writeFileSync(path.join(roots.durableRoot, 'recovery-ledger.json'), '{"entries":[]}', 'utf8');
    fs.writeFileSync(path.join(roots.disposableRoot, 'cache-blob.bin'), 'throwaway', 'utf8');

    // Simulate a cleanup routine that only ever touches disposable/.
    fs.rmSync(roots.disposableRoot, { recursive: true, force: true });

    assert.ok(fs.existsSync(path.join(roots.durableRoot, 'recovery-ledger.json')));
    // Reconciling again must recreate disposable/ without disturbing durable/.
    const rootsAfter = reconcileStorageClasses(userDataRoot);
    assert.ok(fs.existsSync(rootsAfter.disposableRoot));
    assert.equal(
      fs.readFileSync(path.join(rootsAfter.durableRoot, 'recovery-ledger.json'), 'utf8'),
      '{"entries":[]}',
    );
  });
});
