/**
 * MemoryManager — safe-write facade over LiveMemorySession + local audit log.
 */

import type { MemoryAuditLog } from './audit-log.js';
import type {
  ConfirmWriteResult,
  LiveMemorySession,
  RollbackResult,
} from './live-memory-session.js';
import type { LiveMemoryAddress, LiveWriteManifest, LiveWriteProposal } from './types.js';

export interface SafeWriteResult {
  success: boolean;
  proposal?: LiveWriteProposal;
  confirm?: ConfirmWriteResult;
  verified?: boolean;
  readbackValue?: number;
  error?: string;
}

export class MemoryManager {
  constructor(
    private readonly session: LiveMemorySession,
    private readonly audit: MemoryAuditLog,
  ) {}

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

  /**
   * Propose → confirm → optional readback verify, with audit on each step.
   */
  async safeWrite(
    address: LiveMemoryAddress,
    requestedValue: number,
    options: { featureId?: string; reason?: string; verifyReadback?: boolean } = {},
  ): Promise<SafeWriteResult> {
    const reason = options.reason ?? 'safe_write';
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
