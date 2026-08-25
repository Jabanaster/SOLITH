import { deleteUserState, loadUserState, saveUserState, type WispSaveUserStateResult } from './persistence.js';
import { resolveWispProfile } from './profile-resolver.js';
import { WISP_USER_STATE_SCHEMA_VERSION, type WispUserOverride, type WispUserState } from './user-state-schema.js';
import type { WispProfileRegistry } from './registry.js';
import type { WispProfileResolutionResult, WispResolutionContext } from './resolution-types.js';
import type { CanonicalGameId, WispProfileId } from './types.js';

/**
 * Adaptive Wisp domain services (Increment 2, Sections 29-31) — the thin,
 * non-pure layer that wires the pure resolver (profile-resolver.ts) to the
 * registry (Increment 1) and to disk (persistence.ts). No UI, no IPC.
 */

/**
 * Loads persisted selection/override for `context.gameId`, gathers
 * candidates from the registry, and resolves. A load/corruption failure in
 * the persisted state degrades to "resolve without stored user state"
 * rather than making the whole subsystem unusable (Section 8) — the
 * resolver still runs against the registry's default precedence.
 */
export async function resolveWispProfileForGame(
  registry: WispProfileRegistry,
  userDataRoot: string,
  context: WispResolutionContext,
): Promise<WispProfileResolutionResult> {
  const candidates = registry.listForGame(context.gameId);
  const loaded = await loadUserState(userDataRoot, context.gameId);

  let selectedProfileId = context.selectedProfileId;
  let override: WispUserOverride | undefined;
  if (loaded.ok && loaded.state) {
    selectedProfileId = selectedProfileId ?? loaded.state.selectedProfileId;
    override = loaded.state.override;
  }

  const result = resolveWispProfile(candidates, { ...context, selectedProfileId }, override);
  if (loaded.ok === false) {
    result.diagnostics = [{ code: 'WISP_RESOLUTION_OVERRIDE_INVALID', message: `persisted user state could not be loaded (${loaded.error.code}) — resolved without it` }, ...result.diagnostics];
  }
  return result;
}

function emptyState(gameId: CanonicalGameId): WispUserState {
  return { schemaVersion: WISP_USER_STATE_SCHEMA_VERSION, gameId };
}

export async function selectWispProfile(userDataRoot: string, gameId: CanonicalGameId, profileId: WispProfileId): Promise<WispSaveUserStateResult> {
  const loaded = await loadUserState(userDataRoot, gameId);
  const current = loaded.ok && loaded.state ? loaded.state : emptyState(gameId);
  return saveUserState(userDataRoot, { ...current, selectedProfileId: profileId });
}

export async function saveWispUserOverride(userDataRoot: string, override: WispUserOverride): Promise<WispSaveUserStateResult> {
  const loaded = await loadUserState(userDataRoot, override.gameId);
  const current = loaded.ok && loaded.state ? loaded.state : emptyState(override.gameId);
  return saveUserState(userDataRoot, { ...current, override });
}

/** Clears only the presentation-level override, keeping any explicit profile selection. */
export async function clearWispUserOverride(userDataRoot: string, gameId: CanonicalGameId): Promise<WispSaveUserStateResult> {
  const loaded = await loadUserState(userDataRoot, gameId);
  if (!loaded.ok || !loaded.state) return { ok: true };
  const { override: _override, ...rest } = loaded.state;
  return saveUserState(userDataRoot, rest);
}

/** Clears only the explicit profile selection, keeping any presentation-level override. */
export async function clearWispSelectedProfile(userDataRoot: string, gameId: CanonicalGameId): Promise<WispSaveUserStateResult> {
  const loaded = await loadUserState(userDataRoot, gameId);
  if (!loaded.ok || !loaded.state) return { ok: true };
  const { selectedProfileId: _selectedProfileId, ...rest } = loaded.state;
  return saveUserState(userDataRoot, rest);
}

/** Full reset — clears both selection and override, returning resolution to default source precedence (equivalent to "reset to creator recommendation" whenever a creator profile is the top-precedence candidate). */
export async function resetWispUserState(userDataRoot: string, gameId: CanonicalGameId): Promise<WispSaveUserStateResult> {
  return deleteUserState(userDataRoot, gameId);
}
