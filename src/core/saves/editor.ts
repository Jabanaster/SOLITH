import fs from 'fs';
import path from 'path';
import xml2js from 'xml2js';
import crypto from 'crypto';
import { extractSafeValues, parseSaveFile } from '../saves';
import { Backup, createBackup, restoreBackup } from '../backups';
import { createProposal } from '../proposals';
import { logEvent } from '../journal';
import { Proposal, JournalEvent, ParsedSave } from '../../shared/types';
import { RiskAssessment, assessRisk } from '../safety';
import { getGameById } from '../games';
import { createOperation, transitionOperation } from '../safety/operations';
import { atomicWrite } from '../safety/atomic-write';
import { getAdapterForFile } from '../adapters/index';
import { getRecipeById, validateRecipeSafety } from '../recipes';

export interface SaveEdit {
  path: string;
  oldValue: any;
  newValue: any;
  type: 'number' | 'string' | 'boolean';
}

export function detectSaveFiles(gameId: string): string[] {
  const game = getGameById(gameId);
  if (!game) return [];
  
  const saveFiles: string[] = [];
  
  function traverse(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      entries.forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          traverse(fullPath);
        } else {
          const lowerName = entry.name.toLowerCase();
          if (lowerName.endsWith('.json') || lowerName.endsWith('.xml') ||
              lowerName.endsWith('.ini') || lowerName.endsWith('.cfg') ||
              lowerName.endsWith('.sav') || lowerName.endsWith('.dat') ||
              lowerName.endsWith('.txt') || lowerName.endsWith('.csv') ||
              lowerName.endsWith('.tsv')) {
            saveFiles.push(fullPath);
          }
        }
      });
    } catch (e) {
      // Skip inaccessible directories
    }
  }
  
  traverse(game.path);
  return saveFiles;
}

export function parseSave(filePath: string): ParsedSave | null {
  return parseSaveFile(filePath);
}

export function extractValues(parsedSave: ParsedSave): { path: string; value: any; type: string; risk: string }[] {
  const values = extractSafeValues(parsedSave);
  return values.map(v => ({
    path: v.path,
    value: v.value,
    type: v.type,
    risk: v.risk
  }));
}

export function createProposalForEdit(
  gameId: string,
  filePath: string,
  pathStr: string,
  oldValue: any,
  newValue: any,
  recipeId?: string
): Proposal {
  const adapter = getAdapterForFile(filePath);
  if (!adapter) {
    throw new Error(`Unsupported file: no trainer adapter registered for "${path.basename(filePath)}"`);
  }
  if (adapter.id === 'binary-adapter') {
    throw new Error('Proposals cannot be created for binary targets (read-only).');
  }

  if (recipeId) {
    const recipe = getRecipeById(recipeId);
    if (!recipe) {
      throw new Error(`Recipe with ID "${recipeId}" not found.`);
    }
    const safety = validateRecipeSafety(recipe);
    if (!safety.valid) {
      throw new Error(`Recipe safety violation: ${safety.error}`);
    }
  }

  const risk = assessRisk(pathStr, String(newValue));
  
  const proposal: Omit<Proposal, 'id' | 'createdAt'> = {
    gameId,
    recipeId,
    targetFile: filePath,
    operation: 'set',
    path: pathStr,
    oldValue,
    newValue,
    risk: risk.risk,
    preview: `Change ${pathStr} from ${String(oldValue)} to ${String(newValue)}`,
    validationRule: 'exact_match',
    requiresBackup: risk.requiresBackup,
    dryRunPassed: false,
    status: 'pending'
  };
  
  return createProposal(proposal);
}

