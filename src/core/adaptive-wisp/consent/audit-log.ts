import { createHash, randomUUID } from 'node:crypto';
import db from '../../database/index.js';
import type { WispConsentProposal } from './proposal-types.js';

/**
 * Durable Wisp consent audit trail (Section 20). A NEW table
 * (`wisp_consent_audit_log`) rather than reusing `journal_events` — that
 * table's `gameId` column is a foreign key into the legacy save-editor
 * `games` table, not `canonical_games`, so forcing Wisp's CanonicalGameId
 * through it would mean fabricating a legacy-games row for every certified
 * Wisp game just to satisfy an unrelated FK. A dedicated table with exactly
 * the fields this directive requires is the honest fit.
 *
 * Audit writes never grant authority (Section 20's own requirement) — this
 * module has no read API used anywhere in the approval/execution path, only
 * `recordWispConsentAuditEvent` (write) and `listWispConsentAuditEvents`
 * (diagnostics/tests only).
 */

export type WispConsentAuditEventType =
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

export interface WispConsentAuditEventInput {
  eventType: WispConsentAuditEventType;
  proposal: WispConsentProposal;
  decision?: 'approved' | 'rejected' | 'cancelled';
  decisionAt?: string;
  executionStatus?: string;
  failureCategory?: string;
  readbackStatus?: 'match' | 'mismatch' | 'not_applicable';
}

export interface WispConsentAuditEventRow {
  eventId: string;
  timestamp: string;
  proposalId: string;
  eventType: WispConsentAuditEventType;
  canonicalGameId: string;
  profileId: string;
  actionId: string;
  entryId: string;
  operationType: string;
  requestedValueSummary: string;
  decision: string | null;
  decisionAt: string | null;
  executionStatus: string | null;
  failureCategory: string | null;
  sessionRef: string;
  readbackStatus: string | null;
}

/**
 * Privacy-conscious session identity representation (Section 20: "in a
 * privacy-conscious representation") — a short, non-reversible hash of the
 * real sessionId/pid/generation, sufficient to correlate audit rows from the
 * same session without persisting the raw identifiers.
 */
export function hashSessionRef(session: WispConsentProposal['session']): string {
  const payload = `${session.sessionId}:${session.sessionGeneration}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function summarizeRequestedValue(proposal: WispConsentProposal): string {
  return proposal.operationDetail.kind === 'write'
    ? `write:${String(proposal.operationDetail.requestedValue)}`
    : `freeze:${String(proposal.operationDetail.freezeValue)}${proposal.operationDetail.intervalMs ? `@${proposal.operationDetail.intervalMs}ms` : ''}`;
}

export function recordWispConsentAuditEvent(input: WispConsentAuditEventInput, options: { nowIso?: string } = {}): void {
  const eventId = randomUUID();
  const timestamp = options.nowIso ?? new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO wisp_consent_audit_log (
      eventId, timestamp, proposalId, eventType, canonicalGameId, profileId, actionId, entryId,
      operationType, requestedValueSummary, decision, decisionAt, executionStatus, failureCategory,
      sessionRef, readbackStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    eventId,
    timestamp,
    input.proposal.proposalId,
    input.eventType,
    input.proposal.canonicalGameId,
    input.proposal.profileId,
    input.proposal.actionId,
    input.proposal.entryId,
    input.proposal.operationType,
    summarizeRequestedValue(input.proposal),
    input.decision ?? null,
    input.decisionAt ?? null,
    input.executionStatus ?? null,
    input.failureCategory ?? null,
    hashSessionRef(input.proposal.session),
    input.readbackStatus ?? null,
  );
}

export function listWispConsentAuditEvents(proposalId?: string): WispConsentAuditEventRow[] {
  const stmt = proposalId
    ? db.prepare('SELECT * FROM wisp_consent_audit_log WHERE proposalId = ? ORDER BY timestamp ASC')
    : db.prepare('SELECT * FROM wisp_consent_audit_log ORDER BY timestamp ASC');
  const rows = proposalId ? stmt.all(proposalId) : stmt.all();
  return rows as WispConsentAuditEventRow[];
}
