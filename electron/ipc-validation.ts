import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { isContainedWithin, validatePathSafety } from '../src/core/safety/path-safety.js';
import { getGameById } from '../src/core/games/index.js';
import { isPathApproved } from '../src/core/saves/locations.js';
import { POPULAR_TRAINER_LIMIT } from '../src/core/trainer-catalog/popular-ranking.js';

/**
 * Zod validation schemas for all Electron IPC payloads.
 * Validates shapes, types, IDs, and path safety constraints at runtime.
 */

const GameLauncherSchema = z.enum(['steam', 'epic', 'gog', 'xbox', 'ubisoft', 'ea', 'battlenet', 'manual']);

export const AddGameSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1),
  engine: z.string().max(100).optional(),
  executablePath: z.string().max(1024).optional(),
  coverPath: z.string().max(1024).optional(),
  iconPath: z.string().max(1024).optional(),
  saveLocations: z.array(z.string().max(1024)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  metadataId: z.string().max(200).optional(),
  launcher: GameLauncherSchema.optional()
});

export const UpdateGameSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
  name: z.string().min(1).max(100),
  path: z.string().min(1),
  engine: z.string().max(100).optional(),
  executablePath: z.string().max(1024).optional(),
  coverPath: z.string().max(1024).optional(),
  iconPath: z.string().max(1024).optional(),
  saveLocations: z.array(z.string().max(1024)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  metadataId: z.string().max(200).optional(),
  launcher: GameLauncherSchema.optional()
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

/** ROADMAP §6.2 Proposal Inspector — same gameId shape as GetJournalSchema, since proposals are scoped per-game the same way journal events are. */
export const GetProposalsSchema = z.object({
  gameId: z.string().uuid().or(z.literal('demo-game-quest-id-000000000000')),
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

export const CreateNotificationSchema = z.object({
  category: z.enum(['catalog-update', 'artwork', 'trainer-profile', 'maintenance', 'recovery', 'general']),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  severity: z.enum(['info', 'success', 'warning', 'error']).optional(),
  action: z.object({
    type: z.literal('open-view'),
    view: z.string().min(1).max(100),
  }).optional(),
});

export const MarkNotificationReadSchema = z.object({
  id: z.string().uuid(),
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

/**
 * Mission 6 (validation receipts -> accuracy badge integration) — bounded
 * batch lookup for the trainer catalog's own gameId shape (a canonical
 * catalog game id string, NOT the `games` table uuid used above), scoped to
 * the games currently rendered in the library so this can never become an
 * unbounded "list every receipt in the database" query.
 */
export const GetValidationReceiptsForGamesSchema = z.object({
  gameIds: z.array(z.string().min(1).max(200)).max(10000),
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
const UNKNOWN_SCAN_KEY = z.string().min(1).max(128);

export const LiveMemoryListProcessesSchema = z.object({});

export const LiveMemoryAttachSchema = z.object({
  pid: z.number().int().positive(),
  executableName: z.string().min(1).max(260),
  // Must be explicitly true — cannot default or be inferred (see PROJECT_SPEC.md Section 3.1).
  userConfirmedOffline: z.literal(true),
  executableHashSHA256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  executableHashPrefixes: z.array(z.string().regex(/^[a-f0-9]{4,64}$/i)).max(32).optional(),
  targetSHA256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  driftAcknowledged: z.boolean().optional(),
  catalogGameId: z.string().min(1).max(128).optional(),
});

/** Zero-Input prepare: plan → attach → SignatureEngine resolve (no cheat writes). */
export const LiveMemoryZeroInputPrepareSchema = z.object({
  pid: z.number().int().positive(),
  executableName: z.string().min(1).max(260),
  catalogGameId: z.string().min(1).max(128),
  userConfirmedOffline: z.literal(true),
  executableHashSHA256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  driftAcknowledged: z.boolean().optional(),
  maxFuzzyDistance: z.number().int().min(0).max(8).optional(),
  /** Prior feature addresses (0x-hex) for SignatureEngine hint windows on re-prepare. */
  featureHints: z.record(
    z.string().min(1).max(128),
    z.string().regex(/^0x[0-9a-f]{1,16}$/i),
  ).optional(),
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

export const LiveMemoryIssueWriteConsentSchema = z.object({
  proposalId: z.string().min(1).max(128),
});

export const LiveMemoryConfirmWriteSchema = z.object({
  proposalId: z.string().min(1).max(128),
  consentToken: z.string().uuid(),
});

// Rollback identifies the write to undo by proposalId ONLY. The address, data
// type, and prior value are looked up server-side from the session's own
// record of writes it actually confirmed (see LiveMemorySession.rollback) —
// never accepted from the renderer. Accepting a full caller-supplied manifest
// here would let "rollback" be used as an arbitrary-address/arbitrary-value
// write primitive with none of the propose/confirm write-policy checks.
export const LiveMemoryRollbackSchema = z.object({
  proposalId: z.string().min(1).max(128),
}).strict();

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

export const LiveMemoryScanFirstAutoMatrixSchema = z.object({
  value: z.number().finite().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  modes: z
    .array(z.enum(['exact', 'between', 'greaterThan', 'lessThan']))
    .min(1)
    .max(4)
    .optional(),
  dataTypes: z.array(LIVE_VALUE_TYPE).min(1).max(6).optional(),
  includeUnknown: z.boolean().optional(),
  unknownKey: UNKNOWN_SCAN_KEY.optional(),
  maxRegionBytes: z.number().int().positive().max(256 * 1024 * 1024).optional(),
  maxTotalBytes: z.number().int().positive().max(4 * 1024 * 1024 * 1024).optional(),
  maxMatches: z.number().int().positive().max(5000).optional(),
  unknownMaxRegionBytes: z.number().int().positive().max(256 * 1024 * 1024).optional(),
  unknownMaxTotalBytes: z.number().int().positive().max(1024 * 1024 * 1024).optional(),
});

const SCAN_COMPARISON_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.number().finite() }),
  z.object({ kind: z.literal('changed') }),
  z.object({ kind: z.literal('unchanged') }),
  z.object({ kind: z.literal('increased') }),
  z.object({ kind: z.literal('decreased') }),
  z.object({ kind: z.literal('increasedBy'), value: z.number().finite() }),
  z.object({ kind: z.literal('decreasedBy'), value: z.number().finite() }),
  z.object({ kind: z.literal('greaterThan'), value: z.number().finite() }),
  z.object({ kind: z.literal('lessThan'), value: z.number().finite() }),
  z.object({ kind: z.literal('between'), min: z.number().finite(), max: z.number().finite() }),
]);

export const LiveMemoryScanNextSchema = z.object({
  dataType: LIVE_VALUE_TYPE,
  comparison: SCAN_COMPARISON_SCHEMA,
  previous: z
    .array(z.object({ address: LIVE_ADDRESS_STRING, value: z.number().finite() }))
    .max(10_000),
});

// "Unknown initial value" scan pair — for a stat with no visible number.
// scanFirstUnknown takes no target value at all (it snapshots raw bytes);
// scanNextFromUnknown reuses the same bounded comparison kinds as scan-next,
// applied against that snapshot instead of a prior match list.
// key scopes the baseline snapshot to one caller-chosen slot (the renderer passes the cheat
// id) so scanning two stats' unknown values concurrently doesn't clobber each other's baseline.
export const LiveMemoryScanFirstUnknownSchema = z.object({
  key: UNKNOWN_SCAN_KEY,
  maxRegionBytes: z.number().int().positive().max(256 * 1024 * 1024).optional(),
  // Lower ceiling than scan-first's 4 GiB — this holds raw region bytes resident as the
  // baseline snapshot (not just filtered match addresses), so the memory cost is much higher
  // per byte scanned. 1 GiB gives headroom above the 512 MiB production default without
  // inviting a multi-GB resident snapshot from the renderer.
  maxTotalBytes: z.number().int().positive().max(1024 * 1024 * 1024).optional(),
});

export const LiveMemoryScanNextFromUnknownSchema = z.object({
  key: UNKNOWN_SCAN_KEY,
  // Array, not a single type — tries every listed interpretation at each offset (Cheat
  // Engine's "All" scan type equivalent) instead of committing to one guess upfront.
  dataTypes: z.array(LIVE_VALUE_TYPE).min(1).max(6),
  comparison: SCAN_COMPARISON_SCHEMA,
  maxMatches: z.number().int().positive().max(5000).optional(),
});

// Watch Live Values panel — bulk-reads a candidate list on a poll interval so the renderer can
// show which one visibly correlates with a real in-game change, instead of guessing blind.
export const LiveMemoryReadManySchema = z.object({
  addresses: z
    .array(z.object({ address: LIVE_ADDRESS_STRING, dataType: LIVE_VALUE_TYPE }))
    .min(1)
    .max(500),
});

export const LiveMemoryCorrelationStartSchema = z.object({
  candidates: z
    .array(
      z.object({
        id: z.string().min(1).max(160).optional(),
        address: LIVE_ADDRESS_STRING,
        value: z.number().finite(),
        dataType: LIVE_VALUE_TYPE,
        source: z.enum(['auto-scan', 'unknown-scan', 'aob-candidate', 'pointer-candidate', 'manual']).optional(),
        scanMode: z.string().min(1).max(80).optional(),
        label: z.string().min(1).max(160).optional(),
      }),
    )
    .min(1)
    .max(10_000),
  pollIntervalMs: z.number().int().min(50).max(5000).optional(),
  reportIntervalMs: z.number().int().min(100).max(5000).optional(),
  epsilon: z.number().finite().nonnegative().max(10_000).optional(),
  eventLookbackMs: z.number().int().min(50).max(10_000).optional(),
});

export const LiveMemoryCorrelationEventSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  kind: z.enum([
    'spent_resource',
    'gained_resource',
    'took_damage',
    'healed',
    'used_stamina',
    'recovered_stamina',
    'used_item',
    'collected_loot',
    'ocr_value',
    'custom',
  ]),
  label: z.string().min(1).max(160).optional(),
  expectedDirection: z.enum(['increased', 'decreased', 'changed', 'unchanged']),
  expectedDelta: z.number().finite().optional(),
  observedValue: z.number().finite().optional(),
  lookbackMs: z.number().int().min(50).max(10_000).optional(),
  observedAt: z.string().min(1).max(80).optional(),
});

export const LiveMemoryCorrelationEmptySchema = z.object({});

export const LocalOcrListSourcesSchema = z.object({
  targetName: z.string().min(1).max(260).optional(),
});

export const LocalOcrCaptureSchema = z.object({
  sourceId: z.string().min(1).max(300),
  roi: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
  }),
});

// Freeze propose/issue-consent/confirm — mirrors the write propose/consent/confirm
// flow above (Batch B1.1). A freeze can no longer be started via a single
// privileged call; a native-dialog-backed consent token is required, bound to
// the exact address/dataType/value/interval approved at propose time.
export const LiveMemoryFreezeProposeSchema = z.object({
  address: LIVE_ADDRESS_STRING,
  dataType: LIVE_VALUE_TYPE,
  value: z.number().finite(),
  // Floor prevents a runaway tight loop from hammering the target process/CPU.
  intervalMs: z.number().int().min(50).max(5000).optional(),
}).strict();

export const LiveMemoryFreezeIssueConsentSchema = z.object({
  proposalId: z.string().min(1).max(128),
}).strict();

export const LiveMemoryFreezeConfirmSchema = z.object({
  proposalId: z.string().min(1).max(128),
  consentToken: z.string().uuid(),
}).strict();

export const LiveMemoryFreezeStopSchema = z.object({});

export const LiveMemoryFreezeStatusSchema = z.object({});

export const LiveMemoryListControlsSchema = z.object({});

export const LiveMemoryResolveControlSchema = z.object({
  controlId: z.string().min(1).max(128),
});

export const LiveMemoryResolveDefinitionFeatureSchema = z.object({
  catalogGameId: z.string().min(1).max(128),
  featureId: z.string().min(1).max(128),
});

export const LiveMemoryPointerScanSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]+$/),
  maxDepth: z.number().int().min(1).max(8).optional(),
  maxOffsetPerLevel: z.number().int().positive().max(65536).optional(),
});

