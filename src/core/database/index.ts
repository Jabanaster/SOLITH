import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAppPaths } from '../../shared/app-paths.js';
import {
  createInstallIdentity,
  createLegacyInstallIdentity,
  INSTALL_IDENTITY_VERSION,
} from '../install-discovery/identity.js';
import type { InstallPlatform, RawInstalledGame } from '../install-discovery/types.js';

let dbPath = '';

let rawDb: any = null;
let initialized = false;

let persistTimeout: NodeJS.Timeout | null = null;
let pendingPersistPromise: Promise<void> | null = null;
let resolvePendingPersist: (() => void) | null = null;
let rejectPendingPersist: ((err: Error) => void) | null = null;
let inTransaction = false;

export interface InstalledGameIdentityMigrationReport {
  verified: number;
  backfilled: number;
  ambiguous: number;
  collisions: number;
  unchanged: number;
}

let installedGameIdentityMigrationReport: InstalledGameIdentityMigrationReport = {
  verified: 0,
  backfilled: 0,
  ambiguous: 0,
  collisions: 0,
  unchanged: 0,
};

export function getInstalledGameIdentityMigrationReport(): InstalledGameIdentityMigrationReport {
  return { ...installedGameIdentityMigrationReport };
}

function migrateInstalledGameIdentity(): void {
  const tableInfo = rawDb!.exec('PRAGMA table_info(installed_games)')[0];
  const columnNames = new Set((tableInfo?.values ?? []).map((row: unknown[]) => String(row[1])));
  if (columnNames.has('install_identity')) {
    installedGameIdentityMigrationReport = {
      verified: 0,
      backfilled: 0,
      ambiguous: 0,
      collisions: 0,
      unchanged: Number(rawDb!.exec('SELECT COUNT(*) FROM installed_games')[0]?.values?.[0]?.[0] ?? 0),
    };
    rawDb!.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_games_identity ON installed_games(install_identity)');
    return;
  }

  const legacyRows = (rawDb!.exec(`
    SELECT id, catalog_game_id, platform, install_path, executable_path,
           display_name, steam_app_id, detected_at, last_seen_at
    FROM installed_games
    ORDER BY id
  `)[0]?.values ?? []) as unknown[][];

  const planned = legacyRows.map((row) => {
    const legacyId = String(row[0]);
    const game: RawInstalledGame = {
      platform: String(row[2]) as InstallPlatform,
      installPath: String(row[3] ?? ''),
      executablePath: row[4] ? String(row[4]) : undefined,
      displayName: row[5] ? String(row[5]) : undefined,
      steamAppId: row[6] != null ? Number(row[6]) : undefined,
    };
    const identity = createInstallIdentity(game);
    const collisionKey = identity.canonicalExecutablePath
      ? `exe:${identity.canonicalExecutablePath}`
      : identity.launcherAppId
        ? `launcher:${identity.launcherAppId}:${identity.canonicalInstallPath}`
        : `path:${game.platform}:${identity.canonicalInstallPath}`;
    return { row, legacyId, game, identity, collisionKey };
  });

  const collisionCounts = new Map<string, number>();
  for (const item of planned) {
    collisionCounts.set(item.collisionKey, (collisionCounts.get(item.collisionKey) ?? 0) + 1);
  }

  installedGameIdentityMigrationReport = {
    verified: 0,
    backfilled: 0,
    ambiguous: 0,
    collisions: [...collisionCounts.values()].filter((count) => count > 1).length,
    unchanged: 0,
  };

  rawDb!.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    rawDb!.run(`
      CREATE TABLE installed_games_identity_v2 (
        id TEXT PRIMARY KEY,
        install_identity TEXT NOT NULL,
        canonical_install_path TEXT NOT NULL,
        canonical_executable_path TEXT,
        launcher_app_id TEXT,
        identity_version INTEGER NOT NULL,
        identity_status TEXT NOT NULL,
        needs_reverification INTEGER NOT NULL DEFAULT 0,
        catalog_game_id TEXT,
        platform TEXT NOT NULL,
        install_path TEXT NOT NULL,
        executable_path TEXT,
        display_name TEXT,
        steam_app_id INTEGER,
        detected_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      )
    `);

    const insert = rawDb!.prepare(`
      INSERT INTO installed_games_identity_v2 (
        id, install_identity, canonical_install_path, canonical_executable_path,
        launcher_app_id, identity_version, identity_status, needs_reverification,
        catalog_game_id, platform, install_path, executable_path, display_name,
        steam_app_id, detected_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of planned) {
      const collided = (collisionCounts.get(item.collisionKey) ?? 0) > 1;
      const lacksConcreteIdentity = !item.identity.canonicalExecutablePath && !item.identity.launcherAppId;
      const identity = collided || lacksConcreteIdentity
        ? createLegacyInstallIdentity(item.game.platform, item.game.installPath, item.legacyId)
        : item.identity;
      const status = collided || lacksConcreteIdentity ? 'ambiguous' : 'backfilled';
      if (status === 'backfilled') installedGameIdentityMigrationReport.backfilled += 1;
      else installedGameIdentityMigrationReport.ambiguous += 1;

      insert.run([
        item.legacyId,
        identity.installIdentity,
        identity.canonicalInstallPath,
        identity.canonicalExecutablePath ?? null,
        identity.launcherAppId ?? null,
        INSTALL_IDENTITY_VERSION,
        status,
        collided || lacksConcreteIdentity || identity.needsReverification ? 1 : 0,
        item.row[1] ?? null,
        item.game.platform,
        item.game.installPath,
        item.game.executablePath ?? null,
        item.game.displayName ?? null,
        item.game.steamAppId ?? null,
        String(item.row[7]),
        String(item.row[8]),
      ]);
    }
    insert.free();

    rawDb!.run('ALTER TABLE installed_games RENAME TO installed_games_identity_v1');
    rawDb!.run('ALTER TABLE installed_games_identity_v2 RENAME TO installed_games');
    rawDb!.run('DROP TABLE installed_games_identity_v1');
    rawDb!.run('CREATE UNIQUE INDEX idx_installed_games_identity ON installed_games(install_identity)');
    rawDb!.run('CREATE INDEX idx_installed_games_catalog ON installed_games(catalog_game_id)');
    rawDb!.run('COMMIT');
  } catch (error) {
    rawDb!.run('ROLLBACK');
    throw error;
  }

  const boundedReport = JSON.stringify(installedGameIdentityMigrationReport);
  console.info(`[database] installed-game identity migration ${boundedReport.slice(0, 512)}`);
}

function checkTransaction(sql: string) {
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('BEGIN') || upper.startsWith('SAVEPOINT')) {
    inTransaction = true;
  } else if (upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK') || upper.startsWith('RELEASE')) {
    inTransaction = false;
  }
}

/**
 * Atomically replace a file (temp sibling + rename). Prevents truncated DB files
 * when the process dies mid-write.
 */
export function atomicWriteFileSync(targetPath: string, data: Buffer | string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = path.join(
    dir,
    `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, data);
    fs.renameSync(tempPath, targetPath);
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

function exportAndPersistToDisk(sqlDb: any): void {
  if (!sqlDb || !dbPath || dbPath === ':memory:') {
    return;
  }
  const data = sqlDb.export();
  const buffer = Buffer.from(data);
  atomicWriteFileSync(dbPath, buffer);
}

// Persists the in-memory sql.js database to disk
export function persistDatabase(sqlDb: any, forceSync = false): Promise<void> {
  if (inTransaction && !forceSync) {
    if (!pendingPersistPromise) {
      pendingPersistPromise = new Promise((resolve, reject) => {
        resolvePendingPersist = resolve;
        rejectPendingPersist = reject;
      });
    }
    return pendingPersistPromise;
  }

  const performWrite = () => {
    try {
      if (!sqlDb || !dbPath || dbPath === ':memory:') {
        if (resolvePendingPersist) resolvePendingPersist();
        return;
      }
      exportAndPersistToDisk(sqlDb);
      if (resolvePendingPersist) resolvePendingPersist();
    } catch (error: any) {
      console.error('Failed to persist database:', error);
      if (rejectPendingPersist) rejectPendingPersist(error);
      throw error;
    } finally {
      pendingPersistPromise = null;
      resolvePendingPersist = null;
      rejectPendingPersist = null;
    }
  };

  if (forceSync) {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    performWrite();
    return Promise.resolve();
  }

  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }

  if (!pendingPersistPromise) {
    pendingPersistPromise = new Promise((resolve, reject) => {
      resolvePendingPersist = resolve;
      rejectPendingPersist = reject;
    });
  }

  persistTimeout = setTimeout(() => {
    persistTimeout = null;
    performWrite();
  }, 10);

  return pendingPersistPromise;
}

