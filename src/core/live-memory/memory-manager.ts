/**
 * MemoryManager — safe-write facade over LiveMemorySession + local audit log.
 * Phase 10: WritePolicyGate checked before propose/confirm/safeWrite.
 * Defaults are fail-closed; IPC/callers must supply approval + session waiver.
 */

import type { MemoryAuditLog } from './audit-log.js';
import type {
  ConfirmWriteResult,
  LiveMemorySession,
  RollbackResult,
  StartFreezeResult,
} from './live-memory-session.js';
import type { LiveMemoryAddress, LiveWriteProposal } from './types.js';
import {
  WritePolicyGate,
  defaultTrainerWritePolicyContext,
  type WritePolicyContext,
} from './write-policy.js';
import {
  consumeWriteConsent,
  type WriteConsentBinding,
} from '../consent/write-consent.js';

export interface SafeWriteResult {
  success: boolean;
  proposal?: LiveWriteProposal;
  confirm?: ConfirmWriteResult;
  verified?: boolean;
  readbackValue?: number;
  error?: string;
  policyCode?: string;
  /** Set when a post-write snapshot/backup listener throws. Write may still have succeeded. */
  snapshotError?: string;
}

export type ConfirmWriteManagerResult = ConfirmWriteResult & { snapshotError?: string };

/** Optional hook after a confirmed process write (e.g. Avowed WinGDK save snapshot). */
export type MemoryManagerSnapshotListener = (info: {
  featureId?: string;
  reason?: string;
}) => void;

export interface WriteCallOptions {
  featureId?: string;
  reason?: string;
  /**
   * Legacy direct approval for library/tests. IPC must use `consentToken` instead.
   * Ignored when `consentToken` is present (token is the approval evidence).
   */
  userApproved?: boolean;
  /**
   * Single-use operation-bound consent artifact token (required for IPC confirms).
   */
  consentToken?: string;
  /** Binding used to consume `consentToken` (must match issuance). */
  consentBinding?: WriteConsentBinding;
  /**
   * Propose/staging path — waiver only. Confirm/commit still needs approval or consent.
   */
  writeIntent?: 'stage' | 'commit';
  verifyReadback?: boolean;
}

export class MemoryManager {
  private snapshotListener: MemoryManagerSnapshotListener | null = null;
  private readonly writeGate = new WritePolicyGate();
  /** When null, trainer context is derived from session waiver + per-call approval. */
  private writePolicyContext: WritePolicyContext | null = null;

  constructor(
    private readonly session: LiveMemorySession,
    private readonly audit: MemoryAuditLog,
  ) {}

  /** Override write policy (e.g. research_probe). Null restores session-derived trainer defaults. */
  setWritePolicyContext(context: WritePolicyContext | null): void {
    this.writePolicyContext = context;
  }

  getWritePolicyContext(
    userApprovedForCall = false,
    writeIntent: 'stage' | 'commit' = 'commit',
  ): WritePolicyContext {
    if (this.writePolicyContext) {
      if (this.writePolicyContext.writeClass === 'trainer') {
        return {
          ...this.writePolicyContext,
          singlePlayerWaiverAccepted: this.session.isOfflineConfirmed(),
          userApproved:
            this.writePolicyContext.userApproved === true || userApprovedForCall === true,
          writeIntent,
        };
      }
      return { ...this.writePolicyContext, writeIntent };
    }
    return defaultTrainerWritePolicyContext({
      singlePlayerWaiverAccepted: this.session.isOfflineConfirmed(),
      userApproved: userApprovedForCall === true,
      writeIntent,
    });
  }

  private waiverAssumedForAudit(userApprovedForCall = false): boolean {
    const ctx = this.getWritePolicyContext(userApprovedForCall);
    return ctx.singlePlayerWaiverAccepted === true || ctx.isOffline === true;
  }

  private enforceWritePolicy(
    reason: string,
    userApprovedForCall: boolean,
    writeIntent: 'stage' | 'commit' = 'commit',
  ): { ok: true } | { ok: false; error: string; code: string } {
    const decision = this.writeGate.evaluate(
      this.getWritePolicyContext(userApprovedForCall, writeIntent),
    );
    if (decision.allow === true) return { ok: true };
    // decision.allow is false here, so decision.code is available
    const code = decision.code;
    this.audit.append({
      op: 'abort',
      reason: `write_policy:${code}:${reason}:${decision.reasons.join(';')}`,
      waiverAssumed: this.waiverAssumedForAudit(userApprovedForCall),
    });
    return { ok: false, error: `write_policy_denied:${code}`, code };
  }

