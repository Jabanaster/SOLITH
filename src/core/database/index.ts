import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAppPaths } from '../../shared/app-paths.js';

let dbPath = '';

let rawDb: any = null;
let initialized = false;

let persistTimeout: NodeJS.Timeout | null = null;
let pendingPersistPromise: Promise<void> | null = null;
let resolvePendingPersist: (() => void) | null = null;
let rejectPendingPersist: ((err: Error) => void) | null = null;
let inTransaction = false;

function checkTransaction(sql: string) {
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('BEGIN') || upper.startsWith('SAVEPOINT')) {
    inTransaction = true;
  } else if (upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK') || upper.startsWith('RELEASE')) {
    inTransaction = false;
  }
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
      const data = sqlDb.export();
      const buffer = Buffer.from(data);
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(dbPath, buffer);
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
      const data = rawDb.export();
      const buffer = Buffer.from(data);
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(dbPath, buffer);
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
        const data = rawDb.export();
        const buffer = Buffer.from(data);
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dbPath, buffer);
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

// Wrapper for sql.js Statement to mimic better-sqlite3 Statement
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
export async function resetForTesting(tempDbPath?: string): Promise<void> {
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
  await initDatabaseAtPath(tempDbPath ?? ':memory:');
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
      fingerprint TEXT,
      needsRescan INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

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

  // Persisted cheat toggle state (Multi-Game Live Trainer) — remembers which cheats were
  // enabled and their confirmed address so a ResourceForge restart (not a game restart) can
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
    { key: 'v2LiveModeEnabled', value: 'false' },
    { key: 'v2HotkeysEnabled', value: 'false' },
    { key: 'v2OverlayEnabled', value: 'false' }
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

async function initDatabaseAtPath(targetPath: string): Promise<void> {
  const SQL = await initSqlJs();

  rawDb = new SQL.Database();

  if (targetPath !== ':memory:' && targetPath !== '') {
    dbPath = targetPath;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Tests always start with a fresh file
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
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
