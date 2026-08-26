import type { WispActionDefinition } from './types.js';
import type { WispActionExecutionRequest, WispSafeDisplayValue } from './execution-types.js';
import { executeWispAction, type WispActionExecutorDeps } from './wisp-action-executor.js';
import type { WispRuntimeContext } from './runtime-types.js';
import { hotkeyDiagnostic } from './hotkey-errors.js';
import { resolveWispQuickSlotAction } from './quick-slot-resolution.js';
import type { WispActiveProfileProvider } from './active-profile-provider.js';
import type { WispHotkeyActivationResult, WispQuickSlot } from './hotkey-types.js';

/**
 * Adaptive Wisp quick-slot hotkey controller (Increment 5, Sections 14-15).
 *
 * The ONLY place a hotkey activation touches Adaptive Wisp domain logic.
 * Every activation calls the already-reviewed Increment 4 `executeWispAction`
 * — this module never calls MemoryManager/LiveMemorySession/consent/freeze
 * directly (enforced by the static boundary test, same as the rest of
 * src/core/adaptive-wisp/).
 *
 * Holds only minimal presentation-adjacent state: which actions currently
 * have a pending-consent proposal outstanding, and (for freeze only) which
 * enable/disable intent the next press should send. It owns no process
 * handle, no consent authority, no memory address, no freeze worker, no
 * canonical write state (Section 15).
 */
export interface WispQuickSlotControllerDeps {
  activeProfileProvider: WispActiveProfileProvider;
  getCurrentContext: () => WispRuntimeContext | null;
  executorDeps: WispActionExecutorDeps;
}

export interface WispQuickSlotController {
  activate(slot: WispQuickSlot): Promise<WispHotkeyActivationResult>;
}

export function createWispQuickSlotController(deps: WispQuickSlotControllerDeps): WispQuickSlotController {
  // Per-action, in-memory only — never persisted (Section 27), never keyed
  // by session/PID (Section 45). Cleared whenever an activation reaches a
  // terminal (non-pending) result so a later legitimate retry is never
  // permanently blocked.
  const pendingProposalByAction = new Map<string, string>();
  // Discrete freeze enable/disable intent per action (Section 36 — no
  // keydown/keyup hold semantics; each deliberate press flips the intent).
  const freezeEnableIntentByAction = new Map<string, boolean>();

  return {
    async activate(slot: WispQuickSlot): Promise<WispHotkeyActivationResult> {
      const snapshot = await deps.activeProfileProvider.getActiveBoundProfile();
      if (!snapshot) {
        return { slot, executed: false, diagnostic: hotkeyDiagnostic('WISP_HOTKEY_NO_ACTIVE_SESSION', 'no active Wisp session/profile is currently bound') };
      }

      const boundAction = resolveWispQuickSlotAction(snapshot.bound, slot);
      if (!boundAction) {
        return { slot, profileId: snapshot.bound.profileId, executed: false, diagnostic: hotkeyDiagnostic('WISP_HOTKEY_SLOT_EMPTY', `quick slot ${slot} has no assigned action`, { slot }) };
      }

      if (!boundAction.binding || boundAction.availability !== 'available') {
        return {
          slot,
          actionId: boundAction.actionId,
          profileId: snapshot.bound.profileId,
          executed: false,
          diagnostic: hotkeyDiagnostic('WISP_HOTKEY_ACTION_UNAVAILABLE', `quick slot ${slot} action "${boundAction.actionId}" is not currently available (${boundAction.availability})`, { slot, actionId: boundAction.actionId }),
        };
      }

      // Section 34 policy B — suppress a duplicate proposal for the same
      // action while one is already pending, rather than silently letting
      // a second proposal race the first (never auto-consume the first
      // proposal's consent for a second one either way — each is independent).
      if (pendingProposalByAction.has(boundAction.actionId)) {
        return {
          slot,
          actionId: boundAction.actionId,
          profileId: snapshot.bound.profileId,
          executed: false,
          diagnostic: hotkeyDiagnostic('WISP_HOTKEY_EXECUTION_PENDING_CONSENT', `quick slot ${slot} action "${boundAction.actionId}" already has a pending consent proposal`, { slot, actionId: boundAction.actionId }),
        };
      }

      const actionDefinition = snapshot.rawProfile.actions.find((a) => a.id === boundAction.actionId) ?? null;
      if (!actionDefinition) {
        return {
          slot,
          actionId: boundAction.actionId,
          profileId: snapshot.bound.profileId,
          executed: false,
          diagnostic: hotkeyDiagnostic('WISP_HOTKEY_ACTION_UNAVAILABLE', `quick slot ${slot} action "${boundAction.actionId}" has no matching action definition`, { slot, actionId: boundAction.actionId }),
        };
      }

      const built = buildDefaultRequest(boundAction.actionId, snapshot.bound.profileId, actionDefinition, freezeEnableIntentByAction);
      if (built.ok === false) {
        return { slot, actionId: boundAction.actionId, profileId: snapshot.bound.profileId, executed: false, diagnostic: built.diagnostic };
      }

      // Re-fetch context immediately before executing — use-time resolution,
      // not the context snapshot the profile/binding were resolved against a
      // moment ago (Section 42's game/session race). executeWispAction's own
      // validateWispBinding is the authority here; this just ensures we hand
      // it the freshest possible context rather than a stale local copy.
      const currentContext = deps.getCurrentContext();
      const result = await executeWispAction(built.request, actionDefinition, boundAction.binding, currentContext, deps.executorDeps);

      if (result.status === 'pending-consent' && result.proposalId) {
        pendingProposalByAction.set(boundAction.actionId, result.proposalId);
      } else {
        pendingProposalByAction.delete(boundAction.actionId);
      }

      return {
        slot,
        actionId: boundAction.actionId,
        profileId: snapshot.bound.profileId,
        executed: true,
        executionStatus: result.status,
        diagnostic: result.diagnostic,
      };
    },
  };
}

