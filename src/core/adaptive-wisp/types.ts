/**
 * Adaptive Wisp domain types (Increment 1, Section 4).
 *
 * This is the game-profile subsystem — declarative per-game quick-action
 * layouts ("HP / XP / Fuel" for one game, "Minerals / Energy / Drill" for
 * another). It is a distinct concern from the existing companion mascot at
 * src/core/companion/wisp.ts (mood/message-bubble state for the assistant
 * character) — do not confuse the two or merge them here. They may be wired
 * together by a later increment; this module never imports companion/wisp.ts.
 *
 * Pure domain infrastructure only: no trainer writes, no live sessions, no
 * IPC, no memory access. See Docs/Architecture/ADAPTIVE_WISP_PLATFORM.md.
 */
import type { WispProfileValidationIssue } from './errors.js';

export type WispProfileSchemaVersion = number;
export type WispProfileId = string;
export type WispActionId = string;
export type WispGroupId = string;

/** Opaque reference to an existing trainer/cheat entry (CheatDefinition.id in cheat-system/types.ts). Never a raw address, script, or process handle. */
export type CanonicalTrainerEntryId = string;

/** Reuses canonical-games' identity space (CanonicalGame.id) — never a display name. */
export type CanonicalGameId = string;

export type WispProfileSource = 'builtin' | 'generated' | 'creator' | 'community' | 'user';

export type WispControlType = 'toggle' | 'freeze' | 'set' | 'increment' | 'multiplier' | 'cycle' | 'momentary';

export interface WispPreset {
  id: string;
  label: string;
  /** Declarative value only — never a function, formula string, or expression to evaluate. */
  value: number | string | boolean;
}

export interface WispActionDefinition {
  id: WispActionId;
  /** References an existing trainer entry by opaque id. Resolving/validating this against a live entry belongs to a later runtime-binding increment. */
  entryId: CanonicalTrainerEntryId;

  label: string;
  shortLabel?: string;
  description?: string;

  groupId?: WispGroupId;

  controlType: WispControlType;

  /** Recommended logical quick slot (1-6) — physical key mapping is a later hotkey increment's concern. */
  slot?: number;
  priority?: number;

  defaultHotkey?: string;

  presets?: WispPreset[];

  iconId?: string;

  enabled?: boolean;
}

export interface WispGroupDefinition {
  id: WispGroupId;
  label: string;
  shortLabel?: string;
  order: number;
  actionIds: WispActionId[];
}

export interface WispProfileProvenance {
  source: WispProfileSource;
  authorId?: string;
  authorDisplayName?: string;
  trainerId?: string;
  tableId?: string;
  tableVersion?: string;
  importedAt?: string;
}

export interface WispGameProfile {
  schemaVersion: WispProfileSchemaVersion;

  profileId: WispProfileId;
  gameId: CanonicalGameId;

  trainerId?: string;
  tableId?: string;
  tableVersion?: string;

  source: WispProfileSource;

  groups: WispGroupDefinition[];
  actions: WispActionDefinition[];

  preferredQuickSlotCount?: number;

  provenance?: WispProfileProvenance;

  createdAt?: string;
  updatedAt?: string;
}

/** Context used to narrow registry queries — the same shape doubles as compatibility-scoping metadata (Section 4's WispProfileCompatibilityMetadata). Precedence among matches is the future resolver's job, not the registry's. */
export interface WispProfileCompatibilityMetadata {
  gameId: CanonicalGameId;
  trainerId?: string;
  tableId?: string;
}

export type WispProfileRegistryQuery = WispProfileCompatibilityMetadata;

export interface WispProfileValidationResult {
  valid: boolean;
  issues: WispProfileValidationIssue[];
}

export type WispProfileRegistration =
  | { ok: true; profile: WispGameProfile }
  | { ok: false; issues: WispProfileValidationIssue[] };
