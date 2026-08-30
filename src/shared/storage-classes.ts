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

const MIGRATION_STATE_SCHEMA_VERSION = 1 as const;

interface MigrationState {
  /**
   * MP-P0.2/P0.3 — durable storage versioning. Present since the version
   * this field was introduced; older marker files written before it existed
   * simply lack the key, which readMigrationState treats as version 1 (the
   * only version that has ever existed) rather than as corruption.
   */
  schemaVersion: number;
  completed: string[];
}

interface LegacyMigration {
  id: string;
  legacyRelativePath: string;
  destinationClass: 'disposable' | 'durable';
  destinationRelativePath: string;
  /** 'directory' (default) moves a whole tree; 'file' moves a single file. */
  kind?: 'directory' | 'file';
}

const LEGACY_MIGRATIONS: LegacyMigration[] = [
  {
    id: 'logs-to-disposable-v1',
    legacyRelativePath: 'logs',
    destinationClass: 'disposable',
    destinationRelativePath: 'logs',
  },
  {
    // MP-P0.3 — solith.db is the Recovery Ledger / trusted catalog / backup
    // ownership metadata store itself, unambiguously durable. sql.js (not
    // better-sqlite3) is the engine here — it loads the whole file into
    // memory once at initDatabase() and persists via a single atomic
    // tmp-then-rename write (see database/index.ts's atomicWriteFileSync),
    // no WAL/SHM sidecar files and no native OS-level file lock held between
    // app launches — so a copy-then-unlink move of the flat file, performed
    // before initDatabase() ever opens it, is safe with no partial-write or
    // stale-lock risk. No content inside the database references its own
    // file path, so relocating it does not invalidate anything stored in it.
    id: 'solith-db-to-durable-v1',
    legacyRelativePath: 'solith.db',
    destinationClass: 'durable',
    destinationRelativePath: 'solith.db',
    kind: 'file',
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
    const schemaVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
    if (
      schemaVersion > MIGRATION_STATE_SCHEMA_VERSION ||
      !Array.isArray(parsed.completed) ||
      !parsed.completed.every((entry) => typeof entry === 'string')
    ) {
      // Corrupt/malformed shape, OR a schema version newer than this build
      // understands (a downgrade scenario) — treat as no migrations recorded
      // rather than trusting data this build cannot safely interpret.
      // Migrations are idempotent, so redoing one that already happened is
      // safe (see moveDirectoryContentsRecursive's copy-then-remove).
      return { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, completed: [] };
    }
    return { schemaVersion, completed: parsed.completed };
  } catch {
    // File missing or unreadable/corrupt JSON — same fallback as above.
    return { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, completed: [] };
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
      if (migration.kind === 'file') {
        if (stat.isFile()) {
          // Copy-then-unlink, same resumability guarantee as the directory
          // case below: re-copying an already-copied file (crash between
          // copy and unlink) is a safe no-op in effect.
          fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
          fs.copyFileSync(legacyPath, destinationPath);
          fs.unlinkSync(legacyPath);
        }
      } else if (stat.isDirectory()) {
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

  writeMigrationState(durableRoot, { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, completed: Array.from(completed) });

  return { disposableRoot, durableRoot };
}