export const LiveMemoryScanAobSchema = z.object({
  signature: z.string().min(3).max(512),
  moduleName: z.string().min(1).max(260).optional(),
});

/** Phase 9 — read-only research view (typed reinterpret at one address). */
export const ResearchViewSchema = z.object({
  address: LIVE_ADDRESS_STRING,
  types: z
    .array(z.union([LIVE_VALUE_TYPE, z.literal('string')]))
    .min(1)
    .max(8),
});

/** Phase 9 — hex inspector window. */
export const ResearchHexSchema = z.object({
  address: LIVE_ADDRESS_STRING,
  size: z.number().int().min(16).max(4096).default(256),
});

/** Phase 9 — pointer candidate analysis (runs pointer scan then scores). */
export const ResearchPointerAnalyzeSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]+$/),
  maxDepth: z.number().int().min(1).max(8).optional(),
  maxOffsetPerLevel: z.number().int().positive().max(65536).optional(),
});

/**
 * Phase 2 — session-bound pointer path resolve (attached process only; no free PID).
 */
export const ResearchResolvePathSchema = z.object({
  moduleName: z.string().min(1).max(260),
  baseOffset: z.string().regex(/^0x[0-9a-fA-F]+$/),
  pointerChain: z.array(z.number().int().nonnegative()).max(32).default([]),
});

