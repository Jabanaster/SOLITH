import type { BoundWispAction, BoundWispProfile } from './runtime-types.js';
import type { WispQuickSlot } from './hotkey-types.js';

/**
 * Adaptive Wisp quick-slot resolution (Increment 5, Sections 4-8).
 *
 * The logical slot model already exists — WispActionDefinition.slot
 * (Increment 1) and WispUserState.slotAssignments (Increment 2) — so this is
 * deliberately not a new slot system, just a lookup against the ALREADY
 * bound profile's `slot` field. Bound actions already reflect user overrides
 * and creator recommendations in the correct precedence (Increment 2's own
 * resolution policy), so this function has no precedence logic of its own.
 *
 * Always call this fresh against the CURRENT bound profile — never cache the
 * returned action across a game/session change (Section 7-8).
 */
export function resolveWispQuickSlotAction(boundProfile: BoundWispProfile, slot: WispQuickSlot): BoundWispAction | null {
  return boundProfile.actions.find((action) => action.slot === slot) ?? null;
}
