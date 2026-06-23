import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { IGNORED_FOLDERS, SAVE_FOLDER_PATTERNS, SAVE_FILE_EXTENSIONS, ENGINE_INDICATORS } from '../../shared/constants';
import { parseSaveFile } from '../saves/index';

export interface ScanResult {
  files: string[];
  directories: string[];
  saveFiles: string[];
  configFiles: string[];
  dataFiles: string[];
}

export function scanDirectory(dirPath: string): ScanResult {
  try {
    const files: string[] = [];
    const directories: string[] = [];
    const saveFiles: string[] = [];
    const configFiles: string[] = [];
    const dataFiles: string[] = [];

    if (!fs.existsSync(dirPath)) {
      return { files: [], directories: [], saveFiles: [], configFiles: [], dataFiles: [] };
    }

    function traverse(currentPath: string, depth: number = 0): void {
      if (depth > 10) return; // Prevent infinite recursion
      
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        entries.forEach((entry) => {
          const fullPath = path.join(currentPath, entry.name);
          const entryStat = fs.statSync(fullPath);
          
          if (entryStat.isDirectory()) {
            if (IGNORED_FOLDERS.some(ignored => entry.name.toLowerCase() === ignored.toLowerCase())) {
              return;
            }
            
            directories.push(entry.name);
            traverse(fullPath, depth + 1);
          } else {
            files.push(entry.name);
            
            const lowerName = entry.name.toLowerCase();
            
            if (SAVE_FILE_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
              saveFiles.push(entry.name);
            } else if (entry.name.endsWith('.ini') || entry.name.endsWith('.cfg') || 
                       entry.name.endsWith('.conf')) {
              configFiles.push(entry.name);
            } else if (entry.name.endsWith('.json') || entry.name.endsWith('.xml') ||
                       entry.name.endsWith('.csv') || entry.name.endsWith('.tsv') || 
                       entry.name.endsWith('.txt')) {
              dataFiles.push(entry.name);
            }
          }
        });
      } catch (e) {
        // Skip inaccessible directories
      }
    }

    traverse(dirPath);

    return { files, directories, saveFiles, configFiles, dataFiles };
  } catch (error) {
    console.error('Scan error:', error);
    return { files: [], directories: [], saveFiles: [], configFiles: [], dataFiles: [] };
  }
}

export function detectEngine(gamePath: string): string {
  try {
    const files = fs.readdirSync(gamePath);
    
    for (const [engine, indicators] of Object.entries(ENGINE_INDICATORS)) {
      for (const indicator of indicators) {
        if (files.some(f => f.toLowerCase().includes(indicator.toLowerCase()))) {
          return engine;
        }
      }
    }
    
    return 'Generic';
  } catch {
    return 'Generic';
  }
}

export function getGameFingerprint(gamePath: string): { fileCount: number; totalSize: number; keyFiles: string[] } {
  try {
    let fileCount = 0;
    let totalSize = 0;
    const keyFiles: string[] = [];

    function traverse(dir: string): void {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        entries.forEach((entry) => {
          const fullPath = path.join(dir, entry.name);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            traverse(fullPath);
          } else {
            fileCount++;
            totalSize += stat.size;
            
            const lowerName = entry.name.toLowerCase();
            if (lowerName.endsWith('.exe') || lowerName.endsWith('.dll') ||
                lowerName.endsWith('.dat') || lowerName.endsWith('.sav')) {
              keyFiles.push(entry.name);
            }
          }
        });
      } catch (e) {
        // Skip inaccessible directories
      }
    }

    traverse(gamePath);

    return { fileCount, totalSize, keyFiles };
  } catch (error) {
    console.error('Fingerprint error:', error);
    return { fileCount: 0, totalSize: 0, keyFiles: [] };
  }
}

export function computeFileHash(filePath: string): string {
  try {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(filePath);
    return hash.update(data).digest('hex');
  } catch {
    return '';
  }
}

