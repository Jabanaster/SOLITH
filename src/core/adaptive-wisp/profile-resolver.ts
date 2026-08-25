import { compareCandidates, isEligibleForAutomaticPrecedence, isProfileApplicable } from './resolution-policy.js';
import { WISP_PROFILE_LIMITS } from './limits.js';
import type { WispActionDefinition, WispGameProfile, WispGroupDefinition, WispProfileSource } from './types.js';
import type { WispUserOverride } from './user-state-schema.js';
import type { WispProfileResolutionResult, WispResolutionContext, WispResolutionDiagnostic, WispResolutionDiagnosticCode } from './resolution-types.js';

/**
 * Adaptive Wisp deterministic profile resolver (Increment 2, Sections
 * 21, 24, 36). Pure — takes a candidate list, a context, and (optionally) a
 * loaded WispUserState and returns a resolution. Never reads a file, calls
 * the registry, touches a live session, or performs I/O; that separation is
 * what makes this testable and deterministic (Section 36). The registry
 * query and persistence load happen in the caller (a later, thin,
 * non-pure service layer) and are handed to this function.
 */

const SOURCE_SELECTED_DIAGNOSTIC: Record<WispProfileSource, WispResolutionDiagnosticCode> = {
  user: 'WISP_RESOLUTION_USER_PROFILE_SELECTED',
  creator: 'WISP_RESOLUTION_CREATOR_PROFILE_SELECTED',
  community: 'WISP_RESOLUTION_COMMUNITY_PROFILE_SELECTED',
  builtin: 'WISP_RESOLUTION_BUILTIN_PROFILE_SELECTED',
  generated: 'WISP_RESOLUTION_GENERATED_FALLBACK_SELECTED',
};

function diag(code: WispResolutionDiagnosticCode, message: string): WispResolutionDiagnostic {
  return { code, message };
}

export function resolveWispProfile(
  candidates: readonly WispGameProfile[],
  context: WispResolutionContext,
  userOverride?: WispUserOverride | null,
): WispProfileResolutionResult {
  const diagnostics: WispResolutionDiagnostic[] = [];
  const sameGame = candidates.filter((c) => c.gameId === context.gameId);
  const applicable = sameGame.filter((c) => isProfileApplicable(c, context));

  let chosen: WispGameProfile | undefined;
  let resolutionReason = '';

  if (context.selectedProfileId !== undefined) {
    const existsAnywhere = sameGame.find((c) => c.profileId === context.selectedProfileId);
    const applicableMatch = applicable.find((c) => c.profileId === context.selectedProfileId);
    if (!existsAnywhere) {
      diagnostics.push(diag('WISP_RESOLUTION_SELECTED_PROFILE_NOT_FOUND', `selected profile "${context.selectedProfileId}" is not registered for this game`));
    } else if (!applicableMatch) {
      diagnostics.push(diag('WISP_RESOLUTION_SELECTED_PROFILE_INAPPLICABLE', `selected profile "${context.selectedProfileId}" does not apply to the current trainer/table context`));
    } else {
      chosen = applicableMatch;
      resolutionReason = 'explicit user selection';
      diagnostics.push(diag(SOURCE_SELECTED_DIAGNOSTIC[chosen.source] ?? 'WISP_RESOLUTION_SELECTED_PROFILE_SELECTED', `explicitly selected profile "${chosen.profileId}" (source=${chosen.source})`));
    }
  }

  if (!chosen) {
    const pool = applicable.filter((c) => isEligibleForAutomaticPrecedence(c.source)).slice().sort(compareCandidates);
    if (pool.length === 0) {
      diagnostics.push(diag('WISP_RESOLUTION_NO_PROFILE', 'no applicable profile is available for this game/context'));
      return { ok: false, userOverrideApplied: false, diagnostics };
    }
    chosen = pool[0];
    resolutionReason = 'default source precedence';
    diagnostics.push(diag(SOURCE_SELECTED_DIAGNOSTIC[chosen.source] ?? 'WISP_RESOLUTION_BUILTIN_PROFILE_SELECTED', `resolved by precedence: profile "${chosen.profileId}" (source=${chosen.source})`));
  }

  let finalProfile = chosen;
  let userOverrideApplied = false;

  if (userOverride && userOverride.gameId === context.gameId) {
    if (userOverride.baseProfileId !== undefined && userOverride.baseProfileId !== chosen.profileId) {
      diagnostics.push(diag('WISP_RESOLUTION_OVERRIDE_INVALID', `stored override targets base profile "${userOverride.baseProfileId}", not the resolved profile "${chosen.profileId}" — ignored`));
    } else {
      const overlay = applyUserOverride(chosen, userOverride);
      finalProfile = overlay.profile;
      userOverrideApplied = true;
      diagnostics.push(
        overlay.staleReferenceCount > 0
          ? diag('WISP_RESOLUTION_OVERRIDE_PARTIALLY_APPLIED', `override applied with ${overlay.staleReferenceCount} stale reference(s) ignored`)
          : diag('WISP_RESOLUTION_OVERRIDE_APPLIED', 'override applied cleanly'),
      );
    }
  }

  return {
    ok: true,
    profile: finalProfile,
    source: chosen.source,
    selectedProfileId: chosen.profileId,
    userOverrideApplied,
    resolutionReason,
    diagnostics,
  };
}

