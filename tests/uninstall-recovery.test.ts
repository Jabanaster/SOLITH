import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { reconcileStorageClasses } from '../src/shared/storage-classes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * MP-P0.2 — Uninstall / recovery behavior.
 *
 * package.json's build.nsis.deleteAppDataOnUninstall:false is real, verified
 * installer configuration — NOT the whole story. This suite provides the
 * deterministic integration-level evidence the plan requires beyond that
 * single config flag: reinstall discovers/reconciles existing durable state,
 * upgrade does not lose durable metadata, a missing durable root is
 * recreated safely, and unknown/corrupt durable state fails safe rather than
 * being silently trusted.
 *
 * Explicitly NOT covered here (environment-dependent, documented rather than
 * silently skipped): actually running the built NSIS installer/uninstaller
 * end-to-end. That requires a real Windows install of the packaged app and
 * is not something this test environment can execute safely — the config
 * assertion below is the verifiable proxy for "the installer will not
 * destroy userData", and reconcileStorageClasses (exercised the same way on
 * every real app startup, per electron/main.ts) is the verifiable proxy for
 * "reinstall/upgrade correctly rediscovers whatever userData already
 * contains."
 */

let workRoot: string;

before(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p02-'));
});

after(() => {
  fs.rmSync(workRoot, { recursive: true, force: true });
});

function freshUserDataRoot(): string {
  return fs.mkdtempSync(path.join(workRoot, 'userdata-'));
}

