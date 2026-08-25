import { issue } from './errors.js';
import { validateWispGameProfile } from './validation.js';
import type { WispGameProfile, WispProfileId, WispProfileRegistration, WispProfileRegistryQuery } from './types.js';

/**
 * Adaptive Wisp central profile registry (Increment 1, Sections 19-24).
 *
 * In-memory only — no persistence in this increment (Section 26). Stores
 * only profiles that already passed validateWispGameProfile; there is no
 * path for a UI component to stuff a raw object directly into registry
 * state. Registration order is preserved and is the only ordering this
 * registry exposes — source precedence (user > creator > community >
 * builtin > generated) is the future resolver's job, not this module's
 * (Section 22-23).
 *
 * register() rejects a duplicate profileId outright rather than silently
 * overwriting; a future increment can add an explicit replace()/update() if
 * needed (Section 21).
 */
export interface WispProfileRegistry {
  register(raw: unknown): WispProfileRegistration;
  unregister(profileId: WispProfileId): boolean;
  get(profileId: WispProfileId): WispGameProfile | undefined;
  list(): WispGameProfile[];
  listForGame(gameId: string): WispGameProfile[];
  listForContext(query: WispProfileRegistryQuery): WispGameProfile[];
  clear(): void;
}

function clone(profile: WispGameProfile): WispGameProfile {
  return structuredClone(profile);
}

export function createWispProfileRegistry(): WispProfileRegistry {
  const profiles = new Map<WispProfileId, WispGameProfile>();

  return {
    register(raw: unknown): WispProfileRegistration {
      const result = validateWispGameProfile(raw);
      if (result.ok === false) {
        return { ok: false, issues: result.issues };
      }

      if (profiles.has(result.profile.profileId)) {
        return {
          ok: false,
          issues: [issue('WISP_PROFILE_ALREADY_REGISTERED', `profile "${result.profile.profileId}" is already registered`, 'profileId')],
        };
      }

      const stored = clone(result.profile);
      profiles.set(stored.profileId, stored);
      return { ok: true, profile: clone(stored) };
    },

    unregister(profileId: WispProfileId): boolean {
      return profiles.delete(profileId);
    },

    get(profileId: WispProfileId): WispGameProfile | undefined {
      const found = profiles.get(profileId);
      return found ? clone(found) : undefined;
    },

    list(): WispGameProfile[] {
      return Array.from(profiles.values(), clone);
    },

    listForGame(gameId: string): WispGameProfile[] {
      return Array.from(profiles.values())
        .filter((p) => p.gameId === gameId)
        .map(clone);
    },

    listForContext(query: WispProfileRegistryQuery): WispGameProfile[] {
      return Array.from(profiles.values())
        .filter((p) => {
          if (p.gameId !== query.gameId) return false;
          if (query.trainerId !== undefined && p.trainerId !== query.trainerId) return false;
          if (query.tableId !== undefined && p.tableId !== query.tableId) return false;
          return true;
        })
        .map(clone);
    },

    clear(): void {
      profiles.clear();
    },
  };
}