export async function dryRunProposal(proposal: Proposal): Promise<{ success: boolean; error?: string }> {
  try {
    if (proposal.recipeId) {
      const recipe = getRecipeById(proposal.recipeId);
      if (!recipe) {
        return { success: false, error: `Recipe with ID "${proposal.recipeId}" not found.` };
      }
      const safety = validateRecipeSafety(recipe);
      if (!safety.valid) {
        return { success: false, error: `Recipe safety violation: ${safety.error}` };
      }
    }

    const targetFile = proposal.targetFile;
    if (!fs.existsSync(targetFile)) {
      return { success: false, error: 'Target file does not exist' };
    }
    
    const stat = fs.statSync(targetFile);
    if (!stat.isFile()) {
      return { success: false, error: 'Target is not a file' };
    }

    const adapter = getAdapterForFile(targetFile);
    if (!adapter) {
      return { success: false, error: `No trainer adapter found for target file: ${path.basename(targetFile)}` };
    }

    const res = await adapter.dryRun(targetFile, proposal.path, proposal.oldValue);
    if (!res.success) {
      return { success: false, error: res.error || 'Dry run verification failed' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function applyProposal(proposal: Proposal): Promise<{ success: boolean; backup?: Backup; error?: string }> {
  const operationId = crypto.randomUUID();
  let backup: Backup | undefined;
  let opCreated = false;
  
  try {
    if (proposal.recipeId) {
      const recipe = getRecipeById(proposal.recipeId);
      if (!recipe) {
        throw new Error(`Recipe with ID "${proposal.recipeId}" not found.`);
      }
      const safety = validateRecipeSafety(recipe);
      if (!safety.valid) {
        throw new Error(`Recipe safety violation: ${safety.error}`);
      }
    }
    // 1. Create operation
    createOperation({
      id: operationId,
      gameId: proposal.gameId,
      proposalId: proposal.id,
      recipeId: proposal.recipeId || undefined,
      targetFile: proposal.targetFile,
      type: 'apply'
    });
    opCreated = true;
    
    // 2. Transition: DRAFT -> PROPOSED
    transitionOperation(operationId, 'PROPOSED');
    
    // 3. Dry run check
    const dryRunRes = await dryRunProposal(proposal);
    if (!dryRunRes.success) {
      transitionOperation(operationId, 'FAILED', dryRunRes.error || 'Dry run failed');
      return { success: false, error: dryRunRes.error || 'Dry run failed' };
    }
    
    // 4. Transition: PROPOSED -> DRY_RUN_PASSED
    transitionOperation(operationId, 'DRY_RUN_PASSED');
    
    // 5. Transition: DRY_RUN_PASSED -> AWAITING_APPROVAL
    transitionOperation(operationId, 'AWAITING_APPROVAL');
    
    // 6. Create backup
    const backupDir = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'ResourceForge', 'backups');
    backup = createBackup(proposal.gameId, proposal.targetFile, backupDir, proposal.recipeId || undefined, proposal.id, operationId);
    
    // Save backupId to operation
    const dbModule = await import('../database/index.js');
    dbModule.default.prepare('UPDATE operations SET backupId = ? WHERE id = ?').run(backup.id, operationId);
    
    // 7. Transition: AWAITING_APPROVAL -> BACKUP_CREATED
    transitionOperation(operationId, 'BACKUP_CREATED');
    
    // 8. Generate modified content in-memory via Adapter
    const adapter = getAdapterForFile(proposal.targetFile);
    if (!adapter) {
      throw new Error(`Unsupported file: no trainer adapter registered for "${path.basename(proposal.targetFile)}"`);
    }
    const buildRes = await adapter.buildOutput(proposal.targetFile, proposal.path, proposal.newValue);
    if (!buildRes.success) {
      throw new Error(buildRes.error || 'Failed to build modified content');
    }
    const newContent = buildRes.content;
    
    // 9. Transition: BACKUP_CREATED -> APPLYING
    transitionOperation(operationId, 'APPLYING');
    
    // 10. Call atomicWrite
    const writeResult = await atomicWrite(
      proposal.gameId,
      proposal.targetFile,
      newContent,
      operationId,
      backup.id,
      proposal.oldValue,
      proposal.path
    );
    
    if (!writeResult.success) {
      throw new Error(writeResult.error || 'Atomic write failed');
    }
    
    // 11. Transition: APPLYING -> VALIDATING
    transitionOperation(operationId, 'VALIDATING');
    
    // 12. Transition: VALIDATING -> COMPLETED
    transitionOperation(operationId, 'COMPLETED');
    
    logEvent({
      gameId: proposal.gameId,
      recipeId: proposal.recipeId || undefined,
      type: 'apply',
      description: `Applied proposal: ${proposal.path}`,
      details: JSON.stringify({
        oldValue: proposal.oldValue,
        newValue: proposal.newValue,
        backupPath: backup.backupPath
      })
    });
    
    return { success: true, backup };
  } catch (error) {
    console.error('Apply failed, initiating rollback:', error);
    
    if (opCreated) {
      try {
        const dbModule = await import('../database/index.js');
        dbModule.default.prepare('UPDATE operations SET failureReason = ? WHERE id = ?').run(String(error), operationId);
        
        const row = dbModule.default.prepare('SELECT status FROM operations WHERE id = ?').get(operationId);
        if (row && row.status !== 'FAILED') {
          if (backup) {
            transitionOperation(operationId, 'FAILED', String(error));
            transitionOperation(operationId, 'RESTORING');
            const restored = restoreBackup(backup);
            if (restored) {
              transitionOperation(operationId, 'RESTORED');
            } else {
              transitionOperation(operationId, 'RESTORE_FAILED', 'Rollback failed during error handling');
            }
          } else {
            const currentStatus = row.status;
            if (currentStatus === 'DRAFT') {
              transitionOperation(operationId, 'CANCELLED');
            } else if (currentStatus === 'PROPOSED' || currentStatus === 'DRY_RUN_PASSED') {
              transitionOperation(operationId, 'FAILED', String(error));
            } else if (currentStatus === 'AWAITING_APPROVAL') {
              transitionOperation(operationId, 'CANCELLED');
            } else {
              transitionOperation(operationId, 'FAILED', String(error));
            }
          }
        }
      } catch (e) {
        console.error('Failed to transition operation status during rollback:', e);
      }
    }
    
    return { 
      success: false, 
      error: String(error) 
    };
  }
}

export async function validateSave(filePath: string): Promise<boolean> {
  try {
    const adapter = getAdapterForFile(filePath);
    if (adapter) {
        if (!fs.existsSync(filePath)) return false;
        const content = fs.readFileSync(filePath, 'utf-8');
        const res = await adapter.validateContent(content, filePath);
        return res.valid;
    }
    
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8');
    if (filePath.toLowerCase().endsWith('.json')) {
      JSON.parse(content);
      return true;
    }
    return true;
  } catch (error) {
    console.error('Validation failed:', error);
    return false;
  }
}

// Data Editor Suggestions
export interface DataSuggestion {
  name: string;
  description: string;
  category: string;
  path: string;
  currentValue: any;
  valueType: string;
  suggestedValue: any;
  risk: string;
}

// Scans a configuration or data file and suggests possible trainer items
export function suggestDataEdits(filePath: string): DataSuggestion[] {
  const suggestions: DataSuggestion[] = [];
  const parsed = parseSaveFile(filePath);
  if (!parsed) return [];
  
  const values = extractSafeValues(parsed);
  
  values.forEach(v => {
    const lowerPath = v.path.toLowerCase();
    const val = v.value;
    
    // Set weapon damage
    if (lowerPath.includes('damage') || lowerPath.includes('dmg')) {
      suggestions.push({
        name: `Set Weapon Damage (${v.path})`,
        description: `Boost or lower damage output defined in ${path.basename(filePath)}`,
        category: 'INVENTORY',
        path: v.path,
        currentValue: val,
        valueType: v.type,
        suggestedValue: typeof val === 'number' ? val * 2 : val,
        risk: v.risk
      });
    }
    
    // Set item price
    if (lowerPath.includes('price') || lowerPath.includes('cost') || lowerPath.includes('value')) {
      suggestions.push({
        name: `Set Item Price (${v.path})`,
        description: `Modify item value/cost inside shop or inventory settings`,
        category: 'INVENTORY',
        path: v.path,
        currentValue: val,
        valueType: v.type,
        suggestedValue: typeof val === 'number' ? Math.max(1, Math.round(val / 2)) : val,
        risk: v.risk
      });
    }
    
    // Set max stack
    if (lowerPath.includes('max_stack') || lowerPath.includes('maxstack') || lowerPath.includes('stacksize')) {
      suggestions.push({
        name: `Set Max Stack Size (${v.path})`,
        description: `Expand inventory holding stacks for items`,
        category: 'INVENTORY',
        path: v.path,
        currentValue: val,
        valueType: v.type,
        suggestedValue: 999,
        risk: 'Safe'
      });
    }
    
    // Set XP reward
    if (lowerPath.includes('xp') || lowerPath.includes('exp') || lowerPath.includes('reward')) {
      suggestions.push({
        name: `Set XP Reward (${v.path})`,
        description: `Multiply XP reward for combat or quest completion`,
        category: 'STATS',
        path: v.path,
        currentValue: val,
        valueType: v.type,
        suggestedValue: typeof val === 'number' ? val * 10 : val,
        risk: v.risk
      });
    }
    
    // Set enemy health
    if (lowerPath.includes('enemy') && (lowerPath.includes('health') || lowerPath.includes('hp'))) {
      suggestions.push({
        name: `Set Enemy Health (${v.path})`,
        description: `Lower health of enemy unit for easier combat`,
        category: 'ENEMIES',
        path: v.path,
        currentValue: val,
        valueType: v.type,
        suggestedValue: 1,
        risk: v.risk
      });
    }
    
    // Unlock recipe / skill
    if (lowerPath.includes('unlock') || lowerPath.includes('learned') || lowerPath.includes('enabled')) {
      suggestions.push({
        name: `Unlock Recipe/Ability (${v.path})`,
        description: `Unlock skill or crafting recipe automatically`,
        category: 'UNLOCKS',
        path: v.path,
        currentValue: val,
        valueType: v.type,
        suggestedValue: typeof val === 'boolean' ? true : 1,
        risk: 'Safe'
      });
    }
    
    // Set player stats
    if (lowerPath.includes('player') && (lowerPath.includes('gold') || lowerPath.includes('stamina') || lowerPath.includes('health'))) {
      suggestions.push({
        name: `Set Player Stats (${v.path})`,
        description: `Boost primary player attributes directly`,
        category: 'PLAYER',
        path: v.path,
        currentValue: val,
        valueType: v.type,
        suggestedValue: typeof val === 'number' ? val + 1000 : val,
        risk: 'Safe'
      });
    }
  });
  
  return suggestions;
}
