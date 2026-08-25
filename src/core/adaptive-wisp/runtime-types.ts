import type { CanonicalGameId, CanonicalTrainerEntryId, WispActionId, WispControlType, WispGroupId, WispProfileId, WispProfileSource } from './types.js';
import type { WispBindingDiagnostic } from './binding-errors.js';

/**
 * Adaptive Wisp runtime-binding domain types (Increment 3, Sections 4, 52-55).
 *
 * A resolved profile (resolution-types.ts) answers "which profile applies to
 * this game/trainer/table?" — declarative, no live process involved. A
 * runtime binding answers a different question: "is THIS profile action
 * valid for the CURRENT attached session, right now?" It never contains raw
 * memory addresses, process handles, or tokens — see Section 3.
 */

export interface WispRuntimeContext {
  gameId: CanonicalGameId;

  trainerId?: string;
  tableId?: string;
  tableVersion?: string;

  sessionId: string;
  sessionGeneration: number;
}

export type WispActionAvailability =
  | 'available'
  | 'detached'
  | 'missing-entry'
  | 'wrong-game'
  | 'wrong-trainer'
  | 'wrong-table'
  | 'stale-session'
  | 'unsupported'
  | 'incompatible'
  | 'disabled'
  | 'unauthorized';

/** Safe, read-only, normalized snapshot of a trainer entry — never the live mutable trainer object (Section 55-56). */
export interface WispBoundEntryDescriptor {
  id: CanonicalTrainerEntryId;
  label: string;
  dataType: string;
  compatibility?: string;
  enabled: boolean;
}

export interface WispRuntimeBinding {
  actionId: WispActionId;
  entryId: CanonicalTrainerEntryId;

  gameId: CanonicalGameId;
  trainerId?: string;
  tableId?: string;

  sessionId: string;
  sessionGeneration: number;

  availability: WispActionAvailability;

  boundAt: string;
}

export interface BoundWispAction {
  actionId: WispActionId;
  entryId: CanonicalTrainerEntryId;

  label: string;
  shortLabel?: string;

  controlType: WispControlType;
  slot?: number;

  availability: WispActionAvailability;

  binding?: WispRuntimeBinding;
  entryDescriptor?: WispBoundEntryDescriptor;

  diagnostics?: WispBindingDiagnostic[];
}

export interface BoundWispGroup {
  id: WispGroupId;
  label: string;
  shortLabel?: string;
  order: number;
  actionIds: WispActionId[];
}

export interface BoundWispProfile {
  profileId: WispProfileId;
  gameId: CanonicalGameId;

  source: WispProfileSource;

  sessionId: string;
  sessionGeneration: number;

  groups: BoundWispGroup[];
  actions: BoundWispAction[];

  diagnostics: WispBindingDiagnostic[];
}

/** Whole-profile rejection — a trust-boundary mismatch (Section 23), distinct from a per-action availability degradation (Section 24). */
export type WispProfileBindingResult = { ok: true; profile: BoundWispProfile } | { ok: false; diagnostics: WispBindingDiagnostic[] };
