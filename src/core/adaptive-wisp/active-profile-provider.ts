import type { WispGameProfile } from './types.js';
import type { WispResolutionContext, WispProfileResolutionResult } from './resolution-types.js';
import type { WispRuntimeContext, BoundWispProfile } from './runtime-types.js';
import type { WispTrainerEntryLookup } from './entry-lookup.js';
import { bindResolvedProfile } from './profile-binder.js';

/**
 * Adaptive Wisp active-profile snapshot (Increment 5, Sections 7-9).
 *
 * Carries both the raw resolved profile (needed for WispActionDefinition —
 * presets, control type — which executeWispAction requires) and the bound
 * profile (needed for per-action `slot`/`binding`/`availability`, which only
 * exist post-binding). Never cached beyond one activation — see
 * createWispActiveProfileProvider.
 */
export interface WispActiveWispProfileSnapshot {
  rawProfile: WispGameProfile;
  bound: BoundWispProfile;
}

export interface WispActiveProfileProvider {
  /** Resolves the CURRENT bound profile fresh — never a cached one (Section 8). Returns null when there is no active session/game or resolution/binding fails closed. */
  getActiveBoundProfile(): Promise<WispActiveWispProfileSnapshot | null>;
}

export interface WispActiveProfileProviderDeps {
  getCurrentContext: () => WispRuntimeContext | null;
  resolveProfile: (context: WispResolutionContext) => Promise<WispProfileResolutionResult>;
  entryLookup: WispTrainerEntryLookup;
}

/**
 * Real resolution, re-run on every call — deliberately uncached. Increment 5
 * requires use-time resolution, not registration-time resolution (Section 8);
 * resolving fresh on every activation is the simplest way to guarantee that
 * without inventing a second staleness-tracking mechanism alongside the one
 * validateWispBinding already provides inside executeWispAction.
 */
export function createWispActiveProfileProvider(deps: WispActiveProfileProviderDeps): WispActiveProfileProvider {
  return {
    async getActiveBoundProfile(): Promise<WispActiveWispProfileSnapshot | null> {
      const context = deps.getCurrentContext();
      if (!context) return null;

      const resolution = await deps.resolveProfile({
        gameId: context.gameId,
        trainerId: context.trainerId,
        tableId: context.tableId,
        tableVersion: context.tableVersion,
      });
      if (resolution.ok === false || !resolution.profile) return null;

      const bound = bindResolvedProfile(resolution.profile, context, deps.entryLookup);
      if (bound.ok === false) return null;

      return { rawProfile: resolution.profile, bound: bound.profile };
    },
  };
}
