import type { WispQuickSlotController, WispPendingConsentInfo } from '../quick-slot-controller.js';
import type { WispHotkeyActivationResult } from '../hotkey-types.js';
import type { WispConsentProposalStore } from './proposal-store.js';
import type { WispConsentOperationDetail, WispConsentProposal, WispConsentProposalView } from './proposal-types.js';
import { consentDiagnostic, toProposalView, type WispConsentDiagnostic } from './proposal-types.js';

/**
 * Adaptive Wisp Phase 1 — consent orchestration service.
 *
 * This is the ONLY place that (a) creates a renderer-facing
 * `WispConsentProposal` from a `WispPendingConsentInfo` callback fired by the
 * quick-slot controller, and (b) drives it through approve/reject/cancel by
 * calling back into that SAME controller's `confirmPending` — never a
 * second, independently-derived execution path (Section 6). It never mints a
 * one-use consent token itself: minting requires reading live session/memory
 * state, which this module (living in src/core/adaptive-wisp, the pure
 * domain layer) is not allowed to import directly — `mintConsentToken` is
 * injected from the Electron composition root, the same seam pattern
 * `WispTrainerExecutionAdapter` already uses for the live-memory boundary.
 */

export interface WispConsentTokenArtifact {
  tokenId: string;
  expiresAt: string;
}

export type WispConsentAuditEventTypeLike =
  | 'proposal_created'
  | 'proposal_displayed'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'invalidated'
  | 'execution_started'
  | 'execution_succeeded'
  | 'execution_failed'
  | 'replay_rejected'
  | 'stale_authority_rejected';

export interface WispConsentServiceDeps {
  store: WispConsentProposalStore;
  quickSlotController: WispQuickSlotController;
  /** Injected seam — mints a one-use write-consent token bound to the exact low-level canonical proposal, or null if the underlying session/proposal no longer resolves (Section 10 re-verification). */
  mintConsentToken: (input: { lowLevelProposalId: string; operationType: 'write' | 'freeze' }) => WispConsentTokenArtifact | null;
  /**
   * Injected seam — releases (discards) the staged low-level write/freeze
   * proposal when this service's own high-level proposal terminates without
   * a successful confirm (reject/cancel/expire/invalidate/failed-confirm).
   * A missing session or already-consumed low-level proposal is a safe no-op.
   */
  releaseLowLevelAuthority: (input: { lowLevelProposalId: string; operationType: 'write' | 'freeze' }) => void;
  recordAuditEvent: (input: {
    eventType: WispConsentAuditEventTypeLike;
    proposal: WispConsentProposal;
    decision?: 'approved' | 'rejected' | 'cancelled';
    executionStatus?: string;
    failureCategory?: string;
  }) => void;
  ttlMs?: number;
  nowMs?: () => number;
}

export type WispConsentActionResult =
  | { ok: true; proposal: WispConsentProposalView; execution?: WispHotkeyActivationResult }
  | { ok: false; diagnostic: WispConsentDiagnostic };

export interface WispConsentService {
  /** Registers as the quick-slot controller's `onPendingConsent` callback (Section 9 — creates exactly one proposal per pending-consent result). */
  handlePendingConsent(info: WispPendingConsentInfo): void;
  /** Registers as the quick-slot controller's `onPresentationStateReset` callback (Section 22 lifecycle invalidation). */
  handlePresentationStateReset(): void;
  listPending(): WispConsentProposalView[];
  get(proposalId: string): WispConsentProposalView | null;
  approve(proposalId: string): Promise<WispConsentActionResult>;
  reject(proposalId: string): WispConsentActionResult;
  cancel(proposalId: string): WispConsentActionResult;
}

const DEFAULT_TTL_MS = 30_000;

function operationDetailFromInfo(info: WispPendingConsentInfo): WispConsentOperationDetail {
  if (info.request.control === 'freeze') {
    return { kind: 'freeze', freezeValue: info.requestedValue, intervalMs: info.request.intervalMs };
  }
  return { kind: 'write', requestedValue: info.requestedValue };
}

function safeDescriptionFromInfo(info: WispPendingConsentInfo): string {
  const verb = info.request.control === 'freeze' ? (info.request.enable ? 'Freeze' : 'Unfreeze') : 'Set';
  return `${verb} "${info.actionDefinition.label}" to ${String(info.requestedValue)}`;
}