const SnapshotWatchItemSchema = z.object({
  address: z.string().min(1).max(32),
  type: z.string().min(1).max(32),
  lastValue: z.union([z.number(), z.string(), z.null()]),
  label: z.string().max(200).optional(),
});

const SnapshotModuleBaseSchema = z.object({
  name: z.string().min(1).max(260),
  baseAddress: z.string().min(1).max(32),
  size: z.number().int().nonnegative(),
});

const SessionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  timestamp: z.string().min(1).max(64),
  pid: z.number().int().nonnegative(),
  processName: z.string().min(1).max(260),
  watchlist: z.array(SnapshotWatchItemSchema).max(500),
  matchSetIds: z.array(z.string().max(128)).max(200),
  moduleBases: z.array(SnapshotModuleBaseSchema).max(200).optional(),
  notes: z.string().max(2000).optional(),
  pointerTarget: z.string().max(32).optional(),
});

/** Phase 9 — diff two session snapshots (no memory I/O). */
export const ResearchSnapshotDiffSchema = z.object({
  old: SessionSnapshotSchema,
  new: SessionSnapshotSchema,
});

/** Phase 9 — persist a session snapshot under userData/research-sessions. */
export const ResearchSnapshotSaveSchema = z.object({
  snapshot: SessionSnapshotSchema,
  label: z.string().min(1).max(80).optional(),
});

