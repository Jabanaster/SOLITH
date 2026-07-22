import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveDiscoveryContext } from './discovery-context.js';
import { generateId } from '../../shared/ids';
import { SAVE_FILE_EXTENSIONS } from '../../shared/constants';
import db from '../database/index';

export interface DiscoveredSaveLocation {
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

// Bounded Windows save roots
export function getSaveRoots(): { path: string; type: string }[] {
  const userProfile = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming');
  
  const roots = [
    { path: path.join(userProfile, 'Documents'), type: 'DOCUMENTS' },
    { path: path.join(userProfile, 'Documents', 'My Games'), type: 'MY_GAMES' },
    { path: path.join(userProfile, 'Saved Games'), type: 'SAVED_GAMES' },
    { path: localAppData, type: 'APPDATA_LOCAL' },
    { path: path.join(path.dirname(localAppData), 'LocalLow'), type: 'APPDATA_LOCALLOW' },
    { path: appData, type: 'APPDATA_ROAMING' }
  ];

  // Steam userdata
  const steamPaths = [
    'C:\\Program Files (x86)\\Steam\\userdata',
    'C:\\Program Files\\Steam\\userdata'
  ];
  steamPaths.forEach(sp => {
    if (fs.existsSync(sp)) {
      roots.push({ path: sp, type: 'STEAM_USERDATA' });
    }
  });

  return roots.filter(r => fs.existsSync(r.path));
}

// Clean game name for matching
function cleanName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Scan Windows candidate directories to auto-discover game save folders.
 */
export async function discoverSaveLocations(gameId: string): Promise<DiscoveredSaveLocation[]> {
  const ctx = resolveDiscoveryContext(gameId);
  if (!ctx) return [];

  const discovered: DiscoveredSaveLocation[] = [];
  const roots = getSaveRoots();
  const gameNameClean = cleanName(ctx.displayName);
  const words = ctx.displayName.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Check game's own root as first location (GAME_ROOT / GAME_SUBDIRECTORY)
  try {
    if (ctx.installPath && fs.existsSync(ctx.installPath)) {
      const saveSubfolders = ['saves', 'save', 'savegame', 'savegames', 'savedata'];
      for (const folder of saveSubfolders) {
        const fullPath = path.join(ctx.installPath!, folder);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          const canonical = path.resolve(fullPath).toLowerCase();
          discovered.push({
            id: generateId(),
            gameId,
            canonicalPath: canonical,
            locationType: 'GAME_SUBDIRECTORY',
            discoverySource: 'AUTOMATIC',
            confidence: 90,
            approvalState: 'Awaiting Approval',
            existsState: 1,
            writableState: 1,
            detectionEvidence: `Found save subfolder '${folder}' inside game directory`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
  } catch (error) {
    console.error(`Failed to inspect install-path save folders for ${ctx.installPath}:`, error);
  }

  // Bounded scan under common windows directories
  for (const root of roots) {
    try {
      const entries = fs.readdirSync(root.path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const entryNameLower = entry.name.toLowerCase();
        const entryClean = cleanName(entry.name);
        
        let match = false;
        let evidence = '';
        let confidence = 0;

        if (entryClean === gameNameClean) {
          match = true;
          confidence = 95;
          evidence = `Folder name '${entry.name}' matches game name exactly`;
        } else if (entryClean.includes(gameNameClean) || gameNameClean.includes(entryClean)) {
          match = true;
          confidence = 80;
          evidence = `Folder name '${entry.name}' partially matches game name`;
        } else if (words.length > 0 && words.every(word => entryNameLower.includes(word))) {
          match = true;
          confidence = 75;
          evidence = `Folder name '${entry.name}' contains all major terms of game name`;
        }

        if (match) {
          const fullPath = path.join(root.path, entry.name);
          const canonical = path.resolve(fullPath).toLowerCase();

          // Check if there are actual save files inside
          let saveFilesCount = 0;
          try {
            const files = fs.readdirSync(fullPath);
            files.forEach(f => {
              const ext = path.extname(f).toLowerCase();
              if ((SAVE_FILE_EXTENSIONS as unknown as string[]).includes(ext) || ['.sav', '.save', '.dat', '.json'].includes(ext)) {
                saveFilesCount++;
              }
            });
          } catch (error) {
            console.error(`Failed to inspect save-like files under ${fullPath}:`, error);
          }

          if (saveFilesCount > 0) {
            confidence = Math.min(100, confidence + 10);
            evidence += ` and contains ${saveFilesCount} save-like files`;
          } else {
            confidence = Math.max(30, confidence - 20);
            evidence += ` but has no immediate save files`;
          }

          discovered.push({
            id: generateId(),
            gameId,
            canonicalPath: canonical,
            locationType: root.type,
            discoverySource: 'AUTOMATIC',
            confidence,
            approvalState: 'Awaiting Approval',
            existsState: 1,
            writableState: 1,
            detectionEvidence: evidence,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error(`Failed to scan save discovery root ${root.path}:`, error);
    }
  }

  // Deduplicate discovered folders based on canonicalPath
  const seen = new Set<string>();
  const uniqueDiscovered = discovered.filter(loc => {
    if (seen.has(loc.canonicalPath)) return false;
    seen.add(loc.canonicalPath);
    return true;
  });

  // Save discovered locations to database (INSERT OR IGNORE)
  for (const loc of uniqueDiscovered) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO save_locations (
          id, gameId, canonicalPath, locationType, discoverySource, confidence, approvalState,
          existsState, writableState, detectionEvidence, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        loc.id, loc.gameId, loc.canonicalPath, loc.locationType, loc.discoverySource,
        loc.confidence, loc.approvalState, loc.existsState, loc.writableState,
        loc.detectionEvidence, loc.createdAt, loc.updatedAt
      );
    } catch (e) {
      console.error('Failed to save discovered location:', e);
    }
  }

  return uniqueDiscovered;
}