  getAuditLog(): MemoryAuditLog {
    return this.audit;
  }

  /**
   * Register a listener invoked after successful confirmWrite / safeWrite.
   * Used by Electron backup orchestrators — does not perform memory I/O itself.
   */
  setSnapshotListener(listener: MemoryManagerSnapshotListener | null): void {
    this.snapshotListener = listener;
  }

  private emitSnapshot(info: {
    featureId?: string;
    reason?: string;
    userApproved?: boolean;
  }): { ok: true } | { ok: false; error: string } {
    if (!this.snapshotListener) return { ok: true };
    try {
      this.snapshotListener(info);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.audit.append({
        op: 'abort',
        featureId: info.featureId,
        reason: `snapshot_listener_failed:${info.reason ?? 'snapshot'}:${error}`,
        waiverAssumed: this.waiverAssumedForAudit(info.userApproved === true),
      });
      return { ok: false, error };
    }
  }

  read(address: LiveMemoryAddress, reason = 'read'): number {
    const value = this.session.readValue(address);
    this.audit.append({
      op: 'read',
      address: `0x${address.address.toString(16)}`,
      valueType: address.dataType,
      valueAfter: value,
      reason,
    });
    return value;
  }

  proposeWrite(
    address: LiveMemoryAddress,
    requestedValue: number,
    options: WriteCallOptions = {},
  ): LiveWriteProposal {
    const intent = options.writeIntent ?? 'stage';
    const userApproved = options.userApproved === true;
    const gate = this.enforceWritePolicy(options.reason ?? 'propose', userApproved, intent);
    if (gate.ok === false) {
      throw new Error(gate.error);
    }
    const proposal = this.session.proposeWrite(address, requestedValue);
    this.audit.append({
      op: 'write',
      featureId: options.featureId,
      address: `0x${address.address.toString(16)}`,
      valueType: address.dataType,
      valueBefore: proposal.currentValue,
      valueAfter: proposal.requestedValue,
      reason: `${options.reason ?? 'propose'}:proposed`,
      waiverAssumed: this.waiverAssumedForAudit(userApproved),
    });
    return proposal;
  }

  async confirmWrite(
    proposalId: string,
    options: WriteCallOptions = {},
  ): Promise<ConfirmWriteManagerResult> {
    let userApproved = options.userApproved === true;
    if (options.consentToken) {
      if (!options.consentBinding) {
        return { success: false, error: 'consent_binding_required' };
      }
      const consumed = consumeWriteConsent(options.consentToken, options.consentBinding);
      if (consumed.ok === false) {
        this.audit.append({
          op: 'abort',
          featureId: options.featureId,
          reason: `consent_denied:${consumed.reason}`,
          waiverAssumed: this.waiverAssumedForAudit(false),
        });
        return { success: false, error: `consent_denied:${consumed.reason}` };
      }
      userApproved = true;
    }
    const gate = this.enforceWritePolicy(options.reason ?? 'confirm', userApproved, 'commit');
    if (gate.ok === false) {
      return { success: false, error: gate.error };
    }
    const confirm = await this.session.confirmWrite(proposalId);
    if (!confirm.success) {
      this.audit.append({
        op: 'abort',
        featureId: options.featureId,
        reason: confirm.error ?? 'confirm_failed',
        waiverAssumed: this.waiverAssumedForAudit(userApproved),
      });
      return confirm;
    }
    this.audit.append({
      op: 'write',
      featureId: options.featureId,
      address: confirm.manifest
        ? `0x${confirm.manifest.target.address.toString(16)}`
        : undefined,
      valueType: confirm.manifest?.target.dataType,
      valueBefore: confirm.manifest?.valueBefore,
      valueAfter: confirm.manifest?.valueAfter,
      reason: `${options.reason ?? 'confirm'}:confirmed`,
      waiverAssumed: this.waiverAssumedForAudit(userApproved),
    });
    const snap = this.emitSnapshot({
      featureId: options.featureId,
      reason: options.reason ?? 'confirm',
      userApproved,
    });
    if (snap.ok === false) {
      return { ...confirm, snapshotError: snap.error };
    }
    return confirm;
  }

