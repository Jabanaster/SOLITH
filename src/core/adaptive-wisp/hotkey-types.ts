import type { WispActionId, WispProfileId } from './types.js';
import type { WispActionExecutionStatus } from './execution-types.js';
import type { WispExecutionDiagnostic } from './execution-errors.js';
import type { WispHotkeyDiagnostic } from './hotkey-errors.js';

/**
 * Adaptive Wisp logical quick-slot identity (Increment 5, Section 4).
 *
 * A quick slot is presentation/input identity only — it never carries a raw
 * memory address, process ID, session token, consent token, process handle,
 * pointer, or write instruction (Section 6). It resolves to a WispActionId,
 * nothing more.
 */
export const WISP_QUICK_SLOT_COUNT = 6;
export type WispQuickSlot = 1 | 2 | 3 | 4 | 5 | 6;

export function isWispQuickSlot(value: number): value is WispQuickSlot {
  return Number.isInteger(value) && value >= 1 && value <= WISP_QUICK_SLOT_COUNT;
}

/** Result of one hotkey activation attempt (Increment 5, Section 41). No raw memory values required. */
export interface WispHotkeyActivationResult {
  slot: WispQuickSlot;
  actionId?: WispActionId;
  profileId?: WispProfileId;
  executed: boolean;
  executionStatus?: WispActionExecutionStatus;
  diagnostic?: WispExecutionDiagnostic | WispHotkeyDiagnostic;
}
