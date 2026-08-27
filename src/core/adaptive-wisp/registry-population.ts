import type { WispProfileRegistry } from './registry.js';
import type { WispProfileId } from './types.js';
import type { WispProfileValidationIssue } from './errors.js';

/**
 * Adaptive Wisp Increment 6 — profile-registry population (Sections
 * "Registry population requirements").
 *
 * Deliberately thin: `WispProfileRegistry.register()` (Increment 1,
 * unchanged) already does the real work this requires — schema validation
 * via `validateWispGameProfile`, and deterministic duplicate-identity
 * rejection (a second `register()` call for an already-registered
 * `profileId` is rejected outright, never silently overwritten or merged —
 * there is no "first match wins" behavior anywhere in that path). This
 * module exists only to apply that same per-profile decision across a
 * candidate list and report which ones succeeded or failed, and why.
 *
 * Audit finding (documented, not silently worked around): this repository
 * contains no bundled, generated, or otherwise authoritative Wisp profile
 * data anywhere — `WispGameProfile` objects exist only in test fixtures. Per
 * this closeout's explicit instruction not to invent production cheat
 * definitions solely to satisfy a requirement, the real production
 * composition (electron/adaptive-wisp-hotkey-composition.ts) calls this
 * function with an EMPTY candidate list. The registry therefore remains
 * empty in the running app today — this function is real, tested
 * infrastructure ready to receive real profiles the moment an authoritative
 * source exists (bundled JSON, a future creator-submission pipeline, etc.),
 * not a placeholder that merely looks implemented.
 */
export interface WispProfilePopulationResult {
  registered: WispProfileId[];
  rejected: Array<{ index: number; issues: WispProfileValidationIssue[] }>;
}

export function populateWispProfileRegistry(registry: WispProfileRegistry, candidates: readonly unknown[]): WispProfilePopulationResult {
  const registered: WispProfileId[] = [];
  const rejected: Array<{ index: number; issues: WispProfileValidationIssue[] }> = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const result = registry.register(candidates[index]);
    if (result.ok === true) {
      registered.push(result.profile.profileId);
    } else {
      rejected.push({ index, issues: result.issues });
    }
  }

  return { registered, rejected };
}