  /**
   * Propose → confirm → optional readback verify, with audit on each step.
   */
  async safeWrite(
    address: LiveMemoryAddress,
    requestedValue: number,
    options: WriteCallOptions = {},
  ): Promise<SafeWriteResult> {
    const reason = options.reason ?? 'safe_write';
    const policyCodeFromError = (error: string | undefined): string | undefined => {
      if (!error) return undefined;
      const marker = 'write_policy_denied:';
      const idx = error.indexOf(marker);
      if (idx < 0) return undefined;
      return error.slice(idx + marker.length).split(/[:\s]/)[0] || undefined;
    };

    let proposal: LiveWriteProposal;
    try {
      proposal = this.proposeWrite(address, requestedValue, {
        ...options,
        writeIntent: 'stage',
        userApproved: false,
        reason,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error,
        policyCode: policyCodeFromError(error),
      };
    }

    const confirm = await this.confirmWrite(proposal.proposalId, {
      ...options,
      writeIntent: 'commit',
      reason,
    });
    if (!confirm.success) {
      return {
        success: false,
        proposal,
        confirm,
        error: confirm.error,
        policyCode: policyCodeFromError(confirm.error),
        snapshotError: confirm.snapshotError,
      };
    }

    const snapshotError = confirm.snapshotError;
    if (options.verifyReadback === false) {
      return { success: true, proposal, confirm, verified: undefined, snapshotError };
    }

    let readbackValue: number;
    try {
      readbackValue = this.session.readValue(address);
    } catch (err) {
      return {
        success: true,
        proposal,
        confirm,
        verified: false,
        error: `Write succeeded but readback failed: ${String(err)}`,
        snapshotError,
      };
    }

    const verified = readbackValue === requestedValue;
    const userApproved =
      options.userApproved === true || Boolean(options.consentToken);
    this.audit.append({
      op: 'read',
      featureId: options.featureId,
      address: `0x${address.address.toString(16)}`,
      valueType: address.dataType,
      valueAfter: readbackValue,
      reason: verified ? `${reason}:readback_ok` : `${reason}:readback_mismatch`,
      waiverAssumed: this.waiverAssumedForAudit(userApproved),
    });

    return {
      success: true,
      proposal,
      confirm,
      verified,
      readbackValue,
      snapshotError,
      error: verified ? undefined : 'readback_mismatch',
    };
  }

  /**
   * Rolls back a write THIS SESSION actually confirmed, identified only by
   * proposalId. The manifest (address/dataType/values) is looked up
   * server-side inside LiveMemorySession — never accepted from the caller —
   * so this cannot be used to write an arbitrary value to an arbitrary
   * address under the guise of "undo".
   */
  async rollback(proposalId: string, featureId?: string): Promise<RollbackResult> {
    const result = await this.session.rollback(proposalId);
    this.audit.append({
      op: 'rollback',
      featureId,
      address: result.manifest ? `0x${result.manifest.target.address.toString(16)}` : undefined,
      valueType: result.manifest?.target.dataType,
      valueBefore: result.manifest?.valueAfter,
      valueAfter: result.manifest?.valueBefore,
      reason: result.success ? 'rollback_ok' : (result.error ?? 'rollback_failed'),
      waiverAssumed: this.waiverAssumedForAudit(result.success),
    });
    return result;
  }

  /**
   * Starts a previously-proposed freeze, identified only by proposalId.
   * Unlike confirmWrite, there is NO userApproved legacy bypass here — a
   * consentToken + consentBinding are always required, so an IPC caller (or
   * any other caller) can never start a freeze without going through the
   * native-dialog-backed propose/issue-consent flow.
   */
  async freezeStart(
    proposalId: string,
    options: { consentToken: string; consentBinding: WriteConsentBinding; featureId?: string },
  ): Promise<StartFreezeResult> {
    const consumed = consumeWriteConsent(options.consentToken, options.consentBinding);
    if (consumed.ok === false) {
      this.audit.append({
        op: 'abort',
        featureId: options.featureId,
        reason: `consent_denied:${consumed.reason}`,
        waiverAssumed: this.waiverAssumedForAudit(false),
      });
      return { success: false, error: `consent_denied:${consumed.reason}` };
    }
    const result = this.session.startFreezeConfirmed(proposalId);
    this.audit.append({
      op: 'write',
      featureId: options.featureId,
      reason: result.success ? 'freeze_start_confirmed' : (result.error ?? 'freeze_start_failed'),
      waiverAssumed: this.waiverAssumedForAudit(result.success),
    });
    return result;
  }
}