export function flushPersistence(): Promise<void> {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  if (rawDb && dbPath && dbPath !== ':memory:') {
    try {
      exportAndPersistToDisk(rawDb);
      if (resolvePendingPersist) resolvePendingPersist();
    } catch (error: any) {
      if (rejectPendingPersist) rejectPendingPersist(error);
    } finally {
      pendingPersistPromise = null;
      resolvePendingPersist = null;
      rejectPendingPersist = null;
    }
  } else {
    // In-memory database, just resolve immediately
    if (resolvePendingPersist) resolvePendingPersist();
    pendingPersistPromise = null;
    resolvePendingPersist = null;
    rejectPendingPersist = null;
  }
  return pendingPersistPromise || Promise.resolve();
}

export async function closeDatabaseSafely(): Promise<void> {
  await flushPersistence();
  if (rawDb) {
    rawDb.close();
    rawDb = null;
    initialized = false;
  }
}

export function schedulePersistence(): Promise<void> {
  return persistDatabase(rawDb);
}

if (typeof process !== 'undefined') {
  process.on('exit', () => {
    if (rawDb && dbPath && dbPath !== ':memory:') {
      try {
        exportAndPersistToDisk(rawDb);
      } catch (e) {
        console.error('Failed to flush database on process exit:', e);
      }
    }
  });
}