interface OverlayResult {
  profile: WispGameProfile;
  staleReferenceCount: number;
}

/**
 * Materializes a new profile with the override applied — never mutates
 * `base` (Section 24). Any override reference to an action/group id that no
 * longer exists in `base` is silently ignored and counted as stale (Section
 * 25/28) rather than failing the whole resolution.
 */
function applyUserOverride(base: WispGameProfile, override: WispUserOverride): OverlayResult {
  const profile: WispGameProfile = structuredClone(base);
  let stale = 0;

  const actionsById = new Map<string, WispActionDefinition>(profile.actions.map((a) => [a.id, a]));
  const groupsById = new Map<string, WispGroupDefinition>(profile.groups.map((g) => [g.id, g]));

  // 1. actionGroupOverrides — move known actions between known groups.
  if (override.actionGroupOverrides) {
    for (const [actionId, targetGroupId] of Object.entries(override.actionGroupOverrides)) {
      const action = actionsById.get(actionId);
      const targetGroup = groupsById.get(targetGroupId);
      if (!action || !targetGroup) {
        stale++;
        continue;
      }
      const previousGroupId = action.groupId;
      if (previousGroupId && previousGroupId !== targetGroupId) {
        const previousGroup = groupsById.get(previousGroupId);
        if (previousGroup) previousGroup.actionIds = previousGroup.actionIds.filter((id) => id !== actionId);
      }
      action.groupId = targetGroupId;
      if (!targetGroup.actionIds.includes(actionId)) targetGroup.actionIds.push(actionId);
    }
  }

  // 2. hiddenActions — reuse the existing `enabled` field rather than removing actions.
  if (override.hiddenActions) {
    for (const actionId of override.hiddenActions) {
      const action = actionsById.get(actionId);
      if (!action) {
        stale++;
        continue;
      }
      action.enabled = false;
    }
  }

  // 3. slotAssignments — range-validated; out-of-range or unknown action ignored.
  if (override.slotAssignments) {
    for (const [actionId, slot] of Object.entries(override.slotAssignments)) {
      const action = actionsById.get(actionId);
      if (!action) {
        stale++;
        continue;
      }
      if (slot === null) {
        action.slot = undefined;
        continue;
      }
      if (slot < WISP_PROFILE_LIMITS.minQuickSlot || slot > WISP_PROFILE_LIMITS.maxQuickSlot) {
        stale++;
        continue;
      }
      action.slot = slot;
    }
  }

  // 4. groupOrder — known groups first in the given order, then any remaining group appended in its original relative order (Section 26/27).
  if (override.groupOrder) {
    const knownIds = new Set(profile.groups.map((g) => g.id));
    const desired = override.groupOrder.filter((id) => {
      const known = knownIds.has(id);
      if (!known) stale++;
      return known;
    });
    const desiredSet = new Set(desired);
    const remainder = profile.groups.filter((g) => !desiredSet.has(g.id));
    const reordered = [...desired.map((id) => groupsById.get(id)!), ...remainder];
    profile.groups = reordered.map((g, index) => ({ ...g, order: index }));
  }

  // 5. actionOrderByGroup — per group, known actions first in the given order, then any remaining member appended (preserves newly added creator actions, Section 27).
  if (override.actionOrderByGroup) {
    for (const [groupId, desiredOrder] of Object.entries(override.actionOrderByGroup)) {
      const group = groupsById.get(groupId);
      if (!group) {
        stale++;
        continue;
      }
      const memberSet = new Set(group.actionIds);
      const desired = desiredOrder.filter((id) => {
        const isMember = memberSet.has(id);
        if (!isMember) stale++;
        return isMember;
      });
      const desiredSet = new Set(desired);
      const remainder = group.actionIds.filter((id) => !desiredSet.has(id));
      group.actionIds = [...desired, ...remainder];
    }
  }

  // 6. preferredGroupId / preferredQuickSlotCount — validated against final state.
  if (override.preferredGroupId !== undefined) {
    if (groupsById.has(override.preferredGroupId)) {
      // preferredGroupId is presentation state, not part of WispGameProfile's own shape — carried on the resolution result via profile itself is out of scope; recorded via diagnostics only for now.
    } else {
      stale++;
    }
  }
  if (override.preferredQuickSlotCount !== undefined) {
    if (override.preferredQuickSlotCount >= WISP_PROFILE_LIMITS.minQuickSlot && override.preferredQuickSlotCount <= WISP_PROFILE_LIMITS.maxQuickSlot) {
      profile.preferredQuickSlotCount = override.preferredQuickSlotCount;
    } else {
      stale++;
    }
  }

  return { profile, staleReferenceCount: stale };
}
