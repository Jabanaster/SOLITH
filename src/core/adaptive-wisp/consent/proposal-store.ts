import { randomUUID } from 'node:crypto';
import type { WispConsentProposal, WispConsentProposalStatus } from './proposal-types.js';
import { WISP_CONSENT_TERMINAL_STATUSES } from './proposal-types.js';

/**
 * Deterministic proposal lifecycle state machine + in-memory backend-owned
 * store (Section 8-9). One instance of this store is the sole place any
 * `WispConsentProposal.status` is ever assigned — every other module treats
 * the objects this returns as read-only.
 *
 * Not persisted (Section 22, "Restart does not restore executable proposal
 * authority... Default behavior must invalidate proposals on restart") — an
 * in-memory Map already satisfies that by construction; nothing needs to be
 * written to disk for a fresh process to start with zero pending proposals.
 */

const VALID_TRANSITIONS: Record<WispConsentProposalStatus, ReadonlySet<WispConsentProposalStatus>> = {
  pending: new Set(['approved', 'rejected', 'cancelled', 'expired', 'invalidated']),
  approved: new Set(['executing', 'invalidated']),
  executing: new Set(['succeeded', 'failed', 'invalidated']),
  rejected: new Set([]),
  cancelled: new Set([]),
  expired: new Set([]),
  succeeded: new Set(['consumed']),
  failed: new Set(['consumed']),
  invalidated: new Set([]),
  consumed: new Set([]),
};

export type WispConsentTransitionResult = { ok: true; proposal: WispConsentProposal } | { ok: false; reason: string };

export interface WispConsentProposalStore {
  create(input: Omit<WispConsentProposal, 'proposalId' | 'status'>): WispConsentProposal;
  get(proposalId: string): WispConsentProposal | null;
  /** Returns the proposal after lazily expiring it if its TTL has passed (backend-time authority, Section 12). */
  getLive(proposalId: string, nowMs?: number): WispConsentProposal | null;
  list(): WispConsentProposal[];
  transition(proposalId: string, next: WispConsentProposalStatus, nowMs?: number): WispConsentTransitionResult;
  /** Invalidates every non-terminal proposal matching the predicate (Section 22 lifecycle invalidation). Returns the count invalidated. */
  invalidateWhere(predicate: (proposal: WispConsentProposal) => boolean): number;
  clear(): void;
}

export function createWispConsentProposalStore(): WispConsentProposalStore {
  const store = new Map<string, WispConsentProposal>();

  function expireIfPast(proposal: WispConsentProposal, nowMs: number): WispConsentProposal {
    if (proposal.status !== 'pending') return proposal;
    if (new Date(proposal.expiresAt).getTime() > nowMs) return proposal;
    proposal.status = 'expired';
    return proposal;
  }

  return {
    create(input) {
      const proposal: WispConsentProposal = { ...input, proposalId: randomUUID(), status: 'pending' };
      store.set(proposal.proposalId, proposal);
      return proposal;
    },

    get(proposalId) {
      return store.get(proposalId) ?? null;
    },

    getLive(proposalId, nowMs = Date.now()) {
      const proposal = store.get(proposalId);
      if (!proposal) return null;
      return expireIfPast(proposal, nowMs);
    },

    list() {
      return Array.from(store.values());
    },

    transition(proposalId, next, nowMs = Date.now()) {
      const proposal = store.get(proposalId);
      if (!proposal) return { ok: false, reason: 'Proposal not found.' };
      expireIfPast(proposal, nowMs);
      if (!VALID_TRANSITIONS[proposal.status].has(next)) {
        return { ok: false, reason: `Invalid transition from "${proposal.status}" to "${next}".` };
      }
      proposal.status = next;
      return { ok: true, proposal };
    },

    invalidateWhere(predicate) {
      let count = 0;
      for (const proposal of store.values()) {
        if (WISP_CONSENT_TERMINAL_STATUSES.has(proposal.status)) continue;
        if (!predicate(proposal)) continue;
        // Every non-terminal status (pending/approved/executing) already
        // permits -> invalidated in VALID_TRANSITIONS, so this is a plain
        // state-machine transition, just applied as a bulk sweep rather than
        // one proposalId at a time.
        proposal.status = 'invalidated';
        count += 1;
      }
      return count;
    },

    clear() {
      store.clear();
    },
  };
}
