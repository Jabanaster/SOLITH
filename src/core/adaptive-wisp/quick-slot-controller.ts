import type { WispActionDefinition } from './types.js';
import type { WispActionExecutionRequest, WispSafeDisplayValue } from './execution-types.js';
import { executeWispAction, type WispActionExecutorDeps } from './wisp-action-executor.js';
import type { BoundWispAction, BoundWispProfile, WispRuntimeContext } from './runtime-types.js';
import { hotkeyDiagnostic } from './hotkey-errors.js';
import { resolveWispQuickSlotAction } from './quick-slot-resolution.js';
import type { WispActiveProfileProvider, WispActiveWispProfileSnapshot } from './active-profile-provider.js';
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
  /**
   * Phase 1 consent completion — fired the moment an activation stages a new
   * `pending-consent` proposal, with everything the consent layer needs to
   * create its own renderer-facing `WispConsentProposal` (see
   * src/core/adaptive-wisp/consent/). This controller stays unaware of that
   * domain model on purpose (Section 6's "no second competing consent
   * system" cuts both ways — the consent layer must not duplicate THIS
   * controller's activation/binding logic, and this controller must not
   * duplicate the consent layer's proposal/audit logic).
   */
  onPendingConsent?: (info: WispPendingConsentInfo) => void;
  /**
   * Fired whenever this controller's own epoch-guarded presentation state is
   * reset by a detected context/profile transition (detach, reattach, PID
   * change, session-generation change, game change, profile change —
   * Section 22). `previousContextIdentity`/`previousProfileIdentity` are the
   * identity keys the state was scoped to BEFORE the reset, so the consent
   * layer can invalidate every `WispConsentProposal` that was bound to that
   * now-stale identity.
   */
  onPresentationStateReset?: (previous: { contextIdentity: string | null; profileIdentity: string | null }) => void;
}

export interface WispPendingConsentInfo {
  slot: WispQuickSlot;
  lowLevelProposalId: string;
  request: WispActionExecutionRequest;
  requestedValue: WispSafeDisplayValue;
  boundAction: BoundWispAction;
  actionDefinition: WispActionDefinition;
  boundProfile: BoundWispProfile;
  context: WispRuntimeContext;
}

export interface WispQuickSlotController {
  activate(slot: WispQuickSlot): Promise<WispHotkeyActivationResult>;
  /**
   * Phase 1 consent completion — re-resolves the CURRENT binding/context
   * fresh (Section 10's requery/reverify steps) and, if a matching pending
   * activation is still on file for this slot, replays the EXACT original
   * request (never rebuilt — Section 7's "approval must not resubmit or
   * override the value") with the given one-use consent token attached.
   * Returns the same shape as activate() so callers treat both uniformly.
   */
  confirmPending(slot: WispQuickSlot, lowLevelProposalId: string, consentToken: string): Promise<WispHotkeyActivationResult>;
  /**
   * Clears all controller-owned presentation state (pending-consent map,
   * freeze-intent map) and forgets the last-observed context/profile
   * identity, without touching consent, memory, freeze, or attach state
   * (Increment 5 closeout, Phase A). Safe to call multiple times (idempotent)
   * and safe to call when no activation has ever occurred. Intended for
   * feature-disable and application-shutdown composition call sites — see
   * electron/trainer-hotkeys.ts's unregisterTrainerHotkeys().
   */
  dispose(): void;
}

/**
 * Identity of the authority context an activation's presentation state
 * (pending-consent, freeze-intent) is scoped to. `null` means "no active
 * context" (detached/no session). Built ONLY from fields the existing
 * session-monitor/live-memory architecture already produces (gameId,
 * sessionId, sessionGeneration — see runtime-types.ts) plus the resolved
 * profile's own identity — never a bare PID, executable substring, or
 * display name (Increment 5 closeout, Phase A "Context identity").
 * sessionGeneration already changes whenever verified process identity
 * changes (session-context.ts's tracker keys generation on (pid,
 * processStartTime)), so a separate process-identity field is unnecessary.
 */
function contextIdentityKey(context: WispRuntimeContext | null): string | null {
  if (!context) return null;
  return `${context.gameId}:${context.sessionId}:${context.sessionGeneration}`;
}

