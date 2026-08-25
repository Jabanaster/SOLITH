import { z } from 'zod';
import { issue, type WispProfileValidationIssue } from './errors.js';
import { WISP_PROFILE_LIMITS } from './limits.js';
import { scanForExecutableMetadata } from './security-scan.js';
import type { WispActionId, WispGroupId, WispProfileId, CanonicalGameId } from './types.js';

/**
 * Adaptive Wisp per-game user state (Increment 2, Sections 6, 9, 35).
 *
 * One coherent per-game document — selected profile + presentation-level
 * override live together (Section 35's "transactional user state" choice),
 * so there is no way for a selection write and an override write to land
 * inconsistently. This is distinct from and versioned separately from the
 * profile schema (Section 9) — a user-state document does not need to
 * change shape just because the profile schema gains a v2.
 *
 * A user override can only reorder/hide/reslot/regroup actions that already
 * exist in the resolved base profile (Section 7) — it cannot define a new
 * trainer entry reference, address, command, or IPC channel. No physical
 * hotkey mapping lives here; that is a later increment's concern.
 */

export const WISP_USER_STATE_SCHEMA_VERSION = 1 as const;
export const WISP_SUPPORTED_USER_STATE_SCHEMA_VERSIONS: readonly number[] = [WISP_USER_STATE_SCHEMA_VERSION];

const id = () => z.string().min(1).max(WISP_PROFILE_LIMITS.maxIdLength);
const timestamp = () => z.string().min(1).max(WISP_PROFILE_LIMITS.maxTimestampLength);

export const WispUserOverrideSchema = z
  .object({
    schemaVersion: z.literal(WISP_USER_STATE_SCHEMA_VERSION),
    gameId: id(),
    baseProfileId: id().optional(),
    groupOrder: z.array(id()).max(WISP_PROFILE_LIMITS.maxOverrideGroupOrderEntries).optional(),
    actionOrderByGroup: z
      .record(id(), z.array(id()).max(WISP_PROFILE_LIMITS.maxOverrideActionsPerGroupOrder))
      .refine((value) => Object.keys(value).length <= WISP_PROFILE_LIMITS.maxOverrideActionOrderGroups, 'too many actionOrderByGroup entries')
      .optional(),
    slotAssignments: z
      .record(id(), z.union([z.number().int(), z.null()]))
      .refine((value) => Object.keys(value).length <= WISP_PROFILE_LIMITS.maxOverrideSlotAssignments, 'too many slotAssignments entries')
      .optional(),
    hiddenActions: z.array(id()).max(WISP_PROFILE_LIMITS.maxOverrideHiddenActions).optional(),
    actionGroupOverrides: z
      .record(id(), id())
      .refine((value) => Object.keys(value).length <= WISP_PROFILE_LIMITS.maxOverrideActionGroupOverrides, 'too many actionGroupOverrides entries')
      .optional(),
    preferredGroupId: id().optional(),
    preferredQuickSlotCount: z.number().int().optional(),
    updatedAt: timestamp().optional(),
  })
  .strict();

export const WispUserStateSchema = z
  .object({
    schemaVersion: z.literal(WISP_USER_STATE_SCHEMA_VERSION),
    gameId: id(),
    selectedProfileId: id().optional(),
    override: WispUserOverrideSchema.optional(),
  })
  .strict();

export interface WispUserOverride {
  schemaVersion: number;
  gameId: CanonicalGameId;
  baseProfileId?: WispProfileId;
  groupOrder?: WispGroupId[];
  actionOrderByGroup?: Record<WispGroupId, WispActionId[]>;
  slotAssignments?: Record<WispActionId, number | null>;
  hiddenActions?: WispActionId[];
  actionGroupOverrides?: Record<WispActionId, WispGroupId>;
  preferredGroupId?: WispGroupId;
  preferredQuickSlotCount?: number;
  updatedAt?: string;
}

export interface WispUserState {
  schemaVersion: number;
  gameId: CanonicalGameId;
  selectedProfileId?: WispProfileId;
  override?: WispUserOverride;
}

export type WispUserStateValidation = { ok: true; state: WispUserState } | { ok: false; issues: WispProfileValidationIssue[] };

function extractSchemaVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as Record<string, unknown>).schemaVersion;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Shape/version/security validation only — this does NOT know about any
 * particular resolved profile, so it cannot check whether
 * `override.hiddenActions` etc. reference real actions. That cross-check
 * happens at overlay time in profile-resolver.ts (Section 25/28: a stale
 * reference there is ignored with a diagnostic, not a load failure — a
 * creator profile update removing an action is normal, not corruption).
 */
export function validateWispUserState(raw: unknown): WispUserStateValidation {
  const blocked = scanForExecutableMetadata(raw, 'userState');
  if (blocked) return { ok: false, issues: [blocked] };

  const version = extractSchemaVersion(raw);
  if (version === null || !WISP_SUPPORTED_USER_STATE_SCHEMA_VERSIONS.includes(version)) {
    return {
      ok: false,
      issues: [issue('WISP_PROFILE_VERSION_UNSUPPORTED', `user-state schemaVersion ${version === null ? '(missing/malformed)' : version} is not supported`, 'schemaVersion')],
    };
  }

  const parsed = WispUserStateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, issues: [issue('WISP_PROFILE_SCHEMA_INVALID', first?.message ?? 'user-state schema validation failed', first?.path.join('.'))] };
  }

  return { ok: true, state: parsed.data as WispUserState };
}