// Helper to convert date columns to Date objects
function convertRowDates(row: any): any {
  if (!row) return row;
  const dateColumns = [
    'dateadded', 'lastscan', 'created_at', 'updated_at', 
    'createdat', 'updatedat', 'timestamp', 'discoveredat'
  ];
  const newRow = { ...row };
  for (const key of Object.keys(newRow)) {
    if (dateColumns.includes(key.toLowerCase()) && newRow[key]) {
      if (!(newRow[key] instanceof Date)) {
        const date = new Date(newRow[key]);
        if (!isNaN(date.getTime())) {
          newRow[key] = date;
        }
      }
    }
  }
  return newRow;
}

// Wrapper for sql.js Statement to present a prepared-statement style API
class StatementWrapper {
  private stmt: any;
  private sql: string;
  private db: any;

  constructor(stmt: any, sql: string, db: any) {
    this.stmt = stmt;
    this.sql = sql;
    this.db = db;
  }

  all(...params: any[]): any[] {
    try {
      const sanitized = params.map(p => p === undefined ? null : p);
      this.stmt.bind(sanitized);
      const results: any[] = [];
      while (this.stmt.step()) {
        results.push(convertRowDates(this.stmt.getAsObject()));
      }
      this.stmt.reset();
      return results;
    } catch (e) {
      console.error(`SQL stmt.all error on SQL: ${this.sql}`, e);
      throw e;
    }
  }

  get(...params: any[]): any {
    try {
      const sanitized = params.map(p => p === undefined ? null : p);
      this.stmt.bind(sanitized);
      let result: any = null;
      if (this.stmt.step()) {
        result = convertRowDates(this.stmt.getAsObject());
      }
      this.stmt.reset();
      return result;
    } catch (e) {
      console.error(`SQL stmt.get error on SQL: ${this.sql}`, e);
      throw e;
    }
  }

  run(...params: any[]): { lastInsertRowid: string | number; changes: number } {
    try {
      const sanitized = params.map(p => p === undefined ? null : p);
      this.stmt.bind(sanitized);
      this.stmt.step();
      this.stmt.reset();
      
      // Get changes and last insert row ID from SQLite
      const lastInsertRowidRes = this.db.exec("SELECT last_insert_rowid() AS id");
      const changesRes = this.db.exec("SELECT changes() AS count");
      
      const lastInsertRowid = lastInsertRowidRes[0]?.values[0][0];
      const changes = changesRes[0]?.values[0][0] as number;

      // Save database to disk on updates
      persistDatabase(this.db);

      return {
        lastInsertRowid: lastInsertRowid !== undefined ? String(lastInsertRowid) : 0,
        changes: changes !== undefined ? changes : 1
      };
    } catch (e) {
      console.error(`SQL stmt.run error on SQL: ${this.sql}`, e);
      throw e;
    }
  }

