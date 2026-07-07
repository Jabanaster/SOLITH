import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { isContainedWithin, validatePathSafety } from '../src/core/safety/path-safety.js';
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
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  filePath: z.string().min(1)
});

export const CompareSavesSchema = z.object({
  savePathA: z.string().min(1),
  savePathB: z.string().min(1),
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  knownOldValue: z.any().optional(),
  knownNewValue: z.any().optional()
});

export const CompareSavesWithReportSchema = CompareSavesSchema;

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
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
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

// ── Live Memory Trainer IPC Schemas (V2, feature-flagged, see PROJECT_SPEC.md Section 3.1) ──

const LIVE_VALUE_TYPE = z.enum(['int32', 'uint32', 'float', 'double', 'int64', 'byte']);
// Decimal or 0x-prefixed hex string — parsed with BigInt() in the main process.
const LIVE_ADDRESS_STRING = z.string().min(1).max(20).regex(/^(0x[0-9a-fA-F]+|\d+)$/, 'Address must be decimal or 0x-hex');

export const LiveMemoryListProcessesSchema = z.object({});

export const LiveMemoryAttachSchema = z.object({
  pid: z.number().int().positive(),
  executableName: z.string().min(1).max(260),
  // Must be explicitly true — cannot default or be inferred (see PROJECT_SPEC.md Section 3.1).
  userConfirmedOffline: z.literal(true),
});

export const LiveMemoryDetachSchema = z.object({});

export const LiveMemoryReadSchema = z.object({
  address: LIVE_ADDRESS_STRING,
  dataType: LIVE_VALUE_TYPE,
});

export const LiveMemoryProposeWriteSchema = z.object({
  address: LIVE_ADDRESS_STRING,
  dataType: LIVE_VALUE_TYPE,
  requestedValue: z.number().finite(),
});

export const LiveMemoryConfirmWriteSchema = z.object({
  proposalId: z.string().min(1).max(128),
});

export const LiveMemoryRollbackSchema = z.object({
  manifest: z.object({
    proposalId: z.string().min(1).max(128),
    target: z.object({
      address: LIVE_ADDRESS_STRING,
      moduleName: z.string().max(260).optional(),
      dataType: LIVE_VALUE_TYPE,
    }),
    valueBefore: z.number().finite(),
    valueAfter: z.number().finite(),
    appliedAt: z.string(),
  }),
});

// Bounds are client-overridable but capped tightly server-side — a renderer
// (even a trusted-by-default one) should not be able to request a scan large
// enough to hang the main process.
export const LiveMemoryScanFirstSchema = z.object({
  dataType: LIVE_VALUE_TYPE,
  targetValue: z.number().finite(),
  maxRegionBytes: z.number().int().positive().max(256 * 1024 * 1024).optional(),
  // 4 GiB ceiling — real-machine testing showed the 2 GiB production default is itself
  // sometimes insufficient (Stardew Valley alone used ~957 MiB), so the client-overridable
  // ceiling needs headroom above the default, not just enough to reach it.
  maxTotalBytes: z.number().int().positive().max(4 * 1024 * 1024 * 1024).optional(),
  maxMatches: z.number().int().positive().max(5000).optional(),
});

const SCAN_COMPARISON_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.number().finite() }),
  z.object({ kind: z.literal('changed') }),
  z.object({ kind: z.literal('unchanged') }),
  z.object({ kind: z.literal('increased') }),
  z.object({ kind: z.literal('decreased') }),
]);

export const LiveMemoryScanNextSchema = z.object({
  dataType: LIVE_VALUE_TYPE,
  comparison: SCAN_COMPARISON_SCHEMA,
  previous: z
    .array(z.object({ address: LIVE_ADDRESS_STRING, value: z.number().finite() }))
    .max(10_000),
});

export const LiveMemoryFreezeStartSchema = z.object({
  address: LIVE_ADDRESS_STRING,
  dataType: LIVE_VALUE_TYPE,
  value: z.number().finite(),
  // Floor prevents a runaway tight loop from hammering the target process/CPU.
  intervalMs: z.number().int().min(50).max(5000).optional(),
});

export const LiveMemoryFreezeStopSchema = z.object({});

export const LiveMemoryFreezeStatusSchema = z.object({});

export const LiveMemoryListControlsSchema = z.object({});

export const LiveMemoryResolveControlSchema = z.object({
  controlId: z.string().min(1).max(128),
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

export interface IpcFileAccessResult {
  safe: boolean;
  error?: string;
}

const UNAPPROVED_FILE_ERROR = 'File is not approved for this game.';
const DEMO_GAME_ID = 'demo-game-quest-id-000000000000';

function isApprovedDemoGameFile(gameId: string, filePath: string): boolean {
  if (gameId !== DEMO_GAME_ID) return false;
  const demoRoot = path.resolve(process.cwd(), 'demo-game');
  return fs.existsSync(demoRoot) && isContainedWithin(filePath, demoRoot);
}

/**
 * Validates save/data IPC file access against registered game roots or approved
 * save locations. The error is intentionally generic to avoid path disclosure.
 */
export function validateSaveDataFileAccess(gameId: string, filePath: string): IpcFileAccessResult {
  try {
    if (!gameId || !filePath) {
      return { safe: false, error: UNAPPROVED_FILE_ERROR };
    }

    const safety = validatePathSafety(filePath);
    if (!safety.safe && !isApprovedDemoGameFile(gameId, filePath)) {
      return { safe: false, error: UNAPPROVED_FILE_ERROR };
    }

    if (!isApprovedDemoGameFile(gameId, filePath) && !isPathApproved(filePath, gameId)) {
      return { safe: false, error: UNAPPROVED_FILE_ERROR };
    }

    return { safe: true };
  } catch {
    return { safe: false, error: UNAPPROVED_FILE_ERROR };
  }
}
