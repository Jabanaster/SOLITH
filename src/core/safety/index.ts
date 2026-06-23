import fs from 'fs';
import { SAFE_KEYWORDS, RISKY_KEYWORDS, BLOCKED_KEYWORDS } from '../../shared/constants';

export interface RiskAssessment {
  risk: 'Safe' | 'Caution' | 'Risky' | 'Blocked';
  reason: string;
  requiresBackup: boolean;
  requiresGameClosed: boolean;
}

export function assessRisk(path: string, value: string): RiskAssessment {
  const lowerPath = path.toLowerCase();
  const lowerValue = value.toLowerCase();
  
  let risk: 'Safe' | 'Caution' | 'Risky' | 'Blocked' = 'Safe';
  let reason = 'No risky patterns detected';
  let safeCount = 0;
  let riskyCount = 0;
  
  // Check for blocked keywords (highest priority)
  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerPath.includes(keyword) || lowerValue.includes(keyword)) {
      risk = 'Blocked';
      reason = `Contains blocked keyword: ${keyword}`;
      break;
    }
  }
  
  if (risk !== 'Blocked') {
    // Check for risky keywords
    for (const keyword of RISKY_KEYWORDS) {
      if (lowerPath.includes(keyword) || lowerValue.includes(keyword)) {
        riskyCount++;
      }
    }
    
    if (riskyCount >= 2) {
      risk = 'Risky';
      reason = `Contains ${riskyCount} risky patterns`;
    } else if (riskyCount === 1) {
      risk = 'Caution';
      reason = 'Contains 1 risky pattern';
    }
    
    // Check for safe keywords (boost confidence)
    for (const keyword of SAFE_KEYWORDS) {
      if (lowerPath.includes(keyword) || lowerValue.includes(keyword)) {
        safeCount++;
      }
    }
    
    if (safeCount >= 2 && risk === 'Safe') {
      reason = `Contains ${safeCount} safe gameplay patterns`;
    } else if (safeCount >= 1 && risk === 'Safe') {
      reason = 'Contains safe gameplay patterns';
    }
  }
  
  return {
    risk,
    reason,
    requiresBackup: risk !== 'Safe',
    requiresGameClosed: risk === 'Risky' || risk === 'Blocked'
  };
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

export function isDangerousPath(path: string): boolean {
  const dangerousPatterns = [
    'system32',
    'windows\\system',
    'program files\\common files',
    'appdata\\local\\microsoft\\windows\\recent',
    'temp\\microsoft\\windows\\temporary internet'
  ];
  
  return dangerousPatterns.some(pattern => path.toLowerCase().includes(pattern.toLowerCase()));
}

export function classifyFile(filePath: string, extension: string): { type: string; risk: string } {
  const lowerExt = extension.toLowerCase();
  
  // Blocked file types
  if (lowerExt.endsWith('.exe') || lowerExt.endsWith('.dll') || 
      lowerExt.endsWith('.sys') || lowerExt.endsWith('.drv')) {
    return { type: 'executable', risk: 'BLOCKED' };
  }
  
  // Safe file types
  if (lowerExt.endsWith('.json') || lowerExt.endsWith('.ini') || 
      lowerExt.endsWith('.cfg') || lowerExt.endsWith('.xml') ||
      lowerExt.endsWith('.csv') || lowerExt.endsWith('.txt')) {
    return { type: 'data', risk: 'LOW' };
  }
  
  // Config files
  if (lowerExt.endsWith('.ini') || lowerExt.endsWith('.cfg') || 
      lowerExt.endsWith('.conf')) {
    return { type: 'config', risk: 'LOW' };
  }
  
  // Save files
  if (lowerExt.endsWith('.sav') || lowerExt.endsWith('.save') ||
      lowerExt.endsWith('.slk') || lowerExt.endsWith('.dat')) {
    return { type: 'save', risk: 'LOW' };
  }
  
  // Medium risk
  if (lowerExt.endsWith('.lua') || lowerExt.endsWith('.py') ||
      lowerExt.endsWith('.js') || lowerExt.endsWith('.c') ||
      lowerExt.endsWith('.cpp')) {
    return { type: 'script', risk: 'MEDIUM' };
  }
  
  // Unknown - assume safe but flag for review
  return { type: 'unknown', risk: 'LOW' };
}

export function isFileLocked(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const fd = fs.openSync(filePath, 'r');
      fs.closeSync(fd);
      resolve(false);
    } catch (error) {
      resolve(true);
    }
  });
}

export function isFileWritable(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const stat = fs.statSync(filePath);
      const isWritable = (stat.mode & 0o200) !== 0; // Write permission
      resolve(isWritable);
    } catch (error) {
      resolve(false);
    }
  });
}
