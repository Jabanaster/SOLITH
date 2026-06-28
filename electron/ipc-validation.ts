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
  inputType: z.enum(['number', 'toggle', 'slider', 'dropdown']).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  unit: z.string().max(20).optional(),
  resetValue: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
  maxLength: z.number().int().positive().max(256).optional(),
  pattern: z.string().max(200).optional(),
  options: z.array(
    z.object({
      label: z.string().min(1).max(80),
      value: z.union([z.string().max(120), z.number().finite(), z.boolean()])
    })
  ).max(50).optional(),
  risk: z.enum(['Safe', 'Caution', 'Risky', 'Blocked']),
  requiresBackup: z.boolean(),
  confidence: z.number().min(0).max(100),
  description: z.string().optional()
}).superRefine((recipe, ctx) => {
  const inputType = recipe.inputType ?? (recipe.valueType === 'boolean' ? 'toggle' : 'number');

  if (inputType === 'slider') {
    if (recipe.minimum === undefined || recipe.maximum === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Slider requires both minimum and maximum.' });
    }
    if (recipe.minimum !== undefined && recipe.maximum !== undefined && recipe.minimum >= recipe.maximum) {
      ctx.addIssue({ code: 'custom', message: 'Slider minimum must be less than maximum.' });
    }
    if (recipe.step === undefined || recipe.step <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Slider step must be a positive number.' });
    }
  }

  if (inputType === 'dropdown') {
    const options = recipe.options ?? [];
    if (options.length < 1) {
      ctx.addIssue({ code: 'custom', message: 'Dropdown requires at least one option.' });
      return;
    }
    const seen = new Set<string>();
    for (const option of options) {
      const key = `${typeof option.value}:${String(option.value)}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: 'Dropdown option values must be unique.' });
        break;
      }
      seen.add(key);
    }
  }
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

// ── V2 Session Lifecycle Monitor IPC Schemas ─────────────────────────────────

const SAFE_EXECUTABLE_NAME = z.string().min(1).max(100).regex(
  /^[\w\-. ]+$/,
  'Executable name must contain only word characters, hyphens, spaces, and dots'
);

export const V2MonitorStartSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  executableName: SAFE_EXECUTABLE_NAME,
  /** Optional path to an external session-marker file to observe (read-only). */
  markerFilePath: z.string().max(512).optional(),
  pollIntervalMs: z.number().int().min(2000).max(60000).optional(),
});

export const V2MonitorStopSchema = z.object({});

export const V2MonitorGetStateSchema = z.object({});

// ── TrainerHost IPC Schemas ───────────────────────────────────────────────────

export const TrainerHostStartSchema = z.object({});

export const TrainerHostStopSchema = z.object({});

export const TrainerHostGetStatusSchema = z.object({});

export const TrainerHostReadFieldSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  filePath: z.string().min(1).max(512),
  field: z.string().min(1).max(200),
});

export const TrainerHostProposeWriteSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  filePath: z.string().min(1).max(512),
  field: z.string().min(1).max(200),
  currentValue: z.string().min(0).max(1024),
  newValue: z.string().min(0).max(1024),
});

export const TrainerHostApproveAndWriteSchema = z.object({
  proposalId: z.string().min(1).max(128),
});

export const TrainerHostRollbackSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  filePath: z.string().min(1).max(512),
  backupPath: z.string().min(1).max(512),
  field: z.string().min(1).max(200),
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
