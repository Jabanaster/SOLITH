import type { WispActionId, WispProfileId } from './types.js';
import type { WispExecutionDiagnostic } from './execution-errors.js';

/**
 * Adaptive Wisp action execution request/result model (Increment 4, Sections
 * 8-9, 30-31). A strict discriminated union by `control` — no generic
 * `execute(operation: string, payload: unknown)` escape hatch (Section 30),
 * so adding a new control type forces every switch/handler to be updated
 * (exhaustive handling, Section 31).
 *
 * Deliberately excludes anything that could reach a raw memory operation
 * directly: no address, pointer, pid, or process handle field exists on any
 * variant — see `validateWispExecutionRequestShape` for the runtime
 * backstop proving such fields are rejected even if a caller tries to add
 * one (Section 29).
 */

export type WispSafeDisplayValue = number | string | boolean;

interface WispActionExecutionRequestBase {
  actionId: WispActionId;
  profileId: WispProfileId;
  /** Pass-through only — Wisp never mints a consent token itself (Section 21); this is either absent (first call, propose-only) or a token already obtained through SOLITH's existing consent workflow. */
  consentToken?: string;
  /**
   * Increment 4C — when confirming, the exact proposalId the caller obtained
   * from the prior propose-only call's `pendingConsent` result. Every
   * executor call stages a fresh canonical proposal; without this, a
   * consent token obtained for that first proposal could never validate
   * against a second, independently re-proposed one (a real canonical
   * consent binding hashes in the exact proposalId). Absent on the
   * propose-only call; required alongside `consentToken` to confirm.
   */
  proposalId?: string;
}

export interface WispToggleRequest extends WispActionExecutionRequestBase {
  control: 'toggle';
}

export interface WispFreezeRequest extends WispActionExecutionRequestBase {
  control: 'freeze';
  enable: boolean;
  presetId?: string;
  intervalMs?: number;
}

export interface WispSetRequest extends WispActionExecutionRequestBase {
  control: 'set';
  value: WispSafeDisplayValue;
}

export interface WispIncrementRequest extends WispActionExecutionRequestBase {
  control: 'increment';
  presetId: string;
}

export interface WispMultiplierRequest extends WispActionExecutionRequestBase {
  control: 'multiplier';
  presetId: string;
}

export interface WispCycleRequest extends WispActionExecutionRequestBase {
  control: 'cycle';
}

export interface WispMomentaryRequest extends WispActionExecutionRequestBase {
  control: 'momentary';
  presetId?: string;
}

export type WispActionExecutionRequest = WispToggleRequest | WispFreezeRequest | WispSetRequest | WispIncrementRequest | WispMultiplierRequest | WispCycleRequest | WispMomentaryRequest;

export type WispActionExecutionStatus = 'applied' | 'enabled' | 'disabled' | 'frozen' | 'unfrozen' | 'pending-consent' | 'rejected' | 'stale' | 'unavailable' | 'failed';

export interface WispActionExecutionResult {
  ok: boolean;
  actionId: WispActionId;
  status: WispActionExecutionStatus;
  currentValue?: WispSafeDisplayValue;
  diagnostic?: WispExecutionDiagnostic;
  /** Set only on a `pending-consent` result — the caller must echo this back as the request's `proposalId` on the confirming call (Section 10, Increment 4C). */
  proposalId?: string;
}

const REQUEST_SHAPE_FORBIDDEN_KEYS = new Set(['address', 'pointer', 'pid', 'processhandle', 'handle', 'rawaddress', 'pointeraddress', 'processid']);

/**
 * Runtime backstop (Section 29) — even though the TypeScript union has no
 * such fields, this proves an object claiming to be a request with one of
 * these keys is rejected before the executor ever looks at it. Mirrors
 * security-scan.ts's field-name-blocklist pattern rather than trusting
 * types alone (defense in depth, same discipline as Increment 1).
 */
export function validateWispExecutionRequestShape(raw: unknown): { ok: true } | { ok: false; rejectedKey: string } {
  if (raw === null || typeof raw !== 'object') return { ok: true };
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (REQUEST_SHAPE_FORBIDDEN_KEYS.has(key.toLowerCase())) return { ok: false, rejectedKey: key };
  }
  return { ok: true };
}