export const TrainerResearchAnalyzeExeSchema = z.object({
  filePath: z.string().min(1).max(1024),
});

export const TrainerResearchImportDumpspaceSchema = z.object({
  dumpspaceDir: z.string().min(1).max(1024),
  title: z.string().min(1).max(200),
  executable: z.string().min(1).max(260),
});

export const TrainerResearchAnalyzeCtSchema = z.object({
  xmlText: z.string().min(1).max(8_000_000),
  title: z.string().max(200).optional(),
  executable: z.string().max(260).optional(),
});

export const InProcessProposeHookSchema = z.object({
  plan: z.object({
    cheatName: z.string().min(1).max(200),
    executable: z.string().min(1).max(260),
    moduleName: z.string().min(1).max(260),
    aobSignature: z.string().min(3).max(512),
    symbol: z.string().max(128).optional(),
    patchByteCount: z.number().int().positive().max(64),
    executablePlan: z.boolean(),
    status: z.enum(['ready', 'plan_only', 'missing_aob']),
    presetId: z.enum(['crimson-fast-friendship']).optional(),
    warnings: z.array(z.string()),
    notes: z.array(z.string()),
  }),
  userApprovedAction: z.literal(true),
});

export const InProcessConfirmHookSchema = z.object({
  proposalId: z.string().uuid(),
  userApprovedAction: z.literal(true),
});

export const InProcessProposeInjectorSchema = z.object({
  exePath: z.string().min(1).max(1024),
  userConfirmedOffline: z.literal(true),
  userApprovedAction: z.literal(true),
});

