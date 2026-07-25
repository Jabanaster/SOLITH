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
} from './live-memory-session.js';
import type { LiveMemoryAddress, LiveWriteManifest, LiveWriteProposal } from './types.js';
import {
  WritePolicyGate,
  defaultTrainerWritePolicyContext,
  type WritePolicyContext,
} from './write-policy.js';

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
  /** Required when no explicit writePolicyContext was set. Defaults false (fail-closed). */
  userApproved?: boolean;
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

  getWritePolicyContext(userApprovedForCall = false): WritePolicyContext {
    if (this.writePolicyContext) {
      if (this.writePolicyContext.writeClass === 'trainer') {
        return {
          ...this.writePolicyContext,
          singlePlayerWaiverAccepted: this.session.isOfflineConfirmed(),
          userApproved:
            this.writePolicyContext.userApproved === true || userApprovedForCall === true,
        };
      }
      return this.writePolicyContext;
    }
    return defaultTrainerWritePolicyContext({
      singlePlayerWaiverAccepted: this.session.isOfflineConfirmed(),
      userApproved: userApprovedForCall === true,
    });
  }

  private waiverAssumedForAudit(userApprovedForCall = false): boolean {
    const ctx = this.getWritePolicyContext(userApprovedForCall);
    return ctx.singlePlayerWaiverAccepted === true || ctx.isOffline === true;
  }

  private enforceWritePolicy(
    reason: string,
    userApprovedForCall: boolean,
  ): { ok: true } | { ok: false; error: string; code: string } {
    const decision = this.writeGate.evaluate(this.getWritePolicyContext(userApprovedForCall));
    if (decision.allow) return { ok: true };
    this.audit.append({
      op: 'abort',
      reason: `write_policy:${decision.code}:${reason}:${decision.reasons.join(';')}`,
      waiverAssumed: this.waiverAssumedForAudit(userApprovedForCall),
    });
    return { ok: false, error: `write_policy_denied:${decision.code}`, code: decision.code };
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

  private emitSnapshot(info: { featureId?: string; reason?: string }): { ok: true } | { ok: false; error: string } {
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
        waiverAssumed: this.waiverAssumedForAudit(true),
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
    const userApproved = options.userApproved === true;
    const gate = this.enforceWritePolicy(options.reason ?? 'propose', userApproved);
    if (!gate.ok) {
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
    const userApproved = options.userApproved === true;
    const gate = this.enforceWritePolicy(options.reason ?? 'confirm', userApproved);
    if (!gate.ok) {
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
    const snap = this.emitSnapshot({ featureId: options.featureId, reason: options.reason ?? 'confirm' });
    if (!snap.ok) {
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
    const userApproved = options.userApproved === true;
    const gate = this.enforceWritePolicy(reason, userApproved);
    if (!gate.ok) {
      return { success: false, error: gate.error, policyCode: gate.code };
    }
    let proposal: LiveWriteProposal;
    try {
      proposal = this.session.proposeWrite(address, requestedValue);
    } catch (err) {
      const error = String(err);
      this.audit.append({
        op: 'abort',
        featureId: options.featureId,
        address: `0x${address.address.toString(16)}`,
        valueType: address.dataType,
        reason: `propose_failed:${error}`,
        waiverAssumed: this.waiverAssumedForAudit(userApproved),
      });
      return { success: false, error };
    }

    this.audit.append({
      op: 'write',
      featureId: options.featureId,
      address: `0x${address.address.toString(16)}`,
      valueType: address.dataType,
      valueBefore: proposal.currentValue,
      valueAfter: proposal.requestedValue,
      reason: `${reason}:proposed`,
      waiverAssumed: this.waiverAssumedForAudit(userApproved),
    });

    const confirm = await this.session.confirmWrite(proposal.proposalId);
    if (!confirm.success) {
      this.audit.append({
        op: 'abort',
        featureId: options.featureId,
        address: `0x${address.address.toString(16)}`,
        valueType: address.dataType,
        valueBefore: proposal.currentValue,
        valueAfter: proposal.requestedValue,
        reason: confirm.error ?? 'confirm_failed',
        waiverAssumed: this.waiverAssumedForAudit(userApproved),
      });
      return { success: false, proposal, confirm, error: confirm.error };
    }

    this.audit.append({
      op: 'write',
      featureId: options.featureId,
      address: `0x${address.address.toString(16)}`,
      valueType: address.dataType,
      valueBefore: confirm.manifest?.valueBefore,
      valueAfter: confirm.manifest?.valueAfter,
      reason: `${reason}:confirmed`,
      waiverAssumed: this.waiverAssumedForAudit(userApproved),
    });
    const snap = this.emitSnapshot({ featureId: options.featureId, reason });
    const snapshotError = snap.ok ? undefined : snap.error;

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
    this.audit.append({
      op: 'read',
      featureId: options.featureId,
      address: `0x${address.address.toString(16)}`,
      valueType: address.dataType,
      valueAfter: readbackValue,
      reason: verified ? `${reason}:readback_ok` : `${reason}:readback_mismatch`,
    });

    return { success: true, proposal, confirm, verified, readbackValue, snapshotError };
  }

  async rollback(manifest: LiveWriteManifest, featureId?: string): Promise<RollbackResult> {
    const result = await this.session.rollback(manifest);
    this.audit.append({
      op: 'rollback',
      featureId,
      address: `0x${manifest.target.address.toString(16)}`,
      valueType: manifest.target.dataType,
      valueBefore: manifest.valueAfter,
      valueAfter: manifest.valueBefore,
      reason: result.success ? 'rollback_ok' : (result.error ?? 'rollback_failed'),
      waiverAssumed: this.waiverAssumedForAudit(result.success),
    });
    return result;
  }
}
