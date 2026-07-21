/**
 * MemoryManager — safe-write facade over LiveMemorySession + local audit log.
 * Phase 10: optional WritePolicyGate checked before propose/confirm/safeWrite.
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
}

/** Optional hook after a confirmed process write (e.g. Avowed WinGDK save snapshot). */
export type MemoryManagerSnapshotListener = (info: {
  featureId?: string;
  reason?: string;
}) => void;

export class MemoryManager {
  private snapshotListener: MemoryManagerSnapshotListener | null = null;
  private readonly writeGate = new WritePolicyGate();
  /** When null, trainer default context is used (existing product path). */
  private writePolicyContext: WritePolicyContext | null = null;

  constructor(
    private readonly session: LiveMemorySession,
    private readonly audit: MemoryAuditLog,
  ) {}

  /** Override write policy (e.g. research_probe). Null restores trainer defaults. */
  setWritePolicyContext(context: WritePolicyContext | null): void {
    this.writePolicyContext = context;
  }

  getWritePolicyContext(): WritePolicyContext {
    return this.writePolicyContext ?? defaultTrainerWritePolicyContext();
  }

  private enforceWritePolicy(reason: string): { ok: true } | { ok: false; error: string; code: string } {
    const decision = this.writeGate.evaluate(this.getWritePolicyContext());
    if (decision.allow) return { ok: true };
    this.audit.append({
      op: 'abort',
      reason: `write_policy:${decision.code}:${reason}:${decision.reasons.join(';')}`,
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

  private emitSnapshot(info: { featureId?: string; reason?: string }): void {
    try {
      this.snapshotListener?.(info);
    } catch {
      // Backup hooks must never fail a live write path.
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
    options: { featureId?: string; reason?: string } = {},
  ): LiveWriteProposal {
    const gate = this.enforceWritePolicy(options.reason ?? 'propose');
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
    });
    return proposal;
  }

  async confirmWrite(
    proposalId: string,
    options: { featureId?: string; reason?: string } = {},
  ): Promise<ConfirmWriteResult> {
    const gate = this.enforceWritePolicy(options.reason ?? 'confirm');
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }
    const confirm = await this.session.confirmWrite(proposalId);
    if (!confirm.success) {
      this.audit.append({
        op: 'abort',
        featureId: options.featureId,
        reason: confirm.error ?? 'confirm_failed',
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
    });
    this.emitSnapshot({ featureId: options.featureId, reason: options.reason ?? 'confirm' });
    return confirm;
  }

  /**
   * Propose → confirm → optional readback verify, with audit on each step.
   */
  async safeWrite(
    address: LiveMemoryAddress,
    requestedValue: number,
    options: { featureId?: string; reason?: string; verifyReadback?: boolean } = {},
  ): Promise<SafeWriteResult> {
    const reason = options.reason ?? 'safe_write';
    const gate = this.enforceWritePolicy(reason);
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
    });
    this.emitSnapshot({ featureId: options.featureId, reason });

    if (options.verifyReadback === false) {
      return { success: true, proposal, confirm, verified: undefined };
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

    return { success: true, proposal, confirm, verified, readbackValue };
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
    });
    return result;
  }
}
