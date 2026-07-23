import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../database';
import { Game, GameFingerprint } from '../../shared/types';
import { scanDirectory, detectEngine, getGameFingerprint as computeFingerprint } from '../scanner';
import { classifyFile } from '../safety';
import { logEvent } from '../journal';
import { generateId } from '../../shared/ids';
import { getScanSizeLimitMB } from '../settings';

const DEMO_GAME_ID = 'demo-game-quest-id-000000000000';
const cancelledScans = new Set<string>();

export function cancelScan(scanId: string): void {
  cancelledScans.add(scanId);
}

export function ensureDemoGame(): void {
  try {
    // Check if user intentionally deleted the demo game
    const isDeletedRow = db.prepare("SELECT value FROM settings WHERE key = 'demoGameDeleted'").get();
    if (isDeletedRow && isDeletedRow.value === 'true') {
      return;
    }
    
    // Check if demo game already exists
    const existing = db.prepare("SELECT id FROM games WHERE id = ?").get(DEMO_GAME_ID);
    if (existing) {
      return;
    }
    
    const demoPath = path.resolve(process.cwd(), './demo-game');
    if (!fs.existsSync(demoPath)) {
      return; // Only seed if folder exists
    }
    
    db.prepare(`
      INSERT OR IGNORE INTO games (id, name, path, engine, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      DEMO_GAME_ID,
      'Demo RPG Quest',
      demoPath,
      'Generic',
      JSON.stringify({
        fileCount: 0,
        totalSize: 0,
        keyHashes: [],
        mainExecutable: undefined,
        lastScan: new Date().toISOString()
      })
    );
    
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demoGameAdded', 'true')").run();
  } catch (error) {
    console.error('Failed to ensure demo game seeding:', error);
  }
}

export function getGames(): Game[] {
  ensureDemoGame(); // Ensure demo game is safely seeded before loading games
  
  const stmt = db.prepare(`
    SELECT g.*, json_extract(g.fingerprint, '$.fileCount') as fileCount,
           json_extract(g.fingerprint, '$.totalSize') as totalSize,
           json_extract(g.fingerprint, '$.engine') as engine
    FROM games g
    ORDER BY g.dateAdded DESC
  `);
  
  return stmt.all().map(row => ({
    ...row,
    dateAdded: row.dateAdded.toISOString(),
    lastScan: row.lastScan ? row.lastScan.toISOString() : undefined,
    fingerprint: row.fingerprint ? JSON.parse(row.fingerprint) : undefined,
    needsRescan: row.needsRescan === 1
  }));
}

export function getGameById(gameId: string): Game | null {
  const stmt = db.prepare(`
    SELECT g.*, json_extract(g.fingerprint, '$.fileCount') as fileCount,
           json_extract(g.fingerprint, '$.totalSize') as totalSize,
           json_extract(g.fingerprint, '$.engine') as engine
    FROM games g
    WHERE g.id = ?
  `);
  
  const row = stmt.get(gameId);
  if (!row) return null;
  
  return {
    ...row,
    dateAdded: row.dateAdded.toISOString(),
    lastScan: row.lastScan ? row.lastScan.toISOString() : undefined,
    fingerprint: row.fingerprint ? JSON.parse(row.fingerprint) : undefined,
    needsRescan: row.needsRescan === 1
  };
}

export function addGame(game: Omit<Game, 'id' | 'dateAdded'>): Game {
  // Check if game already exists
  const existing = db.prepare('SELECT id FROM games WHERE path = ?').get(game.path);
  if (existing) {
    return getGameById(existing.id) as Game;
  }
  
  const gameId = generateId();
  const stmt = db.prepare(`
    INSERT INTO games (id, name, path, engine, fingerprint)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(gameId, game.name, game.path, game.engine || 'Generic', JSON.stringify({
    fileCount: 0,
    totalSize: 0,
    keyHashes: [],
    mainExecutable: undefined,
    lastScan: new Date().toISOString()
  }));
  
  return {
    ...game,
    id: gameId,
    dateAdded: new Date().toISOString()
  };
}

export function updateGame(gameId: string, updates: Partial<Omit<Game, 'id' | 'dateAdded'>>): Game | null {
  const current = getGameById(gameId);
  if (!current) return null;

  const name = updates.name !== undefined ? updates.name : current.name;
  const pathVal = updates.path !== undefined ? updates.path : current.path;
  const engine = updates.engine !== undefined ? updates.engine : current.engine;
  const fingerprint = updates.fingerprint !== undefined ? updates.fingerprint : current.fingerprint;
  const lastScan = updates.lastScan !== undefined ? updates.lastScan : current.lastScan;
  const needsRescan = updates.needsRescan !== undefined ? updates.needsRescan : current.needsRescan;

  const stmt = db.prepare(`
    UPDATE games SET
      name = ?, path = ?, engine = ?, fingerprint = ?,
      lastScan = ?, needsRescan = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  
  const result = stmt.run(
    name,
    pathVal,
    engine,
    fingerprint ? JSON.stringify(fingerprint) : null,
    lastScan,
    needsRescan ? 1 : 0,
    gameId
  );
  
  if (!result.changes) return null;
  
  return getGameById(gameId);
}

export function deleteGame(gameId: string): boolean {
  if (gameId === DEMO_GAME_ID) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demoGameDeleted', 'true')").run();
  }
  const stmt = db.prepare('DELETE FROM games WHERE id = ?');
  return stmt.run(gameId).changes !== 0;
}

export function scanGame(gameId: string): { success: boolean; result?: any; error?: string } {
  const game = getGameById(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }
  
  const scanId = generateId();
  const scanTimestamp = new Date().toISOString();
  const gamePath = game.path;
  
  // 1. Insert Scan Record as PENDING
  const insertScan = db.prepare(`
    INSERT INTO scans (id, gameId, timestamp, fileCount, totalSize, engineDetected, status, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertScan.run(
    scanId,
    gameId,
    scanTimestamp,
    0,
    0,
    'Generic',
    'PENDING',
    null
  );
  
  try {
    // Transition status to RUNNING
    db.prepare("UPDATE scans SET status = 'RUNNING' WHERE id = ?").run(scanId);
    
    // Scan directory
    const scanResult = scanDirectory(gamePath);
    
    // Detect engine
    const engine = detectEngine(gamePath);
    
    // Compute fingerprint
    const fingerprint = computeFingerprint(gamePath);
    
    // Get size limit in bytes
    const sizeLimitMB = getScanSizeLimitMB();
    const sizeLimitBytes = sizeLimitMB * 1024 * 1024;
    
    const appDataRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    const backupsDirs = new Set([
      path.join(appDataRoot, 'Solith', 'backups').toLowerCase(),
    ]);
    const installDir = path.resolve(process.cwd()).toLowerCase();

    // 2. Perform database insertions inside a safe transaction
    const rawDb = db.getDb();
    rawDb.run('BEGIN TRANSACTION');
    
    try {
      // Clear old resources for this game
      rawDb.run('DELETE FROM resources WHERE gameId = ?', [gameId]);
      
      const saveFolders = ['saves', 'save', 'savegame', 'savegames', 'profiles', 'profile', 
                           'user', 'users', 'slots', 'autosave', 'checkpoints', 'persistent', 'savedata', 'data', 'config'];
      
      const insertResource = db.prepare(`
        INSERT INTO resources (id, gameId, filePath, relativePath, size, fileType, engine, scanTimestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      function traverseAndSave(dir: string): void {
        // Cooperative cancellation check
        if (cancelledScans.has(scanId)) {
          throw new Error('Scan cancelled by user.');
        }
        
        try {
          const canonicalDir = path.resolve(dir).toLowerCase();
          // Skip internal app backups or installer files
          if (
            backupsDirs.has(canonicalDir) ||
            canonicalDir === installDir ||
            canonicalDir.includes('.solith')
          ) {
            return;
          }
          
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          entries.forEach(entry => {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const isSaveDir = saveFolders.some(folder => entry.name.toLowerCase() === folder.toLowerCase());
              if (isSaveDir || dir === gamePath) {
                traverseAndSave(fullPath);
              }
            } else {
              const relPath = path.relative(gamePath, fullPath);
              const stat = fs.statSync(fullPath);
              
              // Honor size limits
              if (stat.size > sizeLimitBytes) {
                return; // Skip files too large
              }
              
              const ext = path.extname(entry.name).toLowerCase();
              const classification = classifyFile(entry.name, ext);
              
              const isConfigOrSave = ['.json', '.xml', '.ini', '.cfg', '.conf', '.csv', '.tsv', '.txt', '.sav', '.dat'].includes(ext);
              if (isConfigOrSave) {
                const resId = generateId();
                rawDb.run(`
                  INSERT INTO resources (id, gameId, filePath, relativePath, size, fileType, engine, scanTimestamp)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                  resId,
                  gameId,
                  fullPath,
                  relPath,
                  stat.size,
                  classification.type,
                  engine,
                  scanTimestamp
                ]);
              }
            }
          });
        } catch (err) {
          console.error(`Skipping inaccessible folder during game scan: ${dir}`, err);
        }
      }
      
      traverseAndSave(gamePath);
      
      // Update scans to COMPLETED
      rawDb.run(`
        UPDATE scans 
        SET status = 'COMPLETED', fileCount = ?, totalSize = ?, engineDetected = ?
        WHERE id = ?
      `, [fingerprint.fileCount, fingerprint.totalSize, engine, scanId]);
      
      db.run('COMMIT');
    } catch (txError: any) {
      db.run('ROLLBACK');
      throw txError;
    }
    
    // Update game lastScan and engine details
    updateGame(gameId, {
      engine,
      fingerprint: {
        fileCount: fingerprint.fileCount,
        totalSize: fingerprint.totalSize,
        keyHashes: fingerprint.keyFiles,
        mainExecutable: undefined,
        lastScan: scanTimestamp
      },
      needsRescan: false
    });
    
    // Log scan event
    logScanEvent(gameId, scanResult, engine, fingerprint);
    
    return { success: true };
  } catch (error: any) {
    const isCancel = error?.message === 'Scan cancelled by user.';
    const finalStatus = isCancel ? 'CANCELLED' : 'FAILED';
    
    try {
      db.prepare('UPDATE scans SET status = ?, details = ? WHERE id = ?')
        .run(finalStatus, String(error), scanId);
    } catch (updateError) {
      console.error(`Failed to mark scan ${scanId} as ${finalStatus}:`, updateError);
    }
    
    return { success: false, error: String(error) };
  }
}

export function logScanEvent(gameId: string, scanResult: any, engine: string, fingerprint: any): void {
  logEvent({
    gameId,
    type: 'scan',
    description: `Scanned game files. Detected ${engine} engine.`,
    details: JSON.stringify({
      fileCount: fingerprint.fileCount,
      totalSize: fingerprint.totalSize,
      saveFilesCount: scanResult.saveFiles.length,
      configFilesCount: scanResult.configFiles.length,
      dataFilesCount: scanResult.dataFiles.length
    })
  });
}

export function isSystemPath(path: string): boolean {
  const systemPaths = [
    'c:\\',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\windows',
    'c:\\users\\',
    'c:\\programdata',
    'c:\\windows\\system32'
  ];
  
  return systemPaths.some(sysPath => path.toLowerCase().includes(sysPath.toLowerCase()));
}

export function isValidGamePath(path: string): boolean {
  // Check if it's a system path
  if (isSystemPath(path)) {
    return false;
  }
  
  // Check if it exists and is a directory
  try {
    const stat = fs.statSync(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function classifyGameFile(filePath: string, extension: string): { type: string; risk: string } {
  return classifyFile(filePath, extension);
}
