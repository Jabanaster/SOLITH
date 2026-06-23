import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { validatePathSafety } from '../src/core/safety/path-safety.js';
import { getGameById } from '../src/core/games/index.js';
import { isPathApproved } from '../src/core/saves/locations.js';

/**
 * Zod validation schemas for all Electron IPC payloads.
 * Validates shapes, types, IDs, and path safety constraints at runtime.
 */

export const AddGameSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1),
  engine: z.string().optional()
});

export const ScanGameSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const GetRecipesSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const CreateRecipeSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  name: z.string().min(1).max(100),
  category: z.enum(['PLAYER', 'INVENTORY', 'STATS', 'ENEMIES', 'GAME', 'UNLOCKS', 'VIDEO', 'VOICE', 'DISCOVERY']),
  source: z.string().min(1),
  target: z.string().min(1),
  path: z.string().min(1),
  valueType: z.string().min(1),
  risk: z.enum(['Safe', 'Caution', 'Risky', 'Blocked']),
  requiresBackup: z.boolean(),
  confidence: z.number().min(0).max(100),
  description: z.string().optional()
});

export const DeleteRecipeSchema = z.object({
  recipeId: z.string().uuid()
});

export const DeleteGameSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const GetJournalSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')).nullable().optional()
});

export const LogEventSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')).nullable().optional(),
  recipeId: z.string().uuid().nullable().optional(),
  type: z.enum(['scan', 'discovery', 'proposal', 'backup', 'apply', 'rollback', 'error', 'recipe', 'game_added', 'settings']),
  description: z.string().min(1),
  details: z.string().optional()
});

export const SetSettingSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()])
});

export const GetBackupsSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const RestoreBackupSchema = z.object({
  backupId: z.string().uuid()
});

export const DetectSaveFilesSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const ParseSaveSchema = z.object({
  filePath: z.string().min(1)
});

export const CompareSavesSchema = z.object({
  savePathA: z.string().min(1),
  savePathB: z.string().min(1),
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')).optional(),
  knownOldValue: z.any().optional(),
  knownNewValue: z.any().optional()
});

export const CreateProposalSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  filePath: z.string().min(1),
  path: z.string().min(1),
  oldValue: z.any(),
  newValue: z.any(),
  recipeId: z.string().uuid().nullable().optional()
});

export const ApplyProposalSchema = z.object({
  id: z.string().uuid(),
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  recipeId: z.string().uuid().nullable().optional(),
  targetFile: z.string().min(1),
  operation: z.enum(['set', 'increment', 'decrement', 'toggle']),
  path: z.string().min(1),
  oldValue: z.any(),
  newValue: z.any(),
  risk: z.enum(['Safe', 'Caution', 'Risky', 'Blocked']),
  preview: z.string(),
  validationRule: z.string(),
  requiresBackup: z.boolean(),
  dryRunPassed: z.boolean(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: z.string()
});

export const SuggestDataEditsSchema = z.object({
  filePath: z.string().min(1)
});

export const DiscoverSaveLocationsSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const ApproveSaveLocationSchema = z.object({
  locationId: z.string().uuid()
});

export const RevokeSaveLocationSchema = z.object({
  locationId: z.string().uuid()
});

export const GetSaveLocationsSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const AddUserSelectedLocationSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  path: z.string().min(1)
});

export const CheckGameRunningSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

export const GetCompatibilityProfileSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000'))
});

/**
 * Validates a file path against a gameId's registered root directory.
 * Prevents path traversal and link-escapes inside IPC boundaries.
 */
export function validateIpcPathSafety(filePath: string, gameId: string): boolean {
  try {
    return isPathApproved(filePath, gameId);
  } catch {
    return false;
  }
}