  free(): void {
    this.stmt.free();
  }
}

// Proxy wrapper around the database instance
class Database {
  initDatabase = initDatabase;
  getDb = getDb;
  isInitialized = isInitialized;
  flushPersistence = flushPersistence;
  closeDatabaseSafely = closeDatabaseSafely;
  schedulePersistence = schedulePersistence;

  prepare(sql: string): StatementWrapper {
    if (!rawDb) {
      throw new Error("Database not initialized. Call initDatabase() first.");
    }
    try {
      return new StatementWrapper(rawDb.prepare(sql), sql, rawDb);
    } catch (e) {
      console.error(`SQL prepare error: ${sql}`, e);
      throw e;
    }
  }

  run(sql: string, params?: any[]): void {
    if (!rawDb) throw new Error("Database not initialized");
    checkTransaction(sql);
    rawDb.run(sql, params);
  }

  exec(sql: string, params?: any[]): any {
    if (!rawDb) throw new Error("Database not initialized");
    checkTransaction(sql);
    return rawDb.exec(sql, params);
  }
}

/**
 * resetForTesting — FOR TEST USE ONLY.
 *
 * Closes the current database, clears the singleton, and re-initializes
 * a fresh in-memory database at a caller-supplied temp path (or a new
 * in-memory-only instance when no path is given).
 *
 * This must be called in `before()` hooks so every test suite starts from
 * a clean, isolated state without touching production data.
 */
export async function resetForTesting(
  tempDbPath?: string,
  options: { preserveExisting?: boolean } = {},
): Promise<void> {
  // Flush and close the current instance
  if (rawDb) {
    try {
      rawDb.close();
    } catch { /* ignore */ }
    rawDb = null;
  }
  initialized = false;
  dbPath = '';

  // Clear any pending persistence timers
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  pendingPersistPromise = null;
  resolvePendingPersist = null;
  rejectPendingPersist = null;
  inTransaction = false;

  // Initialize fresh
  if (tempDbPath) {
    dbPath = tempDbPath;
  } else {
    dbPath = ':memory:';
  }
  await initDatabaseAtPath(tempDbPath ?? ':memory:', options);
}