export const InProcessIssueInjectorConsentSchema = z.object({
  proposalId: z.string().uuid(),
});

export const InProcessConfirmInjectorSchema = z.object({
  proposalId: z.string().uuid(),
  userApprovedAction: z.literal(true),
  consentToken: z.string().uuid(),
});

export const InProcessRegisterInjectorHelperSchema = z.object({
  exePath: z.string().min(1).max(1024),
});

export const DefinitionFeedbackSchema = z.object({
  catalogGameId: z.string().min(1).max(128),
  featureId: z.string().min(1).max(128),
  executableHashPrefix: z.string().max(64).optional().nullable(),
  rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  note: z.string().max(500).optional().nullable(),
});

export const ImportCtSchema = z.object({
  xmlText: z.string().min(1).max(8_000_000),
  title: z.string().max(200).optional(),
});

// ── Registry read-only verification (electron/registry-verification-ipc.ts) ──
// Note: "registry" here means a compiled CT/cheat-table artifact (pointers,
// scripts, AOB signatures), NOT the Windows Registry — see
// Docs/Security/Evidence/BatchA/registry-operations-audit.txt.
//
// Batch B1.1: replaced the renderer-supplied `userSelectedProcess: true`
// self-attestation (Batch B1's fix, which only proved the renderer SENT
// true, not that a human selected that process) with a main-process-
// maintained selection record. The renderer requests a selection via
// registry-select-process (which independently re-verifies the pid really
// is the claimed executable against the live OS); verification then
// references that selection by its server-generated id and can no longer
// supply pid/executableName/executablePath directly.
export const RegistrySelectProcessSchema = z.object({
  pid: z.number().int().positive(),
  executableName: z.string().min(1).max(260),
}).strict();

export const RegistryRunVerificationSchema = z.object({
  registry: z.unknown(),
  selectionId: z.string().uuid(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional().default(30_000),
}).strict();

// Persisted cheat toggle state
// (e.g. 'undisputed'), not a UUID like the games-library gameId schemas above.
const CHEAT_GAME_ID = z.string().min(1).max(64);
const CHEAT_ID = z.string().min(1).max(128);

export const CheatToggleGetAllSchema = z.object({
  gameId: CHEAT_GAME_ID,
});

export const CheatToggleSetSchema = z.object({
  gameId: CHEAT_GAME_ID,
  cheatId: CHEAT_ID,
  enabled: z.boolean(),
  confirmedAddress: LIVE_ADDRESS_STRING.nullable().optional(),
  dataType: LIVE_VALUE_TYPE.nullable().optional(),
});

export const CheatToggleClearSchema = z.object({
  gameId: CHEAT_GAME_ID,
  cheatId: CHEAT_ID,
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

/** ROADMAP §4.5 artwork refresh IPC payload — optional explicit scope, bounded to the same limit as a full Popular projection. */
export const ArtworkCacheRefreshSchema = z.object({
  catalogGameIds: z.array(z.string().min(1).max(120)).max(POPULAR_TRAINER_LIMIT).optional(),
});

/**
 * ROADMAP Mission 4 — personal-games artwork priority-fill IPC payload.
 * Bounded to a small, realistic ceiling for one renderer's personal-library
 * signal set (running + installed + owned + favorited + recently-detected
 * games combined) — never anywhere near the full catalog. `canonicalConfidence`
 * is renderer-computed from real identity evidence (see
 * usePersonalLibraryGames.ts / personal-game-priority-fill.ts); the server
 * side still independently refuses to persist unless the fetch-executor's
 * own rights gate allows it, so this schema only bounds shape and size, not
 * trust.
 */
export const ArtworkCachePriorityFillSchema = z.object({
  candidates: z
    .array(
      z.object({
        catalogGameId: z.string().min(1).max(120),
        running: z.boolean(),
        installed: z.boolean(),
        confirmedOwned: z.boolean(),
        favorite: z.boolean(),
        recentlyDetected: z.boolean(),
        canonicalConfidence: z.enum(['trusted', 'weak']),
      }),
    )
    .max(100),
});
