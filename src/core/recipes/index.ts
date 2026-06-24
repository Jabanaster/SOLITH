import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import db from '../database';
import { Recipe, TrainerItem } from '../../shared/types';
import { computeFileHash } from '../scanner';
import { parseSaveFile } from '../saves';
import { getGameById } from '../games';
import { getAdapterForFile } from '../adapters/index';

// Zod validation schema for recipes
export const RecipeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  gameId: z.string(),
  category: z.string(),
  source: z.string(),
  target: z.string(),
  path: z.string(),
  valueType: z.string(),
  risk: z.string(),
  requiresBackup: z.boolean().or(z.number()),
  confidence: z.number(),
  description: z.string().optional().nullable(),
  createdAt: z.string().or(z.instanceof(Date)).optional(),
  updatedAt: z.string().or(z.instanceof(Date)).optional(),
  fileHash: z.string().optional().nullable(),
  gameFingerprintHash: z.string().optional().nullable(),
  needsRescan: z.boolean().or(z.number()).optional(),
  isActive: z.boolean().or(z.number()).optional(),
  version: z.number().optional(),
  
  schemaVersion: z.union([z.string(), z.number()]).optional(),
  adapterId: z.string().optional(),
  adapterVersion: z.string().optional(),
  targetStrategy: z.string().optional(),
  safeRelativePattern: z.string().optional(),
  structuredPath: z.string().optional(),
  inputType: z.string().optional(),
  minimum: z.number().optional().nullable(),
  maximum: z.number().optional().nullable(),
  allowedValues: z.array(z.any()).optional().nullable(),
  preconditions: z.any().optional().nullable(),
  validationRules: z.any().optional().nullable(),
  fingerprintCompatibility: z.string().optional().nullable()
});

// Checks all string fields for JS, Shell, SQL, IPC
export function validateRecipeSafety(recipe: any): { valid: boolean; error?: string } {
  const parsed = RecipeSchema.safeParse(recipe);
  if (!parsed.success) {
    return { valid: false, error: `Schema validation failed: ${parsed.error.message}` };
  }

  const checkValue = (val: any, key?: string): { valid: boolean; error?: string } => {
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      
      // 1. Arbitrary JavaScript
      if (lower.includes('eval(') || lower.includes('function(') || lower.includes('process.') ||
          lower.includes('require(') || lower.includes('import(') || val.includes('=>') || lower.includes('window.')) {
        return { valid: false, error: 'Forbidden JavaScript keywords/syntax detected.' };
      }
      
      // 2. Shell commands
      if (lower.includes('exec(') || lower.includes('spawn(') || lower.includes('child_process') ||
          lower.includes('cmd.exe') || lower.includes('/bin/sh') || lower.includes('/bin/bash') ||
          lower.includes('powershell') || val.includes('|') || val.includes('&') || val.includes(';')) {
        return { valid: false, error: 'Forbidden shell commands/characters detected.' };
      }
      
      // 3. SQL injection
      const isPathField = key && ['target', 'safeRelativePattern', 'structuredPath', 'path'].includes(key);
      if (!isPathField) {
        if (/\b(select|insert|update|delete|drop|union|alter|create)\b/i.test(val) || val.includes('--') || val.includes('/*')) {
          return { valid: false, error: 'Forbidden SQL query/syntax detected.' };
        }
      }

      // 4. Arbitrary IPC channels or names
      if (lower.includes('ipc') || lower.includes('channel') || lower.includes('send') || lower.includes('invoke')) {
        return { valid: false, error: 'Forbidden IPC references detected.' };
      }
    } else if (typeof val === 'object' && val !== null) {
      for (const k of Object.keys(val)) {
        const res = checkValue(val[k], k);
        if (!res.valid) return res;
      }
    }
    return { valid: true };
  };

  const safetyRes = checkValue(recipe);
  if (!safetyRes.valid) return safetyRes;

  // Unknown operation types check
  const allowedOps = ['set', 'increment', 'decrement', 'toggle'];
  const checkOps = (rules: any): { valid: boolean; error?: string } => {
    if (Array.isArray(rules)) {
      for (const r of rules) {
        if (r && r.operation && !allowedOps.includes(r.operation)) {
          return { valid: false, error: `Unknown operation type: "${r.operation}"` };
        }
      }
    }
    return { valid: true };
  };

  const precRes = checkOps(recipe.preconditions);
  if (!precRes.valid) return precRes;

  const valRulesRes = checkOps(recipe.validationRules);
  if (!valRulesRes.valid) return valRulesRes;

  return { valid: true };
}

