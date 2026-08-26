import type { WispActionId, WispProfileId } from './types.js';

/** Adaptive Wisp hotkey diagnostic codes (Increment 5, Section 40). Distinct from execution diagnostics — these describe why an activation never reached the executor, or why it did. */
export type WispHotkeyDiagnosticCode =
  | 'WISP_HOTKEY_NO_ACTIVE_SESSION'
  | 'WISP_HOTKEY_SLOT_EMPTY'
  | 'WISP_HOTKEY_ACTION_UNAVAILABLE'
  | 'WISP_HOTKEY_NO_DEFAULT_VALUE'
  | 'WISP_HOTKEY_EXECUTION_PENDING_CONSENT'
  | 'WISP_HOTKEY_CONFLICT';

export interface WispHotkeyDiagnostic {
  code: WispHotkeyDiagnosticCode;
  message: string;
  slot?: number;
  actionId?: WispActionId;
  profileId?: WispProfileId;
}

export function hotkeyDiagnostic(code: WispHotkeyDiagnosticCode, message: string, extra?: Omit<WispHotkeyDiagnostic, 'code' | 'message'>): WispHotkeyDiagnostic {
  return extra ? { code, message, ...extra } : { code, message };
}
