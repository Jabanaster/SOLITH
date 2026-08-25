import type { CanonicalGameId, CanonicalTrainerEntryId, WispControlType } from './types.js';
import type { WispSafeDisplayValue } from './execution-types.js';

/**
 * Adaptive Wisp canonical trainer execution adapter (Increment 4, Section
 * 27). Injected — the executor never imports live-memory/cheat-system
 * write internals directly, matching Increment 3's entry-lookup pattern.
 *
 * Audit finding: SOLITH has no separate "enable"/"disable"/"momentary"
 * primitives — `useGameCheatSession.ts`'s toggle/set/momentary all funnel
 * through the same propose→consent→confirm write sequence
 * (`MemoryManager.proposeWrite`/`confirmWrite`). This interface mirrors
 * that reality (one write pipeline) rather than inventing parallel
 * enable()/disable()/set() methods that would require a duplicate real
 * implementation (Section 27's "do not create fake abstractions").
 *
 * `supportsControls` on the returned state is the AUTHORITATIVE
 * compatibility source (Section 25) — the executor never lets profile
 * metadata override it.
 */
export interface WispTrainerEntryState {
  enabled?: boolean;
  frozen?: boolean;
  currentValue?: WispSafeDisplayValue;
  dataType: string;
  supportsControls: WispControlType[];
}

export interface WispCanonicalProposal {
  proposalId: string;
}

export type WispCanonicalWriteOutcome =
  | { ok: true; status: 'applied' | 'enabled' | 'disabled' | 'frozen' | 'unfrozen'; currentValue?: WispSafeDisplayValue }
  | { ok: false; status: 'rejected' | 'failed'; reason: string };

export interface WispTrainerExecutionAdapter {
  /** Re-resolves current authoritative state — never a stale retained mutable object (Section 7). */
  getCurrentState(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId): WispTrainerEntryState | null;

  /** Stages a write (enable/disable/set/increment/multiplier/cycle/momentary-as-set all route here). Returns null when the entry cannot accept a write proposal at all (missing/incompatible). */
  proposeWrite(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId, requestedValue: WispSafeDisplayValue): WispCanonicalProposal | null;
  /** Consumes a consent token already obtained through SOLITH's existing consent workflow — Wisp never mints one (Section 21). */
  confirmWrite(proposalId: string, consentToken: string): WispCanonicalWriteOutcome;

  proposeFreeze(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId, value: WispSafeDisplayValue, intervalMs?: number): WispCanonicalProposal | null;
  confirmFreeze(proposalId: string, consentToken: string): WispCanonicalWriteOutcome;
  /** Freeze-stop is not consent-gated in the canonical path (per audit) — direct call, no proposal phase. */
  stopFreeze(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId): WispCanonicalWriteOutcome;
}