/** Apply all DDL and seed defaults to the already-open rawDb. */
function applySchema(): void {
  // Enable foreign keys (disabled for in-memory test databases)
  const isMem = dbPath === ':memory:';
  if (!isMem) {
    rawDb!.run('PRAGMA foreign_keys = ON');
  }

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      dateAdded TEXT DEFAULT (datetime('now')),
      lastScan TEXT,
      engine TEXT,
      executablePath TEXT,
      coverPath TEXT,
      iconPath TEXT,
      saveLocations TEXT,
      notes TEXT,
      metadataId TEXT,
      fingerprint TEXT,
      needsRescan INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const gamesColumns = rawDb!.exec('PRAGMA table_info(games)')[0];
  const gamesColumnNames = new Set(
    (gamesColumns?.values ?? []).map((row: unknown[]) => String(row[1])),
  );
  const optionalGameColumns = [
    'executablePath TEXT',
    'coverPath TEXT',
    'iconPath TEXT',
    'saveLocations TEXT',
    'notes TEXT',
    'metadataId TEXT',
    'launcher TEXT',
  ];
  for (const column of optionalGameColumns) {
    const columnName = column.split(' ')[0];
    if (!gamesColumnNames.has(columnName)) {
      rawDb!.run(`ALTER TABLE games ADD COLUMN ${column}`);
    }
  }

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      fileCount INTEGER DEFAULT 0,
      totalSize INTEGER DEFAULT 0,
      engineDetected TEXT,
      status TEXT DEFAULT 'completed',
      details TEXT,
      FOREIGN KEY (gameId) REFERENCES games(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      filePath TEXT NOT NULL,
      relativePath TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      fileType TEXT,
      engine TEXT,
      scanTimestamp TEXT,
      FOREIGN KEY (gameId) REFERENCES games(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      path TEXT NOT NULL,
      valueType TEXT NOT NULL,
      risk TEXT NOT NULL,
      requiresBackup INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0,
      description TEXT,
      fileHash TEXT,
      gameFingerprintHash TEXT,
      needsRescan INTEGER DEFAULT 0,
      isActive INTEGER DEFAULT 1,
      version INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gameId) REFERENCES games(id)
    )
  `);

  const columnsToAdd = [
    "schemaVersion TEXT DEFAULT '1.0.0'",
    'adapterId TEXT',
    'adapterVersion TEXT',
    'targetStrategy TEXT',
    'safeRelativePattern TEXT',
    'structuredPath TEXT',
    'inputType TEXT',
    'minimum REAL',
    'maximum REAL',
    'step REAL',
    'resetValue TEXT',
    'unit TEXT',
    'maxLength INTEGER',
    'pattern TEXT',
    'allowedValues TEXT',
    'preconditions TEXT',
    'validationRules TEXT',
    'fingerprintCompatibility TEXT'
  ];
  columnsToAdd.forEach(col => {
    try { rawDb!.run(`ALTER TABLE recipes ADD COLUMN ${col}`); } catch { /* already exists */ }
  });

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS recipe_items (
      id TEXT PRIMARY KEY,
      recipeId TEXT NOT NULL,
      resourceId TEXT NOT NULL,
      action TEXT NOT NULL,
      value TEXT,
      conditions TEXT,
      FOREIGN KEY (recipeId) REFERENCES recipes(id),
      FOREIGN KEY (resourceId) REFERENCES resources(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS discovered_values (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      resourceId TEXT NOT NULL,
      currentValue TEXT,
      discoveredValue TEXT,
      discoveredAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gameId) REFERENCES games(id),
      FOREIGN KEY (resourceId) REFERENCES resources(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      recipeId TEXT,
      targetFile TEXT NOT NULL,
      operation TEXT NOT NULL,
      path TEXT NOT NULL,
      oldValue TEXT,
      newValue TEXT,
      risk TEXT NOT NULL,
      preview TEXT NOT NULL,
      validationRule TEXT NOT NULL,
      requiresBackup INTEGER DEFAULT 0,
      dryRunPassed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gameId) REFERENCES games(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      recipeId TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      files TEXT,
      metadata TEXT,
      FOREIGN KEY (gameId) REFERENCES games(id),
      FOREIGN KEY (recipeId) REFERENCES recipes(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS rollback_manifests (
      id TEXT PRIMARY KEY,
      backupId TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (backupId) REFERENCES backups(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS journal_events (
      id TEXT PRIMARY KEY,
      gameId TEXT,
      recipeId TEXT,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      details TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gameId) REFERENCES games(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS ai_config (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      endpoint TEXT,
      model TEXT,
      timeout INTEGER DEFAULT 60000,
      isActive INTEGER DEFAULT 0
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      proposalId TEXT,
      recipeId TEXT,
      targetFile TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      backupId TEXT,
      failureReason TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gameId) REFERENCES games(id),
      FOREIGN KEY (proposalId) REFERENCES proposals(id),
      FOREIGN KEY (recipeId) REFERENCES recipes(id),
      FOREIGN KEY (backupId) REFERENCES backups(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS save_locations (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      canonicalPath TEXT NOT NULL,
      locationType TEXT NOT NULL,
      discoverySource TEXT NOT NULL,
      confidence REAL DEFAULT 0,
      approvalState TEXT DEFAULT 'Awaiting Approval',
      lastScanned TEXT,
      existsState INTEGER DEFAULT 1,
      writableState INTEGER DEFAULT 1,
      parserCompatibilitySummary TEXT,
      latestSavePath TEXT,
      detectionEvidence TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gameId) REFERENCES games(id),
      UNIQUE(gameId, canonicalPath)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS discovery_sessions (
      id TEXT PRIMARY KEY,
      gameId TEXT NOT NULL,
      fileAPath TEXT NOT NULL,
      fileBPath TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gameId) REFERENCES games(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS discovery_candidates (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      path TEXT NOT NULL,
      oldValue TEXT,
      newValue TEXT,
      valueType TEXT NOT NULL,
      confidence REAL DEFAULT 0,
      risk TEXT NOT NULL,
      noiseClassification TEXT,
      suggestedCategory TEXT,
      suggestedName TEXT,
      evidence TEXT,
      explanation TEXT,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (sessionId) REFERENCES discovery_sessions(id)
    )
  `);

  // Compatibility profiles (Phase 1 of Trainer UX)
  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS compatibility_profiles (
      id TEXT PRIMARY KEY,
      schemaVersion TEXT DEFAULT '1.0.0',
      gameId TEXT NOT NULL,
      gameName TEXT NOT NULL,
      store TEXT DEFAULT 'Unknown',
      storeAppId TEXT,
      executableNames TEXT,
      executableHash TEXT,
      engine TEXT DEFAULT 'Unknown',
      publisherHints TEXT,
      developerHints TEXT,
      saveLocationPatterns TEXT,
      configLocationPatterns TEXT,
      supportedAdapters TEXT,
      gameVersion TEXT,
      saveFormatVersion TEXT,
      fingerprint TEXT,
      validationStatus TEXT DEFAULT 'UNSUPPORTED',
      limitations TEXT,
      hasCloudSync INTEGER DEFAULT 0,
      cloudSyncWarning TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      lastValidatedAt TEXT,
      FOREIGN KEY (gameId) REFERENCES games(id),
      UNIQUE(gameId)
    )
  `);

  const compatibilityProfileColumnsToAdd = [
    'sourceUrls TEXT',
    'sourceConfidence TEXT',
    'sourceNotes TEXT',
    'sourceCheckedAt TEXT'
  ];
  compatibilityProfileColumnsToAdd.forEach(col => {
    try { rawDb!.run(`ALTER TABLE compatibility_profiles ADD COLUMN ${col}`); } catch { /* already exists */ }
  });

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS profile_validations (
      id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      status TEXT NOT NULL,
      checkedAt TEXT DEFAULT (datetime('now')),
      passed INTEGER DEFAULT 0,
      evidence TEXT,
      fingerprint TEXT,
      FOREIGN KEY (profileId) REFERENCES compatibility_profiles(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS trainer_catalog_games (
      catalogGameId TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      steamAppId INTEGER,
      executablesJson TEXT NOT NULL,
      categoriesJson TEXT NOT NULL,
      headerUrl TEXT,
      coverUrl TEXT,
      iconUrl TEXT,
      verificationStatus TEXT NOT NULL,
      sourcesJson TEXT NOT NULL,
      hasModPack INTEGER DEFAULT 0,
      modPackId TEXT,
      cheatCount INTEGER DEFAULT 0,
      searchableText TEXT NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS trainer_mod_packs (
      packId TEXT PRIMARY KEY,
      catalogGameId TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      verificationStatus TEXT NOT NULL,
      sourceProvider TEXT NOT NULL,
      syncedAt TEXT NOT NULL,
      cert_level TEXT NOT NULL DEFAULT 'L3_Certified',
      updated_at INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  const trainerModPackColumns = rawDb!.exec('PRAGMA table_info(trainer_mod_packs)')[0];
  const trainerModPackColumnNames = new Set(
    (trainerModPackColumns?.values ?? []).map((row: unknown[]) => String(row[1])),
  );
  if (!trainerModPackColumnNames.has('cert_level')) {
    rawDb!.run(
      "ALTER TABLE trainer_mod_packs ADD COLUMN cert_level TEXT NOT NULL DEFAULT 'L3_Certified'",
    );
    rawDb!.run(
      `UPDATE trainer_mod_packs
          SET cert_level = CASE
            WHEN sourceProvider = 'bundled' THEN 'L3_Certified'
            ELSE 'L0_Community'
          END`,
    );
  }
  if (!trainerModPackColumnNames.has('updated_at')) {
    rawDb!.run(
      'ALTER TABLE trainer_mod_packs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0',
    );
  }

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS trainer_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      importedCount INTEGER DEFAULT 0,
      syncedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_trainer_catalog_search ON trainer_catalog_games(searchableText)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_trainer_mod_packs_game ON trainer_mod_packs(catalogGameId)');

  // Manual review queue for catalog identity collisions/ambiguity (Phase 1.7).
  // id is a deterministic collision fingerprint so re-syncing an unresolved
  // pair reuses the same row instead of creating duplicate review items.
  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS catalog_identity_review (
      id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      leftRecordJson TEXT NOT NULL,
      rightRecordJson TEXT NOT NULL,
      resolution TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      resolvedAt TEXT
    )
  `);
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_catalog_identity_review_status ON catalog_identity_review(status, createdAt)');

  // Persisted cheat toggle state (Multi-Game Live Trainer) — remembers which cheats were
  // enabled and their confirmed address so a Solith restart (not a game restart) can
  // re-arm them automatically instead of forcing the user to redo discovery from scratch.
  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS cheat_toggle_state (
      gameId TEXT NOT NULL,
      cheatId TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      confirmedAddress TEXT,
      dataType TEXT,
      updatedAt TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (gameId, cheatId)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS pilot_runs (
      id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      gameId TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      evidenceTier TEXT NOT NULL,
      workspacePath TEXT,
      originalHashBefore TEXT,
      originalHashAfter TEXT,
      status TEXT NOT NULL,
      result TEXT,
      failureReason TEXT,
      FOREIGN KEY (profileId) REFERENCES compatibility_profiles(id),
      FOREIGN KEY (gameId) REFERENCES games(id)
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS definition_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalogGameId TEXT NOT NULL,
      featureId TEXT NOT NULL,
      executableHashPrefix TEXT,
      rating INTEGER NOT NULL,
      note TEXT,
      recordedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS definition_update_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalogGameId TEXT NOT NULL,
      reason TEXT NOT NULL,
      previousVerificationStatus TEXT,
      queuedAt TEXT DEFAULT (datetime('now')),
      resolvedAt TEXT,
      resolvedBy TEXT
    )
  `);

  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_definition_feedback_game ON definition_feedback(catalogGameId, featureId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_definition_update_queue_game ON definition_update_queue(catalogGameId)');

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS installed_games (
      id TEXT PRIMARY KEY,
      catalog_game_id TEXT,
      platform TEXT NOT NULL,
      install_path TEXT NOT NULL,
      executable_path TEXT,
      display_name TEXT,
      steam_app_id INTEGER,
      detected_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(platform, install_path)
    )
  `);
  migrateInstalledGameIdentity();
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_installed_games_catalog ON installed_games(catalog_game_id)');

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS trainer_health (
      catalog_game_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      stale_reason TEXT,
      executable_hash TEXT,
      checked_at TEXT NOT NULL
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS catalog_demand (
      catalog_game_id TEXT PRIMARY KEY,
      notify_count INTEGER DEFAULT 0,
      verification_requests INTEGER DEFAULT 0,
      last_requested_at TEXT NOT NULL
    )
  `);

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS canonical_games (
      id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      normalizedTitle TEXT NOT NULL,
      aliasesJson TEXT NOT NULL DEFAULT '[]',
      developer TEXT,
      publisher TEXT,
      releaseDate TEXT,
      genresJson TEXT NOT NULL DEFAULT '[]',
      playModesJson TEXT NOT NULL DEFAULT '[]',
      eligibility TEXT NOT NULL DEFAULT 'listed',
      supportState TEXT NOT NULL DEFAULT 'unknown',
      artworkIdentityJson TEXT,
      popularityMetadataJson TEXT,
      catalogGameId TEXT,
      identityStatus TEXT NOT NULL DEFAULT 'backfilled',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_canonical_games_catalog ON canonical_games(catalogGameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_canonical_games_normalized ON canonical_games(normalizedTitle)');

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS game_installations (
      id TEXT PRIMARY KEY,
      canonicalGameId TEXT NOT NULL,
      launcher TEXT NOT NULL,
      launcherGameId TEXT,
      installPath TEXT,
      executablePath TEXT,
      processNamesJson TEXT,
      edition TEXT,
      buildVersion TEXT,
      launchUri TEXT,
      trainerProfileCompatible INTEGER,
      installIdentity TEXT NOT NULL,
      sourceInstalledGameId TEXT,
      detectedAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      FOREIGN KEY (canonicalGameId) REFERENCES canonical_games(id)
    )
  `);
  rawDb!.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_game_installations_identity ON game_installations(installIdentity)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_game_installations_canonical ON game_installations(canonicalGameId)');

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS canonical_identity_review (
      id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      evidenceJson TEXT NOT NULL,
      resolution TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      resolvedAt TEXT
    )
  `);
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_canonical_identity_review_status ON canonical_identity_review(status, createdAt)');

  rawDb!.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')),
      read INTEGER DEFAULT 0,
      actionType TEXT,
      actionView TEXT
    )
  `);

  // Indexes
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_games_path ON games(path)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_scans_gameId ON scans(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_compatibility_profiles_gameId ON compatibility_profiles(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_profile_validations_profileId ON profile_validations(profileId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_pilot_runs_gameId ON pilot_runs(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_resources_gameId ON resources(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_resources_fileType ON resources(fileType)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_discovered_values_gameId ON discovered_values(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_proposals_gameId ON proposals(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_recipes_gameId ON recipes(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_backups_gameId ON backups(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_backups_timestamp ON backups(timestamp)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_journal_events_gameId ON journal_events(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_journal_events_timestamp ON journal_events(timestamp)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_journal_events_type ON journal_events(type)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_operations_gameId ON operations(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_save_locations_gameId ON save_locations(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_discovery_sessions_gameId ON discovery_sessions(gameId)');
  rawDb!.run('CREATE INDEX IF NOT EXISTS idx_discovery_candidates_sessionId ON discovery_candidates(sessionId)');

  // Seed default settings
  const defaultSettings = [
    { key: 'onboardingCompleted', value: 'false' },
    { key: 'aiProvider', value: 'None' },
    { key: 'aiEndpoint', value: '' },
    { key: 'aiModel', value: '' },
    { key: 'scanSizeLimitMB', value: '100' },
    { key: 'backupMode', value: 'per-game' },
    { key: 'backupLocation', value: '' },
    { key: 'backupRetentionCount', value: '10' },
    { key: 'theme', value: 'dark' },
    { key: 'safetyAcknowledged', value: 'false' },
    { key: 'externalSaveScanEnabled', value: 'false' },
    { key: 'v2LiveModeEnabled', value: 'true' },
    { key: 'v2HotkeysEnabled', value: 'true' },
    { key: 'v2OverlayEnabled', value: 'true' },
    { key: 'v2FreeformMemoryEnabled', value: 'true' },
    { key: 'v2RemoteCatalogSyncEnabled', value: 'true' },
    { key: 'trainerRemoteSyncCompleted', value: 'false' },
    { key: 'communitySyncEnabled', value: 'false' },
    { key: 'trainerCapabilitiesUnlocked', value: 'false' },
    { key: 'installDiscoveryEnabled', value: 'true' },
    { key: 'installDiscoveryLastScan', value: '' }
  ];
  defaultSettings.forEach(s => {
    rawDb!.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
  });

  const defaultAIConfig = [
    { id: 'Ollama', provider: 'Ollama', endpoint: '', model: '', timeout: 60000 },
    { id: 'LM Studio', provider: 'LM Studio', endpoint: '', model: '', timeout: 60000 }
  ];
  defaultAIConfig.forEach(c => {
    rawDb!.run(
      'INSERT OR IGNORE INTO ai_config (id, provider, endpoint, model, timeout) VALUES (?, ?, ?, ?, ?)',
      [c.id, c.provider, c.endpoint, c.model, c.timeout]
    );
  });
}

async function initDatabaseAtPath(
  targetPath: string,
  options: { preserveExisting?: boolean } = {},
): Promise<void> {
  const SQL = await initSqlJs();

  if (targetPath !== ':memory:' && targetPath !== '') {
    dbPath = targetPath;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(targetPath) && !options.preserveExisting) {
      fs.unlinkSync(targetPath);
    }
  }

  if (targetPath !== ':memory:' && targetPath !== '' && fs.existsSync(targetPath)) {
    const fileBuffer = fs.readFileSync(targetPath);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  // Apply schema to the fresh database
  applySchema();

  initialized = true;
}

export async function initDatabase() {
  if (initialized) return;

  const paths = await getAppPaths();
  dbPath = paths.databasePath;

  const SQL = await initSqlJs();

  // Ensure the data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create new database or load existing
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  // Wrap rawDb's run to track transactions and trigger persistence
  const originalRun = rawDb.run.bind(rawDb);
  rawDb.run = (sql: string, params?: any[]) => {
    checkTransaction(sql);
    const res = originalRun(sql, params);
    persistDatabase(rawDb);
    return res;
  };

  const originalExec = rawDb.exec.bind(rawDb);
  rawDb.exec = (sql: string, params?: any[]) => {
    checkTransaction(sql);
    const res = originalExec(sql, params);
    persistDatabase(rawDb);
    return res;
  };

  // Apply schema (DDL + seed data)
  applySchema();

  // Save initial database state
  persistDatabase(rawDb, true);

  initialized = true;
}

export function getDb() {
  return rawDb;
}

export function isInitialized() {
  return initialized;
}

const dbInstance = new Database();
export default dbInstance;
