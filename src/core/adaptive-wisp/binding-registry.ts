import type { WispActionId } from './types.js';
import type { BoundWispProfile, WispRuntimeBinding } from './runtime-types.js';

/**
 * Adaptive Wisp runtime binding store (Increment 3, Section 28-29).
 *
 * Session-scoped, in-memory only — never persisted to disk (Increment 2's
 * persistence layer stays configuration-only; see the regression test
 * proving serialized user state never contains sessionId/generation).
 * Every read/write goes through structuredClone, matching the registry.ts
 * copy-on-write discipline from Increment 1.
 */
export interface WispRuntimeBindingRegistry {
  replaceProfileBindings(sessionId: string, boundProfile: BoundWispProfile): void;
  get(sessionId: string, actionId: WispActionId): WispRuntimeBinding | null;
  clearSession(sessionId: string): void;
  clearAll(): void;
}

export function createWispRuntimeBindingRegistry(): WispRuntimeBindingRegistry {
  const bySession = new Map<string, Map<WispActionId, WispRuntimeBinding>>();

  return {
    replaceProfileBindings(sessionId, boundProfile) {
      const bindings = new Map<WispActionId, WispRuntimeBinding>();
      for (const action of boundProfile.actions) {
        if (action.binding) bindings.set(action.actionId, structuredClone(action.binding));
      }
      bySession.set(sessionId, bindings);
    },
    get(sessionId, actionId) {
      const binding = bySession.get(sessionId)?.get(actionId);
      return binding ? structuredClone(binding) : null;
    },
    clearSession(sessionId) {
      bySession.delete(sessionId);
    },
    clearAll() {
      bySession.clear();
    },
  };
}