interface PendingActivation {
  lowLevelProposalId: string;
  request: WispActionExecutionRequest;
}

export function createWispQuickSlotController(deps: WispQuickSlotControllerDeps): WispQuickSlotController {
  // Per-action, in-memory only — never persisted (Section 27), never keyed
  // by session/PID (Section 45). Keyed by `${gameId}:${actionId}`, not bare
  // actionId — actionId is only unique WITHIN one profile; two different
  // games' profiles may coincidentally declare the same actionId string for
  // two entirely unrelated actions (review-discovered finding, Increment 5
  // remediation). A bare-actionId key would let a pending/intent entry from
  // one game silently apply to an unrelated action in a different game after
  // a switch. Cleared whenever an activation reaches a terminal (non-pending)
  // result so a later legitimate retry is never permanently blocked, AND
  // whenever the authority context transitions (see below). Values now carry
  // the exact request that was proposed (Phase 1) so confirmPending() can
  // replay it verbatim rather than rebuilding it.
  let pendingActivationByKey = new Map<string, PendingActivation>();
  // Discrete freeze enable/disable intent per action (Section 36 — no
  // keydown/keyup hold semantics; each deliberate press flips the intent).
  // Same game-scoped key rationale as above.
  let freezeEnableIntentByKey = new Map<string, boolean>();

  // Increment 5 closeout, Phase A — deterministic pending-state lifecycle.
  // `lastContextIdentity`/`lastProfileIdentity` remember the authority
  // context and bound-profile identity the CURRENT contents of the two maps
  // above were built under. `epoch` increments every time either map is
  // reset by a detected transition; an in-flight activation captures the
  // epoch it started under and refuses to write into the maps if the epoch
  // has since moved on — this is what prevents a late-completing activation
  // from an old game/session/profile from resurrecting state that a newer
  // activation already correctly cleared (the race the closeout spec calls
  // out explicitly: "a late result from an old session must not recreate
  // deleted state").
  let lastContextIdentity: string | null = null;
  let lastProfileIdentity: string | null = null;
  let epoch = 0;

  function resetPresentationState(): void {
    const previous = { contextIdentity: lastContextIdentity, profileIdentity: lastProfileIdentity };
    pendingActivationByKey = new Map<string, PendingActivation>();
    freezeEnableIntentByKey = new Map<string, boolean>();
    epoch += 1;
    // Phase 1 consent completion — notify AFTER the local reset so a
    // synchronous listener that calls back into this controller never
    // observes half-reset state.
    if (previous.contextIdentity !== null || previous.profileIdentity !== null) {
      deps.onPresentationStateReset?.(previous);
    }
  }

  /**
   * Re-synchronizes controller-owned state against the CURRENT authority
   * context before doing anything else in an activation. Idempotent — an
   * unchanged identity (including two consecutive detached reads) is a
   * no-op, so legitimate pending state survives repeated reads with no
   * transition. Returns the epoch this call observed, for the caller to
   * compare against after any subsequent await.
   */
  function syncContextIdentity(context: WispRuntimeContext | null): number {
    const identity = contextIdentityKey(context);
    if (identity !== lastContextIdentity) {
      resetPresentationState();
      lastContextIdentity = identity;
      lastProfileIdentity = null; // profile identity is only meaningful within one context; force re-check below
    }
    return epoch;
  }

  function syncProfileIdentity(profileId: string): number {
    if (profileId !== lastProfileIdentity) {
      resetPresentationState();
      lastProfileIdentity = profileId;
    }
    return epoch;
  }

  type ResolvedActivationTarget =
    | { ok: false; result: WispHotkeyActivationResult }
    | { ok: true; snapshot: WispActiveWispProfileSnapshot; boundAction: BoundWispAction; actionDefinition: WispActionDefinition; stateKey: string; epochAtActivation: number };

  /**
   * Shared resolution prefix for both `activate()` and `confirmPending()`
   * (Section 10 requires approval to requery/reverify session, PID,
   * executable identity, game, profile, and binding fresh — reusing this one
   * code path is what guarantees confirmPending() re-derives all of that the
   * same way activate() does, rather than trusting anything cached).
   */
  async function resolveActivationTarget(slot: WispQuickSlot): Promise<ResolvedActivationTarget> {
    const contextForIdentity = deps.getCurrentContext();
    const epochAfterContextSync = syncContextIdentity(contextForIdentity);

    const snapshot = await deps.activeProfileProvider.getActiveBoundProfile();
    if (!snapshot) {
      return { ok: false, result: { slot, executed: false, diagnostic: hotkeyDiagnostic('WISP_HOTKEY_NO_ACTIVE_SESSION', 'no active Wisp session/profile is currently bound') } };
    }

    // Profile-replacement cleanup: even when gameId/session are unchanged,
    // a re-resolved profile with a different profileId (e.g. active table
    // or table version changed) must not inherit the prior profile's
    // pending/freeze state.
    const epochAfterProfileSync = syncProfileIdentity(snapshot.bound.profileId);

    const boundAction = resolveWispQuickSlotAction(snapshot.bound, slot);
    if (!boundAction) {
      return { ok: false, result: { slot, profileId: snapshot.bound.profileId, executed: false, diagnostic: hotkeyDiagnostic('WISP_HOTKEY_SLOT_EMPTY', `quick slot ${slot} has no assigned action`, { slot }) } };
    }

    if (!boundAction.binding || boundAction.availability !== 'available') {
      return {
        ok: false,
        result: {
          slot,
          actionId: boundAction.actionId,
          profileId: snapshot.bound.profileId,
          executed: false,
          diagnostic: hotkeyDiagnostic('WISP_HOTKEY_ACTION_UNAVAILABLE', `quick slot ${slot} action "${boundAction.actionId}" is not currently available (${boundAction.availability})`, { slot, actionId: boundAction.actionId }),
        },
      };
    }

    const actionDefinition = snapshot.rawProfile.actions.find((a) => a.id === boundAction.actionId) ?? null;
    if (!actionDefinition) {
      return {
        ok: false,
        result: {
          slot,
          actionId: boundAction.actionId,
          profileId: snapshot.bound.profileId,
          executed: false,
          diagnostic: hotkeyDiagnostic('WISP_HOTKEY_ACTION_UNAVAILABLE', `quick slot ${slot} action "${boundAction.actionId}" has no matching action definition`, { slot, actionId: boundAction.actionId }),
        },
      };
    }

    const stateKey = `${snapshot.bound.gameId}:${boundAction.actionId}`;
    const epochAtActivation = Math.max(epochAfterContextSync, epochAfterProfileSync);
    return { ok: true, snapshot, boundAction, actionDefinition, stateKey, epochAtActivation };
  }

  return {
    async activate(slot: WispQuickSlot): Promise<WispHotkeyActivationResult> {
      // Use-time resolution (Section 8) — see resolveActivationTarget's own
      // doc comment for why this prefix is shared with confirmPending().
      const resolved = await resolveActivationTarget(slot);
      if (resolved.ok === false) return resolved.result;
      const { snapshot, boundAction, actionDefinition, stateKey, epochAtActivation } = resolved;

      // Section 34 policy B — suppress a duplicate proposal for the same
      // action while one is already pending, rather than silently letting
      // a second proposal race the first (never auto-consume the first
      // proposal's consent for a second one either way — each is independent).
      if (pendingActivationByKey.has(stateKey)) {
        return {
          slot,
          actionId: boundAction.actionId,
          profileId: snapshot.bound.profileId,
          executed: false,
          diagnostic: hotkeyDiagnostic('WISP_HOTKEY_EXECUTION_PENDING_CONSENT', `quick slot ${slot} action "${boundAction.actionId}" already has a pending consent proposal`, { slot, actionId: boundAction.actionId }),
        };
      }

      const built = buildDefaultRequest(boundAction.actionId, stateKey, snapshot.bound.profileId, actionDefinition, freezeEnableIntentByKey);
      if (built.ok === false) {
        return { slot, actionId: boundAction.actionId, profileId: snapshot.bound.profileId, executed: false, diagnostic: built.diagnostic };
      }
      const request = built.request;

      // Re-fetch context immediately before executing — use-time resolution,
      // not the context snapshot the profile/binding were resolved against a
      // moment ago (Section 42's game/session race). executeWispAction's own
      // validateWispBinding is the authority here; this just ensures we hand
      // it the freshest possible context rather than a stale local copy.
      const currentContext = deps.getCurrentContext();
      const result = await executeWispAction(request, actionDefinition, boundAction.binding!, currentContext, deps.executorDeps);

      // Epoch guard: if the authority context/profile transitioned WHILE
      // this activation's executeWispAction call was in flight, the maps
      // above have already been reset for the new epoch by a later
      // activate() call's syncContextIdentity/syncProfileIdentity. Writing
      // this late result into them under the OLD stateKey would silently
      // resurrect state the newer activation correctly cleared. The request
      // still executed for real (executeWispAction's own validateWispBinding
      // is the authority on whether the mutation itself was allowed) — only
      // this controller's own bookkeeping is skipped.
      if (epoch === epochAtActivation) {
        if (result.status === 'pending-consent' && result.proposalId && result.requestedValue !== undefined && currentContext) {
          pendingActivationByKey.set(stateKey, { lowLevelProposalId: result.proposalId, request });
          deps.onPendingConsent?.({
            slot,
            lowLevelProposalId: result.proposalId,
            request,
            requestedValue: result.requestedValue,
            boundAction,
            actionDefinition,
            boundProfile: snapshot.bound,
            context: currentContext,
          });
        } else {
          pendingActivationByKey.delete(stateKey);
        }
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

    async confirmPending(slot: WispQuickSlot, lowLevelProposalId: string, consentToken: string): Promise<WispHotkeyActivationResult> {
      const resolved = await resolveActivationTarget(slot);
      if (resolved.ok === false) return resolved.result;
      const { snapshot, boundAction, actionDefinition, stateKey, epochAtActivation } = resolved;

      const pending = pendingActivationByKey.get(stateKey);
      if (!pending || pending.lowLevelProposalId !== lowLevelProposalId) {
        return {
          slot,
          actionId: boundAction.actionId,
          profileId: snapshot.bound.profileId,
          executed: false,
          diagnostic: hotkeyDiagnostic('WISP_HOTKEY_EXECUTION_PENDING_CONSENT', `quick slot ${slot} action "${boundAction.actionId}" has no matching pending consent proposal — it may already be resolved or the session has changed`, { slot, actionId: boundAction.actionId }),
        };
      }

      // Replay the ORIGINAL request verbatim, only adding the token/proposal
      // id — never rebuilt (Section 7: approval must reference only the
      // proposal id, never resubmit or override value/address/game/action).
      const confirmRequest: WispActionExecutionRequest = { ...pending.request, consentToken, proposalId: lowLevelProposalId };

      const currentContext = deps.getCurrentContext();
      const result = await executeWispAction(confirmRequest, actionDefinition, boundAction.binding!, currentContext, deps.executorDeps);

      if (epoch === epochAtActivation) {
        pendingActivationByKey.delete(stateKey);
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

    dispose(): void {
      resetPresentationState();
      lastContextIdentity = null;
      lastProfileIdentity = null;
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
 *
 * `intentKey` (game-scoped, e.g. `${gameId}:${actionId}`) is deliberately
 * separate from `actionId` (the request's real action identity) — using the
 * bare actionId as the freeze-intent map key let a stale intent from one
 * game's action silently apply to a different game's action that happens to
 * declare the same actionId string (review-discovered finding, Increment 5
 * remediation).
 */
export function buildDefaultRequest(actionId: string, intentKey: string, profileId: string, actionDefinition: WispActionDefinition, freezeEnableIntentByKey: Map<string, boolean>): WispHotkeyBuildRequestResult {
  switch (actionDefinition.controlType) {
    case 'toggle':
      return { ok: true, request: { control: 'toggle', actionId, profileId } };

    case 'cycle':
      return { ok: true, request: { control: 'cycle', actionId, profileId } };

    case 'freeze': {
      const enable = freezeEnableIntentByKey.get(intentKey) ?? true;
      freezeEnableIntentByKey.set(intentKey, !enable);
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
