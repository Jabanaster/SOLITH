import { z } from 'zod';
import { WISP_PROFILE_LIMITS } from './limits.js';

/**
 * Adaptive Wisp runtime schema (Increment 1, Sections 3-9, 12).
 *
 * Every object schema is `.strict()` — an unrecognized field fails parsing
 * outright. That is deliberate: it is the first line of defense against
 * declarative-metadata-that-secretly-isn't (see the explicit blocklist scan
 * in validation.ts for the second line of defense). Slot bounds and
 * cross-object references are intentionally NOT enforced here — they get
 * their own distinct WISP_PROFILE_INVALID_SLOT / *_REFERENCE error codes in
 * validation.ts's cross-reference pass, so this schema only owns shape/type.
 */

export const WISP_PROFILE_SCHEMA_VERSION = 1 as const;
export const WISP_SUPPORTED_PROFILE_SCHEMA_VERSIONS: readonly number[] = [WISP_PROFILE_SCHEMA_VERSION];

const id = () => z.string().min(1).max(WISP_PROFILE_LIMITS.maxIdLength);
const label = () => z.string().min(1).max(WISP_PROFILE_LIMITS.maxStringLength);
const shortLabel = () => z.string().min(1).max(WISP_PROFILE_LIMITS.maxShortLabelLength);
const timestamp = () => z.string().min(1).max(WISP_PROFILE_LIMITS.maxTimestampLength);

export const WispControlTypeSchema = z.enum(['toggle', 'freeze', 'set', 'increment', 'multiplier', 'cycle', 'momentary']);

export const WispProfileSourceSchema = z.enum(['builtin', 'generated', 'creator', 'community', 'user']);

export const WispPresetSchema = z
  .object({
    id: id(),
    label: label(),
    value: z.union([z.number(), z.string().max(WISP_PROFILE_LIMITS.maxStringLength), z.boolean()]),
  })
  .strict();

export const WispActionDefinitionSchema = z
  .object({
    id: id(),
    entryId: id(),
    label: label(),
    shortLabel: shortLabel().optional(),
    description: z.string().max(WISP_PROFILE_LIMITS.maxDescriptionLength).optional(),
    groupId: id().optional(),
    controlType: WispControlTypeSchema,
    // Deliberately unbounded here — range enforcement lives in validation.ts
    // so an out-of-range slot gets WISP_PROFILE_INVALID_SLOT, not a generic
    // schema failure.
    slot: z.number().int().optional(),
    priority: z.number().int().optional(),
    defaultHotkey: z.string().min(1).max(WISP_PROFILE_LIMITS.maxHotkeyLength).optional(),
    presets: z.array(WispPresetSchema).max(WISP_PROFILE_LIMITS.maxPresetsPerAction).optional(),
    iconId: id().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const WispGroupDefinitionSchema = z
  .object({
    id: id(),
    label: label(),
    shortLabel: shortLabel().optional(),
    order: z.number().int().min(0).max(1000),
    actionIds: z.array(id()).max(WISP_PROFILE_LIMITS.maxActionsPerGroup),
  })
  .strict();

export const WispProfileProvenanceSchema = z
  .object({
    source: WispProfileSourceSchema,
    authorId: id().optional(),
    authorDisplayName: label().optional(),
    trainerId: id().optional(),
    tableId: id().optional(),
    tableVersion: z.string().min(1).max(WISP_PROFILE_LIMITS.maxHotkeyLength).optional(),
    importedAt: timestamp().optional(),
  })
  .strict();

export const WispGameProfileSchema = z
  .object({
    schemaVersion: z.literal(WISP_PROFILE_SCHEMA_VERSION),
    profileId: id(),
    gameId: id(),
    trainerId: id().optional(),
    tableId: id().optional(),
    tableVersion: z.string().min(1).max(WISP_PROFILE_LIMITS.maxHotkeyLength).optional(),
    source: WispProfileSourceSchema,
    // Deliberately unbounded array lengths here — count enforcement lives in
    // validation.ts so an oversized profile gets WISP_PROFILE_TOO_MANY_ACTIONS
    // / *_IN_GROUP, not a generic schema failure.
    groups: z.array(WispGroupDefinitionSchema),
    actions: z.array(WispActionDefinitionSchema),
    preferredQuickSlotCount: z.number().int().optional(),
    provenance: WispProfileProvenanceSchema.optional(),
    createdAt: timestamp().optional(),
    updatedAt: timestamp().optional(),
  })
  .strict();