export function findSaveFiles(gamePath: string, externalScanEnabled: boolean = false): string[] {
  const saveFolders = ['saves', 'save', 'savegame', 'savegames', 'profiles', 'profile', 
                       'user', 'users', 'slots', 'autosave', 'checkpoints', 'persistent', 'savedata', 'data', 'config'];
  
  const saveFiles: string[] = [];
  const scannedDirs = new Set<string>();
  
  function traverse(dir: string): void {
    const resolvedPath = path.resolve(dir);
    if (scannedDirs.has(resolvedPath)) return;
    scannedDirs.add(resolvedPath);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      entries.forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const isSaveDir = saveFolders.some(folder => entry.name.toLowerCase() === folder.toLowerCase());
          if (isSaveDir || dir === gamePath) {
            traverse(fullPath);
          }
        } else {
          const lowerName = entry.name.toLowerCase();
          if (SAVE_FILE_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
            saveFiles.push(fullPath);
          }
        }
      });
    } catch (e) {
      // Skip inaccessible directories
    }
  }
  
  traverse(gamePath);
  
  // Only check external folders if explicitly approved/enabled by the user
  if (externalScanEnabled) {
    const userProfile = process.env.USERPROFILE || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    
    const commonSavePaths = [
      path.join(userProfile, 'Saved Games'),
      path.join(userProfile, 'Documents', 'My Games'),
      path.join(localAppData, 'Saved Games'),
      path.join(localAppData),
      path.join(appData),
      path.join(userProfile, 'Documents')
    ];
    
    // Add Steam userdata if it exists
    const steamPaths = [
      'C:\\Program Files (x86)\\Steam\\userdata',
      'C:\\Program Files\\Steam\\userdata'
    ];
    steamPaths.forEach(sp => {
      if (fs.existsSync(sp)) {
        commonSavePaths.push(sp);
      }
    });

    commonSavePaths.forEach(savePath => {
      if (fs.existsSync(savePath)) {
        try {
          const entries = fs.readdirSync(savePath, { withFileTypes: true });
          entries.forEach((entry) => {
            const fullPath = path.join(savePath, entry.name);
            // Search for folders matching the game name or related terms
            const gameName = path.basename(gamePath).toLowerCase();
            if (entry.isDirectory() && (entry.name.toLowerCase().includes(gameName) || gameName.includes(entry.name.toLowerCase()))) {
              traverse(fullPath);
            }
          });
        } catch (e) {
          // Skip
        }
      }
    });
  }
  
  return saveFiles;
}

export function findLatestSave(saveFiles: string[]): string | null {
  if (saveFiles.length === 0) return null;
  
  let latestFile = null;
  let latestTime = 0;
  
  const excludePatterns = [
    '.tmp', '.bak', '.backup', 'backup-', 'lock', '.log',
    '.png', '.jpg', '.jpeg', '.bmp', '.dmp', '.mdmp', '.crsh',
    'metadata', '.cloud'
  ];
  
  saveFiles.forEach(filePath => {
    try {
      const lowerPath = filePath.toLowerCase();
      
      // Exclude specific patterns in file name or path
      if (excludePatterns.some(p => lowerPath.includes(p))) {
        return;
      }
      
      // Exclude directories containing backup or resourceforge
      if (lowerPath.includes('backup') || lowerPath.includes('resourceforge')) {
        return;
      }
      
      const stat = fs.statSync(filePath);
      
      // Exclude zero-byte files
      if (stat.size === 0) {
        return;
      }
      
      // Verify file is readable and parseable (not corrupted)
      const parsed = parseSaveFile(filePath);
      if (!parsed) {
        return;
      }
      
      if (stat.mtime.getTime() > latestTime) {
        latestTime = stat.mtime.getTime();
        latestFile = filePath;
      }
    } catch {
      // Skip inaccessible or corrupted files
    }
  });
  
  return latestFile;
}
