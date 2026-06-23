import fs from 'fs';
import path from 'path';
import db from '../database/index';
import { generateId } from '../../shared/ids';
import { getCanonicalPath, validatePathSafety } from '../safety/path-safety';
import { getGameById } from '../games/index';

export interface SaveLocation {
  id: string;
  gameId: string;
  canonicalPath: string;
  locationType: string;
  discoverySource: 'AUTOMATIC' | 'USER_SELECTED';
  confidence: number;
  approvalState: 'Suggested' | 'Awaiting Approval' | 'Approved' | 'Revoked' | 'Missing' | 'Unsafe' | 'Needs Review';
  lastScanned?: string;
  existsState: number;
  writableState: number;
  parserCompatibilitySummary?: string;
  latestSavePath?: string;
  detectionEvidence: string;
  createdAt: string;
  updatedAt: string;
}

export function getSaveLocations(gameId: string): SaveLocation[] {
  const stmt = db.prepare('SELECT * FROM save_locations WHERE gameId = ? ORDER BY confidence DESC');
  return stmt.all(gameId).map(row => ({
    ...row,
    existsState: Number(row.existsState),
    writableState: Number(row.writableState)
  }));
}

export function approveSaveLocation(locationId: string): boolean {
  // Re-verify exists and writable states before approving
  const loc = db.prepare('SELECT * FROM save_locations WHERE id = ?').get(locationId);
  if (!loc) return false;

  const canonical = getCanonicalPath(loc.canonicalPath);
  const safety = validatePathSafety(canonical);
  if (!safety.safe) {
    db.prepare("UPDATE save_locations SET approvalState = 'Unsafe', updatedAt = datetime('now') WHERE id = ?")
      .run(locationId);
    return false;
  }

  let exists = 0;
  let writable = 0;
  try {
    if (fs.existsSync(canonical)) {
      exists = 1;
      const stat = fs.statSync(canonical);
      // Check if directory is writable by attempting a temp write or checking modes
      writable = (stat.mode & 0o200) !== 0 ? 1 : 0;
    }
  } catch {}

  const stmt = db.prepare(`
    UPDATE save_locations
    SET approvalState = 'Approved', existsState = ?, writableState = ?, updatedAt = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(exists, writable, locationId).changes !== 0;
}

export function revokeSaveLocation(locationId: string): boolean {
  const stmt = db.prepare(`
    UPDATE save_locations
    SET approvalState = 'Revoked', updatedAt = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(locationId).changes !== 0;
}

export function addUserSelectedLocation(gameId: string, rawPath: string): { success: boolean; location?: SaveLocation; error?: string } {
  const game = getGameById(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  const canonical = getCanonicalPath(rawPath);
  const safety = validatePathSafety(canonical);
  if (!safety.safe) {
    return { success: false, error: `Path safety violation: ${safety.reason}` };
  }

  // Check if it already exists
  const existing = db.prepare('SELECT * FROM save_locations WHERE gameId = ? AND canonicalPath = ?').get(gameId, canonical);
  if (existing) {
    // If it exists, set to Approved
    approveSaveLocation(existing.id);
    return { success: true, location: db.prepare('SELECT * FROM save_locations WHERE id = ?').get(existing.id) };
  }

  let exists = 0;
  let writable = 0;
  try {
    if (fs.existsSync(canonical)) {
      exists = 1;
      const stat = fs.statSync(canonical);
      writable = (stat.mode & 0o200) !== 0 ? 1 : 0;
    }
  } catch {}

  const id = generateId();
  const loc: SaveLocation = {
    id,
    gameId,
    canonicalPath: canonical,
    locationType: 'USER_SELECTED',
    discoverySource: 'USER_SELECTED',
    confidence: 100,
    approvalState: 'Approved', // User selected paths are approved immediately
    existsState: exists,
    writableState: writable,
    detectionEvidence: 'Manually added by the user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    db.prepare(`
      INSERT INTO save_locations (
        id, gameId, canonicalPath, locationType, discoverySource, confidence, approvalState,
        existsState, writableState, detectionEvidence, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      loc.id, loc.gameId, loc.canonicalPath, loc.locationType, loc.discoverySource,
      loc.confidence, loc.approvalState, loc.existsState, loc.writableState,
      loc.detectionEvidence, loc.createdAt, loc.updatedAt
    );
    return { success: true, location: loc };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Re-validates path containment before every privileged action.
 * A path is approved if it resides inside game.path OR inside an Approved save_location.
 */
export function isPathApproved(filePath: string, gameId: string): boolean {
  try {
    const game = getGameById(gameId);
    if (!game) return false;

    const canonicalTarget = getCanonicalPath(filePath);
    
    // First, run standard path safety checks
    const safety = validatePathSafety(canonicalTarget);
    if (!safety.safe) return false;

    // Check 1: Contained inside game root directory
    const canonicalGamePath = getCanonicalPath(game.path);
    if (canonicalTarget.startsWith(canonicalGamePath + path.sep) || canonicalTarget === canonicalGamePath) {
      return true;
    }

    // Check 2: Contained inside any Approved save location for this game
    const approvedLocations = db.prepare(`
      SELECT canonicalPath FROM save_locations 
      WHERE gameId = ? AND approvalState = 'Approved'
    `).all(gameId);

    for (const loc of approvedLocations) {
      const canonicalLoc = getCanonicalPath(loc.canonicalPath);
      if (canonicalTarget.startsWith(canonicalLoc + path.sep) || canonicalTarget === canonicalLoc) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