// Conflict detection for recipes targeting the same file and path
export function checkRecipeConflict(gameId: string, targetFile: string, pathStr: string, currentRecipeId?: string): boolean {
  const stmt = db.prepare(`
    SELECT id FROM recipes 
    WHERE gameId = ? AND target = ? AND path = ?
  `);
  const rows = stmt.all(gameId, targetFile, pathStr);
  if (currentRecipeId) {
    return rows.some((row: any) => row.id !== currentRecipeId);
  }
  return rows.length > 0;
}

// Map db row to typed Recipe object
function mapRowToRecipe(row: any): Recipe {
  if (!row) return row;
  return {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
    needsRescan: row.needsRescan === 1,
    requiresBackup: row.requiresBackup === 1,
    allowedValues: row.allowedValues ? JSON.parse(row.allowedValues) : undefined,
    preconditions: row.preconditions ? JSON.parse(row.preconditions) : undefined,
    validationRules: row.validationRules ? JSON.parse(row.validationRules) : undefined
  };
}

// Helper to check if a path exists in an object
function checkPathExists(obj: any, pathStr: string): boolean {
  try {
    const parts = pathStr.split(/[.\[\]]/).filter(Boolean);
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return false;
      const index = parseInt(part);
      if (!isNaN(index) && Array.isArray(current)) {
        if (index < 0 || index >= current.length) return false;
        current = current[index];
      } else {
        if (!(part in current)) return false;
        current = current[part];
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Verifies the recipe target file and path are still valid and uncorrupted
export function verifyRecipeSafety(recipe: Recipe): 'Ready' | 'Needs Rescan' | 'Broken' {
  try {
    const safety = validateRecipeSafety(recipe);
    if (!safety.valid) {
      return 'Broken';
    }

    if (!recipe.target || !fs.existsSync(recipe.target)) {
      return 'Broken';
    }
    
    const parsed = parseSaveFile(recipe.target);
    if (!parsed) {
      return 'Broken';
    }
    
    // Check if key still exists in file
    const exists = checkPathExists(parsed.data, recipe.path);
    if (!exists) {
      return 'Broken';
    }
    
    // If the file hash changed, it needs a rescan to ensure compatibility
    const currentHash = computeFileHash(recipe.target);
    if (recipe.fileHash && currentHash !== recipe.fileHash) {
      return 'Needs Rescan';
    }
    
    return 'Ready';
  } catch {
    return 'Broken';
  }
}

export function getRecipes(gameId: string): Recipe[] {
  const stmt = db.prepare(`
    SELECT r.*, g.name as gameName
    FROM recipes r
    JOIN games g ON r.gameId = g.id
    WHERE r.gameId = ?
    ORDER BY r.updatedAt DESC
  `);
  
  return stmt.all(gameId).map(mapRowToRecipe);
}

export function getRecipeById(recipeId: string): Recipe | null {
  const stmt = db.prepare(`
    SELECT r.*, g.name as gameName
    FROM recipes r
    JOIN games g ON r.gameId = g.id
    WHERE r.id = ?
  `);
  
  const row = stmt.get(recipeId);
  if (!row) return null;
  
  return mapRowToRecipe(row);
}

export function createRecipe(recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): Recipe {
  const recipeId = crypto.randomUUID();
  const targetFileHash = recipe.target ? computeFileHash(recipe.target) : null;
  const game = getGameById(recipe.gameId);
  const fingerprintHash = game?.fingerprint ? crypto.createHash('sha256').update(JSON.stringify(game.fingerprint)).digest('hex') : null;

  const validatedRecipe: Recipe = {
    ...recipe,
    id: recipeId,
    schemaVersion: recipe.schemaVersion || '1.0.0',
    adapterId: recipe.adapterId || 'json-adapter',
    adapterVersion: recipe.adapterVersion || '1.0.0',
    targetStrategy: recipe.targetStrategy || 'file',
    safeRelativePattern: recipe.safeRelativePattern || '**/*.json',
    structuredPath: recipe.structuredPath || recipe.path,
    inputType: recipe.inputType || (recipe.valueType === 'boolean' ? 'toggle' : 'number'),
    minimum: recipe.minimum,
    maximum: recipe.maximum,
    allowedValues: recipe.allowedValues || [],
    preconditions: recipe.preconditions || [],
    validationRules: recipe.validationRules || [],
    fingerprintCompatibility: recipe.fingerprintCompatibility || '*',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Perform validation safety and conflict check
  const safety = validateRecipeSafety(validatedRecipe);
  if (!safety.valid) {
    throw new Error(`Recipe safety violation: ${safety.error}`);
  }

  const adapter = getAdapterForFile(recipe.target);
  if (adapter && adapter.id === 'binary-adapter') {
    throw new Error('Recipes cannot target binary files (read-only).');
  }

  if (checkRecipeConflict(recipe.gameId, recipe.target, recipe.path, recipeId)) {
    throw new Error(`Recipe conflict detected: another recipe already targets path "${recipe.path}" in file "${recipe.target}"`);
  }

  const stmt = db.prepare(`
    INSERT INTO recipes (
      id, gameId, name, category, source, target, path, valueType, risk,
      requiresBackup, confidence, description, fileHash, gameFingerprintHash, needsRescan,
      schemaVersion, adapterId, adapterVersion, targetStrategy, safeRelativePattern,
      structuredPath, inputType, minimum, maximum, allowedValues, preconditions,
      validationRules, fingerprintCompatibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    recipeId,
    recipe.gameId,
    recipe.name,
    recipe.category,
    recipe.source,
    recipe.target,
    recipe.path,
    recipe.valueType,
    recipe.risk,
    recipe.requiresBackup ? 1 : 0,
    recipe.confidence,
    recipe.description || '',
    targetFileHash,
    fingerprintHash,
    0,
    String(validatedRecipe.schemaVersion),
    validatedRecipe.adapterId,
    validatedRecipe.adapterVersion,
    validatedRecipe.targetStrategy,
    validatedRecipe.safeRelativePattern,
    validatedRecipe.structuredPath,
    validatedRecipe.inputType,
    validatedRecipe.minimum !== undefined ? validatedRecipe.minimum : null,
    validatedRecipe.maximum !== undefined ? validatedRecipe.maximum : null,
    JSON.stringify(validatedRecipe.allowedValues),
    JSON.stringify(validatedRecipe.preconditions),
    JSON.stringify(validatedRecipe.validationRules),
    validatedRecipe.fingerprintCompatibility
  );
  
  return validatedRecipe;
}

export function updateRecipe(recipeId: string, updates: Partial<Omit<Recipe, 'id' | 'createdAt' | 'gameId'>>): Recipe | null {
  const current = getRecipeById(recipeId);
  if (!current) return null;

  const merged = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  const safety = validateRecipeSafety(merged);
  if (!safety.valid) {
    throw new Error(`Recipe safety violation: ${safety.error}`);
  }

  if (checkRecipeConflict(current.gameId, merged.target, merged.path, recipeId)) {
    throw new Error(`Recipe conflict detected: another recipe already targets path "${merged.path}" in file "${merged.target}"`);
  }

  const stmt = db.prepare(`
    UPDATE recipes SET
      name = ?, category = ?, source = ?, target = ?, path = ?,
      valueType = ?, risk = ?, requiresBackup = ?, confidence = ?,
      description = ?, fileHash = ?, gameFingerprintHash = ?, needsRescan = ?,
      schemaVersion = ?, adapterId = ?, adapterVersion = ?, targetStrategy = ?,
      safeRelativePattern = ?, structuredPath = ?, inputType = ?, minimum = ?,
      maximum = ?, allowedValues = ?, preconditions = ?, validationRules = ?,
      fingerprintCompatibility = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  
  stmt.run(
    merged.name,
    merged.category,
    merged.source,
    merged.target,
    merged.path,
    merged.valueType,
    merged.risk,
    merged.requiresBackup ? 1 : 0,
    merged.confidence,
    merged.description || '',
    merged.fileHash || null,
    merged.gameFingerprintHash || null,
    merged.needsRescan ? 1 : 0,
    String(merged.schemaVersion || '1.0.0'),
    merged.adapterId || 'json-adapter',
    merged.adapterVersion || '1.0.0',
    merged.targetStrategy || 'file',
    merged.safeRelativePattern || '**/*.json',
    merged.structuredPath || merged.path,
    merged.inputType || 'number',
    merged.minimum !== undefined ? merged.minimum : null,
    merged.maximum !== undefined ? merged.maximum : null,
    JSON.stringify(merged.allowedValues || []),
    JSON.stringify(merged.preconditions || []),
    JSON.stringify(merged.validationRules || []),
    merged.fingerprintCompatibility || '*',
    recipeId
  );
  
  return getRecipeById(recipeId);
}

export function deleteRecipe(recipeId: string): boolean {
  const stmt = db.prepare('DELETE FROM recipes WHERE id = ?');
  return stmt.run(recipeId).changes !== 0;
}

export function getRecipesByCategory(gameId: string, category: string): Recipe[] {
  const stmt = db.prepare(`
    SELECT r.*, g.name as gameName
    FROM recipes r
    JOIN games g ON r.gameId = g.id
    WHERE r.gameId = ? AND r.category = ?
    ORDER BY r.updatedAt DESC
  `);
  
  return stmt.all(gameId, category).map(mapRowToRecipe);
}

export function markRecipeForRescan(recipeId: string): boolean {
  const stmt = db.prepare(`
    UPDATE recipes SET needsRescan = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?
  `);
  
  return stmt.run(recipeId).changes !== 0;
}

export function clearRecipeRescanFlag(recipeId: string): boolean {
  const stmt = db.prepare(`
    UPDATE recipes SET needsRescan = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?
  `);
  
  return stmt.run(recipeId).changes !== 0;
}

export function getRecipesNeedingRescan(gameId: string): Recipe[] {
  const stmt = db.prepare(`
    SELECT r.*, g.name as gameName
    FROM recipes r
    JOIN games g ON r.gameId = g.id
    WHERE r.gameId = ? AND r.needsRescan = 1
    ORDER BY r.updatedAt ASC
  `);
  
  return stmt.all(gameId).map(mapRowToRecipe);
}

export function recipeToTrainerItem(recipe: Recipe): TrainerItem {
  const safety = verifyRecipeSafety(recipe);
  const statusBadge = safety === 'Broken' ? 'Broken' : safety === 'Needs Rescan' ? 'Needs Rescan' : 'Ready';
  
  // Extract current value from target file if available
  let currentValue: string | number | undefined = undefined;
  try {
    if (fs.existsSync(recipe.target)) {
      const parsed = parseSaveFile(recipe.target);
      if (parsed) {
        const parts = recipe.path.split(/[.\[\]]/).filter(Boolean);
        let current = parsed.data;
        for (const part of parts) {
          const idx = parseInt(part);
          current = (!isNaN(idx) && Array.isArray(current)) ? current[idx] : current[part];
        }
        if (typeof current === 'string' || typeof current === 'number') {
          currentValue = current;
        }
      }
    }
  } catch (e) {
    // Ignore error
  }

  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description || '',
    category: recipe.category,
    source: recipe.source,
    risk: recipe.risk,
    status: statusBadge,
    confidence: recipe.confidence,
    path: recipe.path,
    target: recipe.target,
    currentValue,
    inputType: recipe.valueType === 'boolean' ? 'toggle' : 'number',
    min: recipe.minimum !== undefined ? recipe.minimum : 0,
    max: recipe.maximum !== undefined ? recipe.maximum : 999999
  };
}

export function getTrainerItems(gameId: string, category: string): TrainerItem[] {
  const recipes = getRecipesByCategory(gameId, category);
  return recipes.map(recipeToTrainerItem);
}

export function getAllTrainerItems(gameId: string): TrainerItem[] {
  const recipes = getRecipes(gameId);
  return recipes.map(recipeToTrainerItem);
}
