/**
 * src/shared/storage-classes.ts
 *
 * MP-P0.3 — disposable vs. durable recovery storage split.
 *
 * Today everything under userData sits flat: solith.db, backups/, logs/,
 * runtime-verification/, research-sessions/ are all siblings with no formal
 * distinction between "safe to wipe" and "required for recovery." A future
 * cache-cleanup routine (or a user manually clearing what looks like cache)
 * has no way to know which of those it's safe to touch.
 *
 * This module defines two explicit roots under userData:
 *   disposable/ — cache, thumbnails, temporary scans, transient logs
 *   durable/    — Recovery Ledger, transaction journal/receipts, backup
 *                 ownership metadata, trusted catalog state, definitions,
 *                 research metadata required for recovery
 *
 * `reconcileStorageClasses` is idempotent and safe to call on every startup:
 * it creates both roots if missing, and migrates specific known legacy
 * directories (see LEGACY_MIGRATIONS) into their classified location using a
 * durable migration-state marker so an interrupted migration resumes cleanly
 * instead of re-copying or losing track of progress.
 *
 * Scope note: only the `logs` legacy directory is migrated by this pass (the
 * one unambiguous disposable case). `backups/`, `solith.db`, and
 * `research-sessions/` are NOT yet migrated — they need a per-consumer audit
 * (of src/core/saves/editor.ts, src/core/database/index.ts,
 * electron/live-memory-ipc.ts, electron/avowed-wingdk-backup-watch.ts) before
 * their physical location can move without breaking references. This is
 * follow-up work, not silently assumed done.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface StorageRoots {
  disposableRoot: string;
  durableRoot: string;
}

interface MigrationState {
  completed: string[];
}

interface LegacyMigration {
  id: string;
  legacyRelativePath: string;
  destinationClass: 'disposable' | 'durable';
  destinationRelativePath: string;
}

const LEGACY_MIGRATIONS: LegacyMigration[] = [
  {
    id: 'logs-to-disposable-v1',
    legacyRelativePath: 'logs',
    destinationClass: 'disposable',
    destinationRelativePath: 'logs',
  },
];

function migrationStatePath(durableRoot: string): string {
  return path.join(durableRoot, '.storage-migration-state.json');
}

function readMigrationState(durableRoot: string): MigrationState {
  const statePath = migrationStatePath(durableRoot);
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MigrationState>;
    if (Array.isArray(parsed.completed) && parsed.completed.every((entry) => typeof entry === 'string')) {
      return { completed: parsed.completed };
    }
    // Corrupt/malformed shape — treat as no migrations recorded rather than
    // trusting partial garbage. Migrations are idempotent, so redoing a
    // migration that already happened is safe (see markMigrationStarting).
    return { completed: [] };
  } catch {
    // File missing or unreadable/corrupt JSON — same fallback as above.
    return { completed: [] };
  }
}

function writeMigrationState(durableRoot: string, state: MigrationState): void {
  const statePath = migrationStatePath(durableRoot);
  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, statePath);
}

function moveDirectoryContentsRecursive(sourceDir: string, destinationDir: string): void {
  fs.mkdirSync(destinationDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      moveDirectoryContentsRecursive(sourcePath, destinationPath);
      fs.rmdirSync(sourcePath);
    } else {
      // Copy-then-remove rather than rename: a plain rename can fail across
      // volumes (e.g. userData redirected to a different drive), and a
      // partial copy left behind by a crash is safely resumable (re-copying
      // an already-copied file is a no-op in effect).
      fs.copyFileSync(sourcePath, destinationPath);
      fs.unlinkSync(sourcePath);
    }
  }
}

/**
 * Idempotent: safe to call on every startup. Creates both storage-class
 * roots if missing, then applies each not-yet-completed legacy migration.
 * A migration is marked complete only after its content has been fully
 * moved and its now-empty legacy directory removed — if the process crashes
 * mid-migration, the marker was never written, so the next call resumes by
 * re-attempting the same move (safe, since moveDirectoryContentsRecursive
 * copy-then-removes per file rather than assuming an all-or-nothing rename).
 */
export function reconcileStorageClasses(userDataRoot: string): StorageRoots {
  const disposableRoot = path.join(userDataRoot, 'disposable');
  const durableRoot = path.join(userDataRoot, 'durable');
  fs.mkdirSync(disposableRoot, { recursive: true });
  fs.mkdirSync(durableRoot, { recursive: true });

  const state = readMigrationState(durableRoot);
  const completed = new Set(state.completed);

  for (const migration of LEGACY_MIGRATIONS) {
    if (completed.has(migration.id)) continue;

    const legacyPath = path.join(userDataRoot, migration.legacyRelativePath);
    const destinationRoot = migration.destinationClass === 'disposable' ? disposableRoot : durableRoot;
    const destinationPath = path.join(destinationRoot, migration.destinationRelativePath);

    if (!fs.existsSync(legacyPath)) {
      // Nothing to migrate (fresh install, or a prior run already finished
      // moving it but crashed before writing the marker) — mark done either way.
      completed.add(migration.id);
      continue;
    }

    try {
      const stat = fs.lstatSync(legacyPath);
      if (stat.isDirectory()) {
        moveDirectoryContentsRecursive(legacyPath, destinationPath);
        // Directory is empty now; remove it so the legacy path stops existing.
        fs.rmdirSync(legacyPath);
      }
      completed.add(migration.id);
    } catch (error) {
      // Leave this migration un-marked so the next startup retries it.
      // Do not let one failing migration block the others.
      console.warn(`[storage-classes] migration "${migration.id}" failed, will retry next startup:`, error);
    }
  }

  writeMigrationState(durableRoot, { completed: Array.from(completed) });

  return { disposableRoot, durableRoot };
}