describe('MP-P0.2 uninstall / recovery behavior', () => {
  test('installer config: deleteAppDataOnUninstall is false', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(
      pkg.build?.nsis?.deleteAppDataOnUninstall,
      false,
      'a real Windows uninstall must not delete userData (disposable or durable) — verified environment-dependent behavior beyond this repo boundary',
    );
  });

  test('uninstall simulation: nothing in our own code path deletes userData outside disposable/', () => {
    // With deleteAppDataOnUninstall:false, the NSIS uninstaller itself never
    // touches userData. The only in-repo code that could still destroy
    // durable state on "uninstall" would be an app-level cleanup routine —
    // there is none (reconcileStorageClasses only ever creates/migrates,
    // never deletes durable/). Prove durable survives an entire userData
    // directory being left completely untouched (the real uninstall
    // behavior) across a simulated "next launch."
    const userDataRoot = freshUserDataRoot();
    const before = reconcileStorageClasses(userDataRoot);
    fs.writeFileSync(path.join(before.durableRoot, 'recovery-ledger.json'), '{"entries":["a"]}', 'utf8');

    // Simulated uninstall: literally do nothing to userDataRoot (that IS the
    // configured behavior) — then simulate the next launch reconciling again.
    const after = reconcileStorageClasses(userDataRoot);
    assert.equal(
      fs.readFileSync(path.join(after.durableRoot, 'recovery-ledger.json'), 'utf8'),
      '{"entries":["a"]}',
    );
  });

  test('reinstall simulation: fresh reconcile call against pre-existing durable state rediscovers it without loss', () => {
    // "Reinstall" here means: the installed files are replaced/rewritten, but
    // deleteAppDataOnUninstall:false means the prior userData directory (this
    // repo's actual guarantee) is still on disk when the app first launches
    // again. reconcileStorageClasses is exactly the code path electron/main.ts
    // runs on every startup — a second independent call against a userDataRoot
    // that already has durable content is the deterministic proxy for this.
    const userDataRoot = freshUserDataRoot();
    const firstInstall = reconcileStorageClasses(userDataRoot);
    fs.writeFileSync(
      path.join(firstInstall.durableRoot, 'trusted-catalog.json'),
      '{"catalogVersion":3}',
      'utf8',
    );
    fs.writeFileSync(path.join(firstInstall.disposableRoot, 'cache.bin'), 'ephemeral', 'utf8');

    // "Reinstall": a completely independent call (fresh process, same disk state).
    const reinstalled = reconcileStorageClasses(userDataRoot);

    assert.equal(reinstalled.durableRoot, firstInstall.durableRoot);
    assert.equal(
      fs.readFileSync(path.join(reinstalled.durableRoot, 'trusted-catalog.json'), 'utf8'),
      '{"catalogVersion":3}',
      'durable state must be rediscovered intact after reinstall',
    );
    assert.ok(
      fs.existsSync(path.join(reinstalled.disposableRoot, 'cache.bin')),
      'disposable state is not required to survive but must not be actively destroyed by reconciliation itself',
    );
  });

  test('upgrade simulation: durable metadata survives an old-schema migration-state marker being reconciled by newer code', () => {
    // Simulates a version upgrade: an older build wrote a migration-state
    // marker without a schemaVersion field (pre-versioning), and durable
    // content already exists. The current build must not treat the missing
    // field as corruption/reset, and must not lose the existing durable data.
    const userDataRoot = freshUserDataRoot();
    const durableRoot = path.join(userDataRoot, 'durable');
    const disposableRoot = path.join(userDataRoot, 'disposable');
    fs.mkdirSync(durableRoot, { recursive: true });
    fs.mkdirSync(disposableRoot, { recursive: true });
    // Pre-versioning marker shape (no schemaVersion key) — what an older
    // build of this exact module would have written.
    fs.writeFileSync(
      path.join(durableRoot, '.storage-migration-state.json'),
      JSON.stringify({ completed: ['logs-to-disposable-v1'] }),
      'utf8',
    );
    fs.writeFileSync(path.join(durableRoot, 'transaction-receipts.json'), '{"receipts":[]}', 'utf8');

    const roots = reconcileStorageClasses(userDataRoot);

    assert.equal(
      fs.readFileSync(path.join(roots.durableRoot, 'transaction-receipts.json'), 'utf8'),
      '{"receipts":[]}',
      'pre-existing durable content must survive being reconciled by newer, schema-versioned code',
    );
    const marker = JSON.parse(fs.readFileSync(path.join(durableRoot, '.storage-migration-state.json'), 'utf8'));
    assert.equal(marker.schemaVersion, 1, 'reconciliation should upgrade the marker to the current schema version');
  });

  test('a migration-state marker with a schemaVersion newer than this build understands is not blindly trusted', () => {
    // Inverse of the upgrade case: a DOWNGRADE (or a marker from a future
    // build). Must not silently trust "completed" entries this build cannot
    // verify — falls back to re-attempting migrations, which is safe (idempotent).
    const userDataRoot = freshUserDataRoot();
    const durableRoot = path.join(userDataRoot, 'durable');
    fs.mkdirSync(durableRoot, { recursive: true });
    fs.writeFileSync(
      path.join(durableRoot, '.storage-migration-state.json'),
      JSON.stringify({ schemaVersion: 999, completed: ['logs-to-disposable-v1'] }),
      'utf8',
    );
    const legacyLogs = path.join(userDataRoot, 'logs');
    fs.mkdirSync(legacyLogs, { recursive: true });
    fs.writeFileSync(path.join(legacyLogs, 'still-here.txt'), 'z', 'utf8');

    const roots = reconcileStorageClasses(userDataRoot);

    // Migration re-runs (safe/idempotent) rather than being skipped on the
    // strength of an untrusted future-schema marker.
    assert.equal(
      fs.readFileSync(path.join(roots.disposableRoot, 'logs', 'still-here.txt'), 'utf8'),
      'z',
    );
  });

  test('missing durable root (deleted independently of disposable) is recreated safely on next reconcile', () => {
    const userDataRoot = freshUserDataRoot();
    const roots = reconcileStorageClasses(userDataRoot);
    fs.writeFileSync(path.join(roots.disposableRoot, 'kept.bin'), 'x', 'utf8');
    // Durable root itself is gone (e.g. an external tool deleted it) —
    // its prior contents are unrecoverable by definition, but reconciliation
    // must not crash and must produce a fresh, usable durable root rather
    // than silently operating against a nonexistent path.
    fs.rmSync(roots.durableRoot, { recursive: true, force: true });

    assert.doesNotThrow(() => reconcileStorageClasses(userDataRoot));
    const after = reconcileStorageClasses(userDataRoot);
    assert.ok(fs.existsSync(after.durableRoot));
    assert.ok(fs.existsSync(path.join(after.disposableRoot, 'kept.bin')));
  });

  test('durable root existing as a non-directory file fails loudly rather than silently corrupting data', () => {
    const userDataRoot = freshUserDataRoot();
    // A stray file sitting where the durable directory should be — this is
    // the "unknown/corrupt durable state" case at the filesystem-object
    // level, not just the JSON-marker level (already covered above).
    fs.writeFileSync(path.join(userDataRoot, 'durable'), 'not a directory', 'utf8');

    assert.throws(
      () => reconcileStorageClasses(userDataRoot),
      /EEXIST|ENOTDIR/,
      'must fail loudly (mkdirSync throws) rather than silently treating a stray file as an empty durable root',
    );
  });
});
