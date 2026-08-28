import type { CanonicalGameId, CanonicalTrainerEntryId, WispActionId, WispProfileId } from '../types.js';
import type { WispSafeDisplayValue } from '../execution-types.js';
import type { WispQuickSlot } from '../hotkey-types.js';

/**
 * Adaptive Wisp Phase 1 — renderer-facing consent proposal domain model.
 *
 * This is a NEW layer sitting above the already-reviewed Increment 4
 * canonical proposal (`WispCanonicalProposal`, staged inside
 * `LiveMemorySession`/`MemoryManager`) and the already-reviewed one-use
 * `WriteConsentBinding`/token mechanism (`src/core/consent/write-consent.ts`).
 * It does not replace either: the canonical proposal still owns the actual
 * staged address/value; the token mechanism still owns single-use
 * cryptographic consumption. This layer owns the one thing that did not
 * exist yet for Adaptive Wisp (see adaptive-wisp-live-adapter.ts's own doc
 * comment, "whatever future caller issues consent... must use this same
 * sessionKey") — a durable, backend-owned, renderer-safe record of "the user
 * has not yet decided" with a real lifecycle and expiration.
 *
 * Every field except `status` is immutable once created (Section 7). Status
 * is mutated only through the state machine in proposal-store.ts — nothing
 * else may assign it directly.
 */

export type WispConsentOperationType = 'write' | 'freeze';

export type WispConsentProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'invalidated'
  | 'consumed';

export const WISP_CONSENT_TERMINAL_STATUSES: ReadonlySet<WispConsentProposalStatus> = new Set([
  'rejected',
  'cancelled',
  'expired',
  'succeeded',
  'failed',
  'invalidated',
  'consumed',
]);

export interface WispConsentOperationDetailWrite {
  kind: 'write';
  requestedValue: WispSafeDisplayValue;
}

export interface WispConsentOperationDetailFreeze {
  kind: 'freeze';
  freezeValue: WispSafeDisplayValue;
  intervalMs?: number;
}

export type WispConsentOperationDetail = WispConsentOperationDetailWrite | WispConsentOperationDetailFreeze;

/**
 * Identity/context the proposal was created under. Re-verified in full at
 * approval time (Section 10) — never trusted as still-current just because
 * it matched at creation.
 *
 * Deliberately just (sessionId, sessionGeneration), not a raw pid/executable
 * path/process-start-time — the existing session-context tracker
 * (session-context.ts, referenced in quick-slot-controller.ts's own doc
 * comment) already increments `sessionGeneration` whenever verified process
 * identity changes, so a separate process-identity field here would be
 * redundant with what re-verification already keys off of. The actual
 * cryptographic one-use token (`WriteConsentBinding`, minted at approval
 * time) DOES carry the real live pid/executablePath/processStartTime, read
 * fresh from the session at mint time — this proposal record only needs
 * enough identity to know which session it was scoped to for invalidation.
 */
export interface WispConsentSessionBinding {
  sessionId: string;
  sessionGeneration: number;
}

export interface WispConsentProposal {
  readonly proposalId: string;
  readonly slot: WispQuickSlot;
  readonly lowLevelProposalId: string;
  readonly operationType: WispConsentOperationType;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly canonicalGameId: CanonicalGameId;
  readonly profileId: WispProfileId;
  readonly actionId: WispActionId;
  readonly entryId: CanonicalTrainerEntryId;
  readonly dataType: string;
  readonly operationDetail: WispConsentOperationDetail;
  readonly session: WispConsentSessionBinding;
  readonly safeDescription: string;
  status: WispConsentProposalStatus;
}

/** Renderer-safe projection — never includes tokens, raw addresses, or PIDs beyond what the UI needs to display. */
export interface WispConsentProposalView {
  proposalId: string;
  operationType: WispConsentOperationType;
  createdAt: string;
  expiresAt: string;
  canonicalGameId: CanonicalGameId;
  actionId: WispActionId;
  safeDescription: string;
  status: WispConsentProposalStatus;
}

export function toProposalView(proposal: WispConsentProposal): WispConsentProposalView {
  return {
    proposalId: proposal.proposalId,
    operationType: proposal.operationType,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    canonicalGameId: proposal.canonicalGameId,
    actionId: proposal.actionId,
    safeDescription: proposal.safeDescription,
    status: proposal.status,
  };
}

export type WispConsentErrorCode =
  | 'WISP_CONSENT_PROPOSAL_NOT_FOUND'
  | 'WISP_CONSENT_PROPOSAL_NOT_PENDING'
  | 'WISP_CONSENT_PROPOSAL_EXPIRED'
  | 'WISP_CONSENT_PROPOSAL_REJECTED'
  | 'WISP_CONSENT_PROPOSAL_CANCELLED'
  | 'WISP_CONSENT_PROPOSAL_CONSUMED'
  | 'WISP_CONSENT_PROPOSAL_INVALIDATED'
  | 'WISP_CONSENT_SESSION_DETACHED'
  | 'WISP_CONSENT_SESSION_CHANGED'
  | 'WISP_CONSENT_PROCESS_CHANGED'
  | 'WISP_CONSENT_GAME_CHANGED'
  | 'WISP_CONSENT_BINDING_STALE'
  | 'WISP_CONSENT_ACTION_UNAVAILABLE'
  | 'WISP_CONSENT_VALUE_INVALID'
  | 'WISP_CONSENT_OPERATION_UNSUPPORTED'
  | 'WISP_CONSENT_AUTHORIZATION_INVALID'
  | 'WISP_CONSENT_AUTHORIZATION_REPLAYED'
  | 'WISP_CONSENT_EXECUTION_FAILED'
  | 'WISP_CONSENT_READBACK_MISMATCH'
  | 'WISP_CONSENT_AUDIT_FAILURE'
  | 'WISP_CONSENT_IPC_VALIDATION_FAILED';

export interface WispConsentDiagnostic {
  code: WispConsentErrorCode;
  message: string;
}

export function consentDiagnostic(code: WispConsentErrorCode, message: string): WispConsentDiagnostic {
  return { code, message };
}