export function createWispConsentService(deps: WispConsentServiceDeps): WispConsentService {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = () => deps.nowMs?.() ?? Date.now();

  function releaseFor(proposal: WispConsentProposal): void {
    deps.releaseLowLevelAuthority({ lowLevelProposalId: proposal.lowLevelProposalId, operationType: proposal.operationType });
  }

  /**
   * Backend-time lazy expiration (Section 12) currently happens silently
   * inside the store's own getLive/transition. This wrapper makes the
   * transition observable to the service layer so an expiry that nobody
   * happened to look at is still audited and releases its low-level
   * authority (Section 9/12 — "expired" is a required audit event, and a
   * rejected/cancelled/expired proposal must not remain indefinitely as
   * reusable low-level authority).
   */
  function getLiveAndReap(proposalId: string): WispConsentProposal | null {
    const before = deps.store.get(proposalId);
    const wasPending = before?.status === 'pending';
    const live = deps.store.getLive(proposalId, now());
    if (wasPending && live && live.status === 'expired') {
      deps.recordAuditEvent({ eventType: 'expired', proposal: live });
      releaseFor(live);
    }
    return live;
  }

  return {
    handlePendingConsent(info: WispPendingConsentInfo): void {
      const nowMs = now();
      const proposal = deps.store.create({
        slot: info.slot,
        lowLevelProposalId: info.lowLevelProposalId,
        operationType: info.request.control === 'freeze' ? 'freeze' : 'write',
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + ttlMs).toISOString(),
        canonicalGameId: info.boundProfile.gameId,
        profileId: info.boundProfile.profileId,
        actionId: info.boundAction.actionId,
        entryId: info.boundAction.entryId,
        dataType: info.boundAction.entryDescriptor?.dataType ?? 'unknown',
        operationDetail: operationDetailFromInfo(info),
        session: { sessionId: info.context.sessionId, sessionGeneration: info.context.sessionGeneration },
        safeDescription: safeDescriptionFromInfo(info),
      });
      deps.recordAuditEvent({ eventType: 'proposal_created', proposal });
    },

    handlePresentationStateReset(): void {
      // Every pending/approved/executing proposal is scoped to a session
      // identity the controller has already decided is stale (Section 22) —
      // invalidate all of them rather than trying to re-derive which ones
      // still apply to the new context.
      const toInvalidate = deps.store.list().filter((p) => p.status === 'pending' || p.status === 'approved' || p.status === 'executing');
      // Capture pre-invalidation status: invalidateWhere mutates these same
      // object references in place, so this must be read BEFORE it runs.
      const originalStatus = new Map(toInvalidate.map((p) => [p.proposalId, p.status]));
      deps.store.invalidateWhere((p) => toInvalidate.includes(p));
      for (const proposal of toInvalidate) {
        deps.recordAuditEvent({ eventType: 'invalidated', proposal });
        // 'executing' means a real confirmWrite/confirmFreeze call may
        // already be in flight against the low-level proposal — releasing it
        // here would race that call. It is left alone; the in-flight call
        // independently re-verifies process identity and will fail closed on
        // its own if the session really did go stale (Section 7).
        const wasExecuting = originalStatus.get(proposal.proposalId) === 'executing';
        if (!wasExecuting) releaseFor(proposal);
      }
    },

    listPending(): WispConsentProposalView[] {
      return deps.store
        .list()
        .filter((p) => p.status === 'pending')
        .map((p) => getLiveAndReap(p.proposalId))
        .filter((p): p is WispConsentProposal => p !== null && p.status === 'pending')
        .map(toProposalView);
    },

    get(proposalId: string): WispConsentProposalView | null {
      const proposal = getLiveAndReap(proposalId);
      return proposal ? toProposalView(proposal) : null;
    },

    async approve(proposalId: string): Promise<WispConsentActionResult> {
      const live = getLiveAndReap(proposalId);
      if (!live) return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_PROPOSAL_NOT_FOUND', `no proposal "${proposalId}" exists`) };
      if (live.status === 'expired') return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_PROPOSAL_EXPIRED', 'this proposal has expired') };
      if (live.status !== 'pending') return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_PROPOSAL_NOT_PENDING', `proposal is "${live.status}", not pending`) };

      const token = deps.mintConsentToken({ lowLevelProposalId: live.lowLevelProposalId, operationType: live.operationType });
      if (!token) {
        const invalidated = deps.store.transition(proposalId, 'invalidated', now());
        if (invalidated.ok) {
          deps.recordAuditEvent({ eventType: 'invalidated', proposal: invalidated.proposal, failureCategory: 'session_no_longer_resolves' });
          releaseFor(invalidated.proposal);
        }
        return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_SESSION_CHANGED', 'the underlying session/proposal no longer resolves — it may have detached or changed') };
      }

      const approved = deps.store.transition(proposalId, 'approved', now());
      if (approved.ok === false) return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_AUTHORIZATION_REPLAYED', approved.reason) };
      deps.recordAuditEvent({ eventType: 'approved', proposal: approved.proposal, decision: 'approved' });

      const executing = deps.store.transition(proposalId, 'executing', now());
      if (executing.ok === false) return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_AUTHORIZATION_REPLAYED', executing.reason) };
      deps.recordAuditEvent({ eventType: 'execution_started', proposal: executing.proposal });

      const execution = await deps.quickSlotController.confirmPending(live.slot, live.lowLevelProposalId, token.tokenId);
      const succeeded = execution.executed && execution.executionStatus !== undefined && !['rejected', 'stale', 'unavailable', 'failed'].includes(execution.executionStatus);
      const finalStatus = succeeded ? 'succeeded' : 'failed';
      const finalTransition = deps.store.transition(proposalId, finalStatus, now());
      if (finalTransition.ok) {
        deps.recordAuditEvent({
          eventType: succeeded ? 'execution_succeeded' : 'execution_failed',
          proposal: finalTransition.proposal,
          executionStatus: execution.executionStatus,
          failureCategory: succeeded ? undefined : execution.diagnostic?.code,
        });
        // A successful confirm already deleted the low-level entry itself
        // (LiveMemorySession.confirmWrite/startFreezeConfirmed). A failed
        // confirm attempt does not — several of its own failure paths
        // (consent-guard block, identity mismatch, full rollback ledger)
        // intentionally leave the entry alone for that file's OTHER callers'
        // retry semantics, so Wisp must release it explicitly here instead of
        // changing that shared file's behavior (Section 9).
        if (!succeeded) releaseFor(finalTransition.proposal);
        const consumed = deps.store.transition(proposalId, 'consumed', now());
        if (consumed.ok) deps.recordAuditEvent({ eventType: succeeded ? 'execution_succeeded' : 'execution_failed', proposal: consumed.proposal, executionStatus: execution.executionStatus });
      }

      const finalProposal = deps.store.get(proposalId);
      return { ok: true, proposal: toProposalView(finalProposal ?? live), execution };
    },

    reject(proposalId: string): WispConsentActionResult {
      const live = getLiveAndReap(proposalId);
      if (!live) return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_PROPOSAL_NOT_FOUND', `no proposal "${proposalId}" exists`) };
      const result = deps.store.transition(proposalId, 'rejected', now());
      if (result.ok === false) return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_PROPOSAL_NOT_PENDING', result.reason) };
      deps.recordAuditEvent({ eventType: 'rejected', proposal: result.proposal, decision: 'rejected' });
      releaseFor(result.proposal);
      return { ok: true, proposal: toProposalView(result.proposal) };
    },

    cancel(proposalId: string): WispConsentActionResult {
      const live = getLiveAndReap(proposalId);
      if (!live) return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_PROPOSAL_NOT_FOUND', `no proposal "${proposalId}" exists`) };
      // Cancellation is idempotent (Section 11) — cancelling an
      // already-terminal proposal is a harmless no-op success, not an error.
      if (live.status !== 'pending') return { ok: true, proposal: toProposalView(live) };
      const result = deps.store.transition(proposalId, 'cancelled', now());
      if (result.ok === false) return { ok: false, diagnostic: consentDiagnostic('WISP_CONSENT_PROPOSAL_NOT_PENDING', result.reason) };
      deps.recordAuditEvent({ eventType: 'cancelled', proposal: result.proposal, decision: 'cancelled' });
      releaseFor(result.proposal);
      return { ok: true, proposal: toProposalView(result.proposal) };
    },
  };
}