export type WispHotkeyBuildRequestResult = { ok: true; request: WispActionExecutionRequest } | { ok: false; diagnostic: ReturnType<typeof hotkeyDiagnostic> };

/**
 * Builds the first-press (propose-only, no consentToken) request for a slot
 * activation. Never prompts for arbitrary input (Section 37) — every value
 * comes from the action's own declared presets/current state, exactly the
 * same semantics computeRequestedValue (Increment 4) already enforces.
 *
 * Exported for direct unit testing of the per-control default-request
 * semantics (Section 72) without needing to drive the whole controller /
 * pending-consent suppression dance.
 */
export function buildDefaultRequest(actionId: string, profileId: string, actionDefinition: WispActionDefinition, freezeEnableIntentByAction: Map<string, boolean>): WispHotkeyBuildRequestResult {
  switch (actionDefinition.controlType) {
    case 'toggle':
      return { ok: true, request: { control: 'toggle', actionId, profileId } };

    case 'cycle':
      return { ok: true, request: { control: 'cycle', actionId, profileId } };

    case 'freeze': {
      const enable = freezeEnableIntentByAction.get(actionId) ?? true;
      freezeEnableIntentByAction.set(actionId, !enable);
      return { ok: true, request: { control: 'freeze', actionId, profileId, enable } };
    }

    case 'set': {
      const value = actionDefinition.presets?.[0]?.value;
      if (value === undefined) {
        return { ok: false, diagnostic: hotkeyDiagnostic('WISP_HOTKEY_NO_DEFAULT_VALUE', `action "${actionId}" has control type "set" but declares no preset for hotkey activation to use`, { actionId }) };
      }
      return { ok: true, request: { control: 'set', actionId, profileId, value: value as WispSafeDisplayValue } };
    }

    case 'increment':
    case 'multiplier': {
      const presetId = actionDefinition.presets?.[0]?.id;
      if (presetId === undefined) {
        return { ok: false, diagnostic: hotkeyDiagnostic('WISP_HOTKEY_NO_DEFAULT_VALUE', `action "${actionId}" has control type "${actionDefinition.controlType}" but declares no preset for hotkey activation to use`, { actionId }) };
      }
      return { ok: true, request: { control: actionDefinition.controlType, actionId, profileId, presetId } as WispActionExecutionRequest };
    }

    case 'momentary': {
      const presetId = actionDefinition.presets?.[0]?.id;
      if (presetId === undefined) {
        return { ok: false, diagnostic: hotkeyDiagnostic('WISP_HOTKEY_NO_DEFAULT_VALUE', `action "${actionId}" has control type "momentary" but declares no preset for hotkey activation to use`, { actionId }) };
      }
      return { ok: true, request: { control: 'momentary', actionId, profileId, presetId } };
    }
  }
}
